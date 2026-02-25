from __future__ import annotations

from typing import Dict, Any, Tuple, List
import numpy as np
import pandas as pd

from ta.momentum import RSIIndicator
from ta.trend import MACD, SMAIndicator
from ta.volatility import AverageTrueRange, BollingerBands


def _safe_log(x: pd.Series) -> pd.Series:
    x = pd.Series(x).astype(float)
    return np.log(x.replace(0, np.nan))


def _as_1d_series(df: pd.DataFrame, col: str) -> pd.Series:
    if col not in df.columns:
        raise KeyError(f"Missing required column: {col}. Available: {list(df.columns)}")

    x = df[col]

    if isinstance(x, pd.DataFrame):
        if x.shape[1] != 1:
            raise ValueError(f"Column '{col}' resolved to DataFrame with shape {x.shape}, expected 1 column.")
        x = x.iloc[:, 0]

    if not isinstance(x, pd.Series):
        x = pd.Series(x)

    return pd.to_numeric(x, errors="coerce").astype(float)


def build_features(price: pd.DataFrame, info: Dict[str, Any]) -> pd.DataFrame:
    df = price.copy()

    px = _as_1d_series(df, "Adj Close")
    high = _as_1d_series(df, "High")
    low = _as_1d_series(df, "Low")
    vol = _as_1d_series(df, "Volume")

    # Returns / momentum
    df["ret_1d"] = px.pct_change(1)
    df["ret_3d"] = px.pct_change(3)
    df["ret_5d"] = px.pct_change(5)
    df["ret_10d"] = px.pct_change(10)
    df["logret_1d"] = _safe_log(px).diff(1)

    # Volatility (realized)
    df["vol_10d"] = df["logret_1d"].rolling(10).std() * np.sqrt(252)
    df["vol_21d"] = df["logret_1d"].rolling(21).std() * np.sqrt(252)

    # Trend
    df["sma_10"] = SMAIndicator(close=px, window=10).sma_indicator()
    df["sma_20"] = SMAIndicator(close=px, window=20).sma_indicator()
    df["sma_50"] = SMAIndicator(close=px, window=50).sma_indicator()
    df["trend_10_20"] = df["sma_10"] / df["sma_20"] - 1.0
    df["trend_20_50"] = df["sma_20"] / df["sma_50"] - 1.0

    # RSI
    df["rsi_14"] = RSIIndicator(close=px, window=14).rsi()

    # MACD
    macd = MACD(close=px)
    df["macd"] = macd.macd()
    df["macd_signal"] = macd.macd_signal()
    df["macd_diff"] = macd.macd_diff()

    # ATR
    df["atr_14"] = AverageTrueRange(high=high, low=low, close=px, window=14).average_true_range()

    # Bollinger
    bb = BollingerBands(close=px, window=20, window_dev=2)
    df["bb_mavg"] = bb.bollinger_mavg()
    df["bb_hband"] = bb.bollinger_hband()
    df["bb_lband"] = bb.bollinger_lband()
    df["bb_pct"] = (px - df["bb_lband"]) / (df["bb_hband"] - df["bb_lband"])

    # Volume
    df["vol_chg_1d"] = vol.pct_change(1)
    df["vol_z_20"] = (vol - vol.rolling(20).mean()) / (vol.rolling(20).std() + 1e-12)

    # Snapshot fundamentals (optional context)
    fundamentals = {
        "mktcap": info.get("marketCap"),
        "trailing_pe": info.get("trailingPE"),
        "forward_pe": info.get("forwardPE"),
        "pb": info.get("priceToBook"),
        "beta": info.get("beta"),
        "profit_margins": info.get("profitMargins"),
        "oper_margins": info.get("operatingMargins"),
        "gross_margins": info.get("grossMargins"),
        "roa": info.get("returnOnAssets"),
        "roe_info": info.get("returnOnEquity"),
        "rev_growth": info.get("revenueGrowth"),
        "earn_growth": info.get("earningsGrowth"),
        "debt_to_equity": info.get("debtToEquity"),
        "current_ratio": info.get("currentRatio"),
        "quick_ratio": info.get("quickRatio"),
        "fcf": info.get("freeCashflow"),
        "ocf": info.get("operatingCashflow"),
    }
    for k, v in fundamentals.items():
        df[k] = v

    for k in ["mktcap", "fcf", "ocf"]:
        df[f"log_{k}"] = np.log(pd.to_numeric(df[k], errors="coerce").replace(0, np.nan))

    df = df.replace([np.inf, -np.inf], np.nan)

    feature_cols: List[str] = [
        "ret_1d", "ret_3d", "ret_5d", "ret_10d", "logret_1d",
        "vol_10d", "vol_21d", "atr_14",
        "sma_10", "sma_20", "sma_50", "trend_10_20", "trend_20_50",
        "rsi_14", "macd", "macd_signal", "macd_diff",
        "bb_pct",
        "vol_chg_1d", "vol_z_20",
        # snapshot fundamentals (optional)
        "trailing_pe", "forward_pe", "pb", "beta", "div_yield",
        "profit_margins", "oper_margins", "gross_margins",
        "roa", "roe_info", "rev_growth", "earn_growth", "debt_to_equity",
        "current_ratio", "quick_ratio",
        "log_mktcap", "log_fcf", "log_ocf",
    ]

    feature_cols = [c for c in feature_cols if c in df.columns]
    return df[feature_cols].copy()


def make_labels(price: pd.DataFrame, horizons: list[int]) -> Tuple[pd.DataFrame, pd.DataFrame]:
    px = _as_1d_series(price, "Adj Close")

    y_ret = pd.DataFrame(index=price.index)
    y_up = pd.DataFrame(index=price.index)

    for h in horizons:
        fut = px.shift(-h)
        ret = fut / px - 1.0
        y_ret[f"ret_fwd_{h}d"] = ret
        y_up[f"up_{h}d"] = (ret > 0).astype(int)

    return y_ret, y_up
