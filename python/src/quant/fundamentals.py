from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Dict, List, Tuple

import numpy as np
import pandas as pd
import yfinance as yf


# ---------------------------
# Helpers: normalize Yahoo statements
# ---------------------------

def _safe_statement_to_timeseries(stmt: Optional[pd.DataFrame]) -> pd.DataFrame:
    """
    yfinance statements typically come as:
      index = line items, columns = period end dates
    We transpose to:
      index = period end dates, columns = line items
    """
    if stmt is None or not isinstance(stmt, pd.DataFrame) or stmt.empty:
        return pd.DataFrame()

    df = stmt.copy()
    # Some yfinance versions have duplicate columns or non-datetime cols
    df = df.loc[:, ~df.columns.duplicated()]
    df = df.T
    df.index = pd.to_datetime(df.index, errors="coerce")
    df = df[~df.index.isna()]
    df = df.sort_index()
    return df


def _pick_first_existing_col(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    for c in candidates:
        if c in df.columns:
            return c
    return None


def _coerce_numeric(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")


def _standardize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """
    Keep the raw columns but ensure consistent casing (Yahoo varies).
    We'll reference multiple candidate names below.
    """
    # Some columns are objects; keep as-is but ensure unique columns
    df = df.loc[:, ~df.columns.duplicated()].copy()
    return df


# ---------------------------
# Public API
# ---------------------------

@dataclass
class FundamentalsResult:
    ticker: str
    quarterly: pd.DataFrame  # index = period end date (quarter), columns = standardized fundamentals


def fetch_quarterly_fundamentals(ticker: str) -> FundamentalsResult:
    """
    Fetch quarterly fundamentals from Yahoo via yfinance.
    Returns a quarterly DataFrame indexed by period-end date (quarter).
    This is "best effort" with robust fallbacks.

    Output columns (when available):
      revenue
      net_income
      eps_diluted
      shares_diluted
      equity
      roe   (net_income / avg_equity)
    """
    t = yf.Ticker(ticker)

    # Income statement
    income_raw = None
    for attr in ("quarterly_income_stmt", "quarterly_financials"):
        income_raw = getattr(t, attr, None)
        if isinstance(income_raw, pd.DataFrame) and not income_raw.empty:
            break

    income = _safe_statement_to_timeseries(income_raw)
    income = _standardize_columns(income)

    # Balance sheet
    bs_raw = getattr(t, "quarterly_balance_sheet", None)
    bs = _safe_statement_to_timeseries(bs_raw)
    bs = _standardize_columns(bs)

    # If both empty, fail early with a clear message
    if income.empty and bs.empty:
        raise ValueError(f"No quarterly fundamentals available for {ticker} via yfinance.")

    # Union index (quarter ends)
    idx = income.index.union(bs.index).sort_values()
    q = pd.DataFrame(index=idx)

    # ---- Income fields ----
    # Revenue
    rev_col = _pick_first_existing_col(
        income,
        candidates=[
            "Total Revenue",
            "TotalRevenue",
            "totalRevenue",
            "Revenue",
            "revenues",
        ],
    )
    if rev_col:
        q["revenue"] = _coerce_numeric(income[rev_col])

    # Net income
    ni_col = _pick_first_existing_col(
        income,
        candidates=[
            "Net Income",
            "NetIncome",
            "netIncome",
            "NetIncomeCommonStockholders",
            "Net Income Common Stockholders",
        ],
    )
    if ni_col:
        q["net_income"] = _coerce_numeric(income[ni_col])

    # EPS diluted (often missing in Yahoo statements)
    eps_col = _pick_first_existing_col(
        income,
        candidates=[
            "Diluted EPS",
            "DilutedEPS",
            "dilutedEPS",
            "Basic EPS",  # fallback
            "BasicEPS",
            "basicEPS",
        ],
    )
    if eps_col:
        q["eps_diluted"] = _coerce_numeric(income[eps_col])

    # Shares (sometimes present)
    shares_col = _pick_first_existing_col(
        income,
        candidates=[
            "Diluted Average Shares",
            "DilutedAverageShares",
            "dilutedAverageShares",
            "Basic Average Shares",
            "BasicAverageShares",
            "basicAverageShares",
        ],
    )
    if shares_col:
        q["shares_diluted"] = _coerce_numeric(income[shares_col])

    # Infer shares if missing but NI and EPS exist
    if "shares_diluted" not in q.columns:
        q["shares_diluted"] = np.nan

    if "net_income" in q.columns and "eps_diluted" in q.columns:
        inferred = q["net_income"] / q["eps_diluted"]
        # Guard against nonsense when EPS ~ 0 or missing
        inferred = inferred.where(np.isfinite(inferred) & (np.abs(inferred) > 0))
        q["shares_diluted"] = q["shares_diluted"].fillna(inferred)

    # ---- Balance sheet fields ----
    equity_col = _pick_first_existing_col(
        bs,
        candidates=[
            "Total Stockholder Equity",
            "TotalStockholderEquity",
            "totalStockholderEquity",
            "Stockholders Equity",
            "StockholdersEquity",
            "stockholdersEquity",
            "Total Equity Gross Minority Interest",
        ],
    )
    if equity_col:
        q["equity"] = _coerce_numeric(bs[equity_col])

    # ---- Derived metrics ----
    # ROE: net_income / average equity (simple quarter approximation)
    if "net_income" in q.columns and "equity" in q.columns:
        avg_equity = (q["equity"] + q["equity"].shift(1)) / 2.0
        q["roe"] = q["net_income"] / avg_equity
    else:
        q["roe"] = np.nan

    # Clean
    q = q.sort_index()
    q = q.replace([np.inf, -np.inf], np.nan)

    return FundamentalsResult(ticker=ticker, quarterly=q)


def asof_merge_fundamentals(
    daily_index: pd.DatetimeIndex,
    quarterly: pd.DataFrame,
    columns: Optional[List[str]] = None,
) -> pd.DataFrame:
    """
    Point-in-time merge:
    - For each daily date, attach the latest available quarterly fundamentals
      with period_end <= daily_date.
    """
    if quarterly is None or quarterly.empty:
        return pd.DataFrame(index=daily_index)

    q = quarterly.copy()
    q = q[columns] if columns else q
    q = q.sort_index()

    d = pd.DataFrame({"date": pd.to_datetime(daily_index)})
    q2 = q.reset_index().rename(columns={"index": "date"})
    q2["date"] = pd.to_datetime(q2["date"])

    merged = pd.merge_asof(
        d.sort_values("date"),
        q2.sort_values("date"),
        on="date",
        direction="backward",
        allow_exact_matches=True,
    )
    merged = merged.set_index("date")
    merged = merged.reindex(pd.to_datetime(daily_index))
    return merged


def add_quarterly_growth_features(q: pd.DataFrame) -> pd.DataFrame:
    """
    Optional helper: compute YoY growth & acceleration on quarterly series.
    Uses YoY because quarter-to-quarter is noisy/seasonal.
    """
    if q is None or q.empty:
        return pd.DataFrame(index=pd.Index([]))

    out = q.copy()

    # YoY growth: current quarter vs same quarter last year (shift 4)
    for col in ["revenue", "net_income", "eps_diluted"]:
        if col in out.columns:
            out[f"{col}_yoy"] = out[col] / out[col].shift(4) - 1.0
            out[f"{col}_accel"] = out[f"{col}_yoy"] - out[f"{col}_yoy"].shift(1)

    if "roe" in out.columns:
        out["roe_delta"] = out["roe"] - out["roe"].shift(1)

    out = out.replace([np.inf, -np.inf], np.nan)
    return out
