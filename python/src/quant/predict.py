from __future__ import annotations

import os
import argparse
import datetime as dt
import pandas as pd
from rich.console import Console
from rich.table import Table

from src.quant.config import SETTINGS
from src.quant.data import fetch_price_history, fetch_fundamental_snapshot, fetch_latest_price
from src.quant.features import build_features, make_labels
from src.quant.model import train_models, save_bundle, load_bundle, predict

console = Console()


def _normalize_price_df(price: pd.DataFrame, ticker: str) -> pd.DataFrame:
    """
    Ensures:
    - columns are single-level like: ['Open','High','Low','Close','Adj Close','Volume']
    - index is a single-level DatetimeIndex
    """
    df = price.copy()

    if isinstance(df.columns, pd.MultiIndex):
        if ticker in df.columns.get_level_values(-1):
            df = df.xs(ticker, axis=1, level=-1)
        elif ticker in df.columns.get_level_values(0):
            df = df.xs(ticker, axis=1, level=0)
        else:
            df.columns = df.columns.droplevel(-1)

    if isinstance(df.index, pd.MultiIndex):
        df = df.reset_index(level=list(range(1, df.index.nlevels)), drop=True)

    df.index = pd.to_datetime(df.index)
    return df


def fmt_pct(x: float) -> str:
    if x is None or pd.isna(x):
        return "-"
    return f"{x*100:,.2f}%"


def fmt_num(x):
    if x is None or pd.isna(x):
        return "-"
    if isinstance(x, (int, float)) and abs(x) >= 1e9:
        return f"{x/1e9:,.2f}B"
    if isinstance(x, (int, float)) and abs(x) >= 1e6:
        return f"{x/1e6:,.2f}M"
    if isinstance(x, (int, float)):
        return f"{x:,.4g}"
    return str(x)


def _apply_live_price_snapshot(price: pd.DataFrame, ticker: str) -> tuple[pd.DataFrame, float, dt.date]:
    """
    Use live price for intraday anchoring and append/update today's history row.
    """
    df = price.copy()
    last_date = pd.to_datetime(df.index[-1]).date()
    last_close = float(df["Adj Close"].iloc[-1])
    live_price = fetch_latest_price(ticker)
    if live_price is None:
        return df, last_close, last_date

    today = dt.date.today()
    anchor_date = last_date
    anchor_price = last_close

    if today > last_date:
        row = {
            "Open": live_price,
            "High": live_price,
            "Low": live_price,
            "Close": live_price,
            "Adj Close": live_price,
            "Volume": 0.0,
            "Dividends": 0.0,
        }
        df.loc[pd.Timestamp(today)] = row
        df = df.sort_index()
        anchor_date = today
        anchor_price = float(live_price)
    elif today == last_date:
        for c in ("Close", "Adj Close"):
            if c in df.columns:
                df.iloc[-1, df.columns.get_loc(c)] = live_price
        if "High" in df.columns:
            df.iloc[-1, df.columns.get_loc("High")] = max(float(df["High"].iloc[-1]), live_price)
        if "Low" in df.columns:
            df.iloc[-1, df.columns.get_loc("Low")] = min(float(df["Low"].iloc[-1]), live_price)
        anchor_date = today
        anchor_price = float(live_price)

    return df, anchor_price, anchor_date


def infer_one(ticker: str, retrain: bool = False) -> dict[str, pd.DataFrame]:
    """
    Universe-friendly inference.
    Returns a tidy per-horizon table for the latest available date.
    """
    ticker = ticker.upper().strip()
    model_path = os.path.join(SETTINGS.model_dir, f"{ticker}_bundle.joblib")

    price = fetch_price_history(ticker, SETTINGS.history_years)
    info = fetch_fundamental_snapshot(ticker)
    price = _normalize_price_df(price, ticker)

    X = build_features(price, info)
    y_ret, y_up = make_labels(price, SETTINGS.horizons)

    data = X.join(y_ret).join(y_up)
    data = data.dropna(subset=y_ret.columns.tolist())

    if len(data) < SETTINGS.min_samples:
        raise ValueError(f"{ticker}: Not enough samples: {len(data)} < {SETTINGS.min_samples}")

    # Load or train
    if (not retrain) and os.path.exists(model_path):
        bundle = load_bundle(model_path)
    else:
        bundle = train_models(
            X=data[X.columns],
            y_ret=data[y_ret.columns],
            y_up=data[y_up.columns],
            horizons=SETTINGS.horizons,
            test_size=SETTINGS.test_size,
            seed=SETTINGS.seed,
            calib_size=SETTINGS.calib_size,
            calib_method=SETTINGS.calib_method,
            prob_bins=SETTINGS.prob_bins,
        )
        save_bundle(bundle, model_path)

    X_latest = X.tail(1)
    pred_ret, prob_up_raw, prob_up_cal = predict(bundle, X_latest)
    price, last_close, last_date = _apply_live_price_snapshot(price, ticker)

    rows = []
    for h in SETTINGS.horizons:
        r = float(pred_ret[f"ret_fwd_{h}d"])
        p_raw = float(prob_up_raw[f"up_{h}d"])
        p_cal = float(prob_up_cal[f"up_{h}d"])
        rows.append({
            "date": str(last_date),
            "ticker": ticker,
            "horizon": int(h),
            "adj_close": last_close,
            "pred_return": r,
            "p_up_raw": p_raw,
            "p_up": p_cal,
            "implied_price": last_close * (1.0 + r),
            "model_path": model_path,
        })

    rows_df = pd.DataFrame(rows)
    history_cols = ["Open", "High", "Low", "Close", "Adj Close"]
    if "Dividends" in price.columns:
        history_cols.append("Dividends")
    else:
        price = price.copy()
        price["Dividends"] = 0.0
        history_cols.append("Dividends")

    history_df = (
        price[history_cols]
        .rename(
            columns={
                "Open": "open",
                "High": "high",
                "Low": "low",
                "Close": "close",
                "Adj Close": "adj_close",
                "Dividends": "dividends",
            }
        )
        .reset_index(names="date")
    )
    history_df["date"] = pd.to_datetime(history_df["date"]).dt.date.astype(str)

    return {
        "rows": rows_df,
        "history": history_df,
    }


def _corr_table(
    title: str,
    data: pd.DataFrame,
    feature_cols: list[str],
    y_ret: pd.DataFrame,
    horizons: list[int],
) -> Table:
    """
    Correlation between selected features and forward returns by horizon.
    Uses Pearson correlation on overlapping non-null rows.
    """
    t = Table(title=title, show_lines=True)
    t.add_column("Feature")
    for h in horizons:
        t.add_column(f"{h}d", justify="right")

    for f in feature_cols:
        row = [f]
        for h in horizons:
            ycol = f"ret_fwd_{h}d"
            if f not in data.columns or ycol not in y_ret.columns:
                row.append("-")
                continue
            tmp = pd.concat([data[f], y_ret[ycol]], axis=1).dropna()
            if len(tmp) < 200:
                row.append("-")
            else:
                c = float(tmp.iloc[:, 0].corr(tmp.iloc[:, 1]))
                row.append(f"{c:,.3f}")
        t.add_row(*row)

    return t

def run(ticker: str, retrain: bool):
    ticker = ticker.upper().strip()
    model_path = os.path.join(SETTINGS.model_dir, f"{ticker}_bundle.joblib")

    console.rule(f"[bold]Ticker[/bold]: {ticker}")

    # Fetch price + snapshot fundamentals
    price = fetch_price_history(ticker, SETTINGS.history_years)
    info = fetch_fundamental_snapshot(ticker)
    price = _normalize_price_df(price, ticker)

    X = build_features(price, info)
    y_ret, y_up = make_labels(price, SETTINGS.horizons)

    data = X.join(y_ret).join(y_up)
    data = data.dropna(subset=y_ret.columns.tolist())


    if len(data) < SETTINGS.min_samples:
        raise ValueError(
            f"Not enough samples after feature/label creation: {len(data)} < {SETTINGS.min_samples}. "
            f"Try a ticker with longer history."
        )

    # Load or train
    if (not retrain) and os.path.exists(model_path):
        bundle = load_bundle(model_path)
        console.print(f"Loaded existing model: {model_path}")
    else:
        bundle = train_models(
            X=data[X.columns],
            y_ret=data[y_ret.columns],
            y_up=data[y_up.columns],
            horizons=SETTINGS.horizons,
            test_size=SETTINGS.test_size,
            seed=SETTINGS.seed,
            calib_size=SETTINGS.calib_size,
            calib_method=SETTINGS.calib_method,
            prob_bins=SETTINGS.prob_bins,
        )
        save_bundle(bundle, model_path)
        console.print(f"Trained + saved model: {model_path}")

    X_latest = X.tail(1)
    pred_ret, prob_up_raw, prob_up_cal = predict(bundle, X_latest)
    price, last_close, last_date = _apply_live_price_snapshot(price, ticker)

    # Snapshot table
    t1 = Table(title="Market + Fundamentals Snapshot", show_lines=True)
    t1.add_column("Field")
    t1.add_column("Value", justify="right")
    t1.add_row("Name", str(info.get("shortName", "-")))
    t1.add_row("Last date", str(last_date))
    t1.add_row("Adj close", f"{last_close:,.2f}")
    t1.add_row("Market cap", fmt_num(info.get("marketCap")))
    t1.add_row("Trailing PE", fmt_num(info.get("trailingPE")))
    t1.add_row("Forward PE", fmt_num(info.get("forwardPE")))
    t1.add_row("P/B", fmt_num(info.get("priceToBook")))
    t1.add_row("Beta", fmt_num(info.get("beta")))
    t1.add_row("Profit margin", fmt_pct(info.get("profitMargins")))
    t1.add_row("Operating margin", fmt_pct(info.get("operatingMargins")))
    console.print(t1)

    # Forecast table
    t2 = Table(title="Multi-horizon Forecast (returns + direction probability)", show_lines=True)
    t2.add_column("Horizon")
    t2.add_column("Pred. return", justify="right")
    t2.add_column("Prob(up)", justify="right")
    t2.add_column("Implied price", justify="right")

    for h in SETTINGS.horizons:
        r = float(pred_ret[f"ret_fwd_{h}d"])
        p_raw = float(prob_up_raw[f"up_{h}d"])
        p_cal = float(prob_up_cal[f"up_{h}d"])
        implied = last_close * (1.0 + r)
        t2.add_row(
            f"{h}d",
            fmt_pct(r),
            f"{p_cal*100:,.1f}% (raw {p_raw*100:,.1f}%)",
            f"{implied:,.2f}",
        )

    console.print(t2)

    # Diagnostics
    t3 = Table(title="Backtest Diagnostics (holdout)", show_lines=True)
    t3.add_column("Metric")
    t3.add_column("Value", justify="right")
    t3.add_row("Train rows", str(bundle.metrics.get("rows_train")))
    t3.add_row("Test rows", str(bundle.metrics.get("rows_test")))
    t3.add_row("Feature count", str(bundle.metrics.get("feature_count")))
    t3.add_row("Last train date", str(bundle.metrics.get("last_train_date")))
    t3.add_row("Last test date", str(bundle.metrics.get("last_test_date")))
    t3.add_row("Calib method", str(bundle.metrics.get("calib_method")))
    t3.add_row("Calib size", str(bundle.metrics.get("calib_size")))
    console.print(t3)

    # Per-horizon errors
    t4 = Table(title="Holdout Error (MAE of forward return) + AUC(up)", show_lines=True)
    t4.add_column("Horizon")
    t4.add_column("MAE(return)", justify="right")
    t4.add_column("AUC(raw)", justify="right")
    for h in SETTINGS.horizons:
        mae = bundle.metrics["mae_forward_return"].get(f"ret_fwd_{h}d")
        auc = bundle.metrics["auc_direction_raw"].get(f"up_{h}d")
        t4.add_row(f"{h}d", fmt_pct(mae), "-" if auc is None else f"{auc:,.3f}")
    console.print(t4)

    # Probability quality
    t6 = Table(title=f"Probability Quality (calibration = {bundle.metrics.get('calib_method')})", show_lines=True)
    t6.add_column("Horizon")
    t6.add_column("AUC(raw)", justify="right")
    t6.add_column("Brier(raw)", justify="right")
    t6.add_column("Brier(cal)", justify="right")

    for h in SETTINGS.horizons:
        ycol = f"up_{h}d"
        auc = bundle.metrics["auc_direction_raw"].get(ycol)
        br = bundle.metrics["brier_raw"].get(ycol)
        bc = bundle.metrics["brier_cal"].get(ycol)
        t6.add_row(
            f"{h}d",
            "-" if auc is None else f"{auc:,.3f}",
            "-" if br is None else f"{br:,.4f}",
            "-" if bc is None else f"{bc:,.4f}",
        )
    console.print(t6)

    # Fundamental correlation table
    corr_features = [
        "eps_diluted_yoy",
        "eps_diluted_accel",
        "revenue_yoy",
        "revenue_accel",
        "roe",
        "roe_delta",
    ]
    corr_features = [c for c in corr_features if c in data.columns]
    if corr_features:
        t5 = _corr_table(
            title="Fundamental Correlation vs Forward Returns (Pearson)",
            data=data,
            feature_cols=corr_features,
            y_ret=y_ret.loc[data.index],
            horizons=SETTINGS.horizons,
        )
        console.print(t5)
    else:
        console.print("[yellow]Note:[/yellow] No quarterly fundamental features available for correlation table.")


def main():
    parser = argparse.ArgumentParser(description="Stock prediction model (v1)")
    parser.add_argument("ticker", type=str, help="Ticker (e.g. AAPL, MSFT, TSLA)")
    parser.add_argument("--retrain", action="store_true", help="Force retrain and overwrite saved model")
    args = parser.parse_args()
    run(args.ticker, retrain=args.retrain)


if __name__ == "__main__":
    main()
