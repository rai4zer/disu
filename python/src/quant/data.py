from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Dict, Any, Optional

import pandas as pd
import yfinance as yf


@dataclass
class TickerData:
    ticker: str
    price: pd.DataFrame          # OHLCV indexed by date
    info: Dict[str, Any]         # fundamentals snapshot


def fetch_price_history(ticker: str, years: int) -> pd.DataFrame:
    end = dt.date.today()
    start = end - dt.timedelta(days=int(years * 365.25))

    def _standardize(df: pd.DataFrame) -> pd.DataFrame:
        if df is None or df.empty:
            return df

        df = df.copy()

        # Handle MultiIndex columns (yfinance edge cases)
        if isinstance(df.columns, pd.MultiIndex):
            if ticker in df.columns.get_level_values(-1):
                df = df.xs(ticker, axis=1, level=-1)
            elif ticker in df.columns.get_level_values(0):
                df = df.xs(ticker, axis=1, level=0)
            else:
                df.columns = df.columns.droplevel(-1)

        # Normalize column names explicitly
        rename_map = {
            "open": "Open",
            "high": "High",
            "low": "Low",
            "close": "Close",
            "adj close": "Adj Close",
            "adjclose": "Adj Close",
            "volume": "Volume",
            "dividends": "Dividends",
        }
        df.columns = [str(c) for c in df.columns]
        df = df.rename(columns={c: rename_map.get(c.strip().lower(), c) for c in df.columns})

        # yfinance sometimes omits Adj Close
        if "Adj Close" not in df.columns and "Close" in df.columns:
            df["Adj Close"] = df["Close"]

        needed = ["Open", "High", "Low", "Close", "Adj Close", "Volume"]
        for c in needed:
            if c not in df.columns:
                raise ValueError(f"Missing column '{c}' for {ticker}")

        if "Dividends" not in df.columns:
            df["Dividends"] = 0.0

        df = df[needed + ["Dividends"]].copy()
        df.index = pd.to_datetime(df.index)
        df = df.sort_index()
        df = df.dropna()
        return df

    # --- Primary: yf.download ---
    try:
        df = yf.download(
            tickers=ticker,
            start=start.isoformat(),
            end=end.isoformat(),
            interval="1d",
            auto_adjust=False,
            actions=True,
            progress=False,
            threads=False,  # IMPORTANT: avoid yfinance threading bugs
            group_by="column",
        )
        df = _standardize(df)
        if df is not None and not df.empty:
            return df
    except Exception:
        pass

    # --- Fallback: Ticker().history ---
    try:
        t = yf.Ticker(ticker)
        df2 = t.history(
            start=start.isoformat(),
            end=end.isoformat(),
            interval="1d",
            auto_adjust=False,
            actions=True,
        )
        df2 = _standardize(df2)
        if df2 is not None and not df2.empty:
            return df2
    except Exception:
        pass

    raise ValueError(f"No price data returned for {ticker} (yfinance failed).")


def fetch_fundamental_snapshot(ticker: str) -> Dict[str, Any]:
    t = yf.Ticker(ticker)
    info = t.info or {}

    keys = [
        "shortName",
        "sector",
        "industry",
        "marketCap",
        "trailingPE",
        "forwardPE",
        "priceToBook",
        "beta",
        "dividendYield",
        "profitMargins",
        "operatingMargins",
        "grossMargins",
        "returnOnAssets",
        "returnOnEquity",
        "revenueGrowth",
        "earningsGrowth",
        "debtToEquity",
        "currentRatio",
        "quickRatio",
        "freeCashflow",
        "operatingCashflow",
    ]

    return {k: info.get(k) for k in keys}


def fetch_latest_price(ticker: str) -> Optional[float]:
    """
    Best-effort latest tradable price (intraday when available).
    Returns None if no valid live price is available.
    """
    try:
        t = yf.Ticker(ticker)
    except Exception:
        return None

    def _as_price(value: Any) -> Optional[float]:
        try:
            num = float(value)
        except Exception:
            return None
        if not pd.notna(num) or num <= 0:
            return None
        return num

    try:
        fast = t.fast_info or {}
        price = _as_price(getattr(fast, "last_price", None))
        if price is not None:
            return price
    except Exception:
        pass

    try:
        info = t.info or {}
        for key in ("regularMarketPrice", "currentPrice", "previousClose"):
            price = _as_price(info.get(key))
            if price is not None:
                return price
    except Exception:
        pass

    return None
