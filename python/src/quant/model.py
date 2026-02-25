from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Dict, Any, Tuple, List

import numpy as np
import pandas as pd
from joblib import dump, load

from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import RobustScaler
from sklearn.ensemble import HistGradientBoostingRegressor, HistGradientBoostingClassifier
from sklearn.multioutput import MultiOutputRegressor
from sklearn.metrics import mean_absolute_error, roc_auc_score, brier_score_loss
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression


@dataclass
class TrainedBundle:
    reg: Any
    clf_raw: List[Any]          # list of per-horizon classifier pipelines
    clf_cal: List[Any]          # list of per-horizon calibrators
    feature_columns: List[str]
    horizons: List[int]
    metrics: Dict[str, Any]
    calib_method: str


def _time_split(X: pd.DataFrame, y: pd.DataFrame, test_size: float) -> Tuple:
    n = len(X)
    cut = int(n * (1 - test_size))
    X_train, X_test = X.iloc[:cut], X.iloc[cut:]
    y_train, y_test = y.iloc[:cut], y.iloc[cut:]
    return X_train, X_test, y_train, y_test


def _train_cal_split(X_train: pd.DataFrame, y_train: pd.Series, calib_size: float) -> Tuple:
    """
    Split TRAIN into:
      - fit set (early)
      - calibration set (latest chunk)
    """
    n = len(X_train)
    cut = int(n * (1 - calib_size))
    X_fit, X_cal = X_train.iloc[:cut], X_train.iloc[cut:]
    y_fit, y_cal = y_train.iloc[:cut], y_train.iloc[cut:]
    return X_fit, X_cal, y_fit, y_cal


class _Calibrator:
    """
    Calibrate raw P(up) -> calibrated P(up)
    """
    def __init__(self, method: str):
        self.method = method
        self.iso = None
        self.sig = None

    def fit(self, p_raw: np.ndarray, y: np.ndarray):
        p_raw = np.asarray(p_raw).reshape(-1)
        y = np.asarray(y).reshape(-1)

        p_raw = np.clip(p_raw, 1e-6, 1 - 1e-6)

        if self.method == "isotonic":
            self.iso = IsotonicRegression(out_of_bounds="clip")
            self.iso.fit(p_raw, y)
        elif self.method == "sigmoid":
            X = p_raw.reshape(-1, 1)
            self.sig = LogisticRegression(solver="lbfgs")
            self.sig.fit(X, y)
        else:
            raise ValueError(f"Unknown calibration method: {self.method}")

        return self

    def predict_proba_from_raw(self, p_raw: np.ndarray) -> np.ndarray:
        p_raw = np.asarray(p_raw).reshape(-1)
        p_raw = np.clip(p_raw, 1e-6, 1 - 1e-6)

        if self.iso is not None:
            p = self.iso.predict(p_raw)
        elif self.sig is not None:
            p = self.sig.predict_proba(p_raw.reshape(-1, 1))[:, 1]
        else:
            raise RuntimeError("Calibrator not fitted")

        p = np.clip(p, 1e-6, 1 - 1e-6)
        return np.column_stack([1 - p, p])


def _make_clf_pipeline(seed: int) -> Pipeline:
    return Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", RobustScaler(with_centering=False)),
            ("model", HistGradientBoostingClassifier(
                random_state=seed,
                max_depth=6,
                learning_rate=0.05,
                max_iter=400,
            )),
        ]
    )


def train_models(
    X: pd.DataFrame,
    y_ret: pd.DataFrame,
    y_up: pd.DataFrame,
    horizons: List[int],
    test_size: float,
    seed: int,
    calib_size: float = 0.15,
    calib_method: str = "isotonic",
    prob_bins: int = 10,
) -> TrainedBundle:
    # Align & drop rows where forward returns are missing (near the end)
    data = X.join(y_ret).join(y_up)
    data = data.dropna(subset=y_ret.columns.tolist())
    X2 = data[X.columns]
    y_ret2 = data[y_ret.columns]
    y_up2 = data[y_up.columns]

    X_train, X_test, yret_train, yret_test = _time_split(X2, y_ret2, test_size)
    _, _, yup_train, yup_test = _time_split(X2, y_up2, test_size)

    # ----- Regressor (multi-output) -----
    reg = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", RobustScaler(with_centering=False)),
            ("model", MultiOutputRegressor(
                HistGradientBoostingRegressor(
                    random_state=seed,
                    max_depth=6,
                    learning_rate=0.05,
                    max_iter=400,
                )
            )),
        ]
    )
    reg.fit(X_train, yret_train)

    # ----- Classifiers: per-horizon + calibrate on last chunk of TRAIN -----
    clf_raw_list: List[Any] = []
    clf_cal_list: List[Any] = []

    auc_by_h = {}
    brier_raw_by_h = {}
    brier_cal_by_h = {}

    # reliability bins are useful but we’ll keep them in metrics (not huge prints)
    reliability_by_h = {}

    for h in horizons:
        ycol = f"up_{h}d"
        y_train_h = yup_train[ycol].astype(int)
        y_test_h = yup_test[ycol].astype(int)

        X_fit, X_cal, y_fit, y_cal = _train_cal_split(X_train, y_train_h, calib_size)

        clf = _make_clf_pipeline(seed)
        clf.fit(X_fit, y_fit)

        # raw probabilities
        p_cal_raw = clf.predict_proba(X_cal)[:, 1]
        p_test_raw = clf.predict_proba(X_test)[:, 1]

        # calibrate
        cal = _Calibrator(calib_method).fit(p_cal_raw, y_cal.values)
        p_test_cal = cal.predict_proba_from_raw(p_test_raw)[:, 1]

        # metrics
        try:
            auc_by_h[ycol] = float(roc_auc_score(y_test_h, np.clip(p_test_raw, 1e-6, 1 - 1e-6)))
        except Exception:
            auc_by_h[ycol] = None

        brier_raw_by_h[ycol] = float(brier_score_loss(y_test_h, np.clip(p_test_raw, 1e-6, 1 - 1e-6)))
        brier_cal_by_h[ycol] = float(brier_score_loss(y_test_h, np.clip(p_test_cal, 1e-6, 1 - 1e-6)))

        # reliability bins summary (calibrated probs)
        bins = np.linspace(0.0, 1.0, prob_bins + 1)
        idxs = np.digitize(p_test_cal, bins) - 1
        rel = []
        for b in range(prob_bins):
            m = idxs == b
            if int(m.sum()) < 25:
                continue
            rel.append({
                "bin": int(b),
                "p_mean": float(np.mean(p_test_cal[m])),
                "y_mean": float(np.mean(y_test_h[m])),
                "n": int(m.sum()),
            })
        reliability_by_h[ycol] = rel

        clf_raw_list.append(clf)
        clf_cal_list.append(cal)

    # ----- Regression MAE diagnostics -----
    yret_pred = pd.DataFrame(reg.predict(X_test), index=X_test.index, columns=y_ret2.columns)
    mae_by_h = {c: float(mean_absolute_error(yret_test[c], yret_pred[c])) for c in y_ret2.columns}

    metrics = {
        "rows_train": int(len(X_train)),
        "rows_test": int(len(X_test)),
        "mae_forward_return": mae_by_h,
        "auc_direction_raw": auc_by_h,
        "brier_raw": brier_raw_by_h,
        "brier_cal": brier_cal_by_h,
        "reliability_bins": reliability_by_h,
        "feature_count": int(X.shape[1]),
        "horizons": horizons,
        "last_train_date": str(X_train.index.max().date()) if len(X_train) else None,
        "last_test_date": str(X_test.index.max().date()) if len(X_test) else None,
        "calib_method": calib_method,
        "calib_size": float(calib_size),
        "prob_bins": int(prob_bins),
    }

    return TrainedBundle(
        reg=reg,
        clf_raw=clf_raw_list,
        clf_cal=clf_cal_list,
        feature_columns=list(X.columns),
        horizons=horizons,
        metrics=metrics,
        calib_method=calib_method,
    )


def save_bundle(bundle: TrainedBundle, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    dump(bundle, path)


def load_bundle(path: str) -> TrainedBundle:
    return load(path)


def predict(
    bundle: TrainedBundle,
    X_latest: pd.DataFrame,
) -> Tuple[pd.Series, pd.Series, pd.Series]:
    """
    Returns:
      pred_ret: predicted forward returns (index = ret_fwd_* columns)
      prob_up_raw: raw model P(up) per horizon
      prob_up_cal: calibrated P(up) per horizon
    """
    X_latest = X_latest[bundle.feature_columns].copy()

    pred_ret = bundle.reg.predict(X_latest)[0]
    ret_cols = [f"ret_fwd_{h}d" for h in bundle.horizons]
    pred_ret_s = pd.Series(pred_ret, index=ret_cols)

    prob_up_raw = {}
    prob_up_cal = {}

    for i, h in enumerate(bundle.horizons):
        clf = bundle.clf_raw[i]
        cal = bundle.clf_cal[i]

        p_raw = float(clf.predict_proba(X_latest)[:, 1][0])
        p_cal = float(cal.predict_proba_from_raw(np.array([p_raw]))[:, 1][0])

        prob_up_raw[f"up_{h}d"] = p_raw
        prob_up_cal[f"up_{h}d"] = p_cal

    return pred_ret_s, pd.Series(prob_up_raw), pd.Series(prob_up_cal)
