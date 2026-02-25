# src/filings/analysis.py
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# -----------------------------
# Helpers: safe math + formatting
# -----------------------------
def pct_change(current: Optional[float], prior: Optional[float]) -> Optional[float]:
    if current is None or prior is None or prior == 0:
        return None
    return (current / prior - 1.0) * 100.0


def bps_change(current_pct: Optional[float], prior_pct: Optional[float]) -> Optional[int]:
    if current_pct is None or prior_pct is None:
        return None
    return int(round((current_pct - prior_pct) * 100))  # 1% = 100 bps


def safe_div(n: Optional[float], d: Optional[float]) -> Optional[float]:
    if n is None or d is None or d == 0:
        return None
    return n / d


def fmt_num(x: Optional[float]) -> str:
    if x is None:
        return "NA"
    if abs(x) >= 1000:
        return f"{x:,.0f}"
    return f"{x:,.2f}".rstrip("0").rstrip(".")


def fmt_pct(x: Optional[float]) -> str:
    if x is None:
        return "NA"
    return f"{x:.2f}%"


def fmt_bps(x: Optional[int]) -> str:
    if x is None:
        return "NA"
    sign = "+" if x > 0 else ""
    return f"{sign}{x} bps"


def to_number(x: Any) -> Optional[float]:
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    if isinstance(x, str):
        s = x.strip().replace(",", "")
        if s in ("", "-", "—"):
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def read_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


# -----------------------------
# Schema: { periods: [...], items: { key: [..] } }
# -----------------------------
def pick_current_prior_periods(periods: List[str]) -> Tuple[Optional[str], Optional[str], int, int]:
    """
    Assumes periods are ISO dates and ordered newest -> oldest (normalize.py returns header order).
    We treat index 0 as current, 1 as prior.
    """
    if not periods or len(periods) < 2:
        return None, None, 0, 1
    return periods[0], periods[1], 0, 1


def get_item(items: Dict[str, List[Any]], key: str, idx: int) -> Optional[float]:
    arr = items.get(key)
    if not arr or idx >= len(arr):
        return None
    return to_number(arr[idx])


def compute_income_metrics(is_stmt: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    missing: List[str] = []

    periods = is_stmt.get("periods") or []
    items = is_stmt.get("items") or {}

    p_cur, p_pri, i_cur, i_pri = pick_current_prior_periods(periods)

    revenue_c = get_item(items, "revenue", i_cur)
    revenue_p = get_item(items, "revenue", i_pri)
    if revenue_c is None or revenue_p is None:
        missing.append("revenue")

    cogs_c = get_item(items, "cogs", i_cur)
    cogs_p = get_item(items, "cogs", i_pri)

    gross_profit_c = get_item(items, "gross_profit", i_cur)
    gross_profit_p = get_item(items, "gross_profit", i_pri)

    # Derive GP if needed
    if gross_profit_c is None and revenue_c is not None and cogs_c is not None:
        gross_profit_c = revenue_c - cogs_c
    if gross_profit_p is None and revenue_p is not None and cogs_p is not None:
        gross_profit_p = revenue_p - cogs_p

    r_and_d_c = get_item(items, "r_and_d", i_cur) or get_item(items, "research_and_development", i_cur)
    r_and_d_p = get_item(items, "r_and_d", i_pri) or get_item(items, "research_and_development", i_pri)

    sga_c = get_item(items, "sga", i_cur)
    sga_p = get_item(items, "sga", i_pri)

    opex_c = get_item(items, "opex_total", i_cur)
    opex_p = get_item(items, "opex_total", i_pri)
    if opex_c is None and r_and_d_c is not None and sga_c is not None:
        opex_c = r_and_d_c + sga_c
    if opex_p is None and r_and_d_p is not None and sga_p is not None:
        opex_p = r_and_d_p + sga_p

    op_inc_c = get_item(items, "operating_income", i_cur)
    op_inc_p = get_item(items, "operating_income", i_pri)

    net_inc_c = get_item(items, "net_income", i_cur)
    net_inc_p = get_item(items, "net_income", i_pri)

    # --- Sanity gating: prevent impossible ratios from bad parsing ---
    sanity_failed = False
    if revenue_c is not None:
        if gross_profit_c is not None and gross_profit_c > revenue_c:
            sanity_failed = True
        if net_inc_c is not None and net_inc_c > revenue_c:
            sanity_failed = True
        if op_inc_c is not None and op_inc_c > revenue_c:
            sanity_failed = True

    if sanity_failed:
        revenue_c, revenue_p = None, None
        missing.append("revenue_sanity_failed")

    # Additional hard bounds: prevent >100% margins from ever being emitted
    if revenue_c is not None and revenue_c > 0:
        gm_test = safe_div(gross_profit_c, revenue_c)
        opm_test = safe_div(op_inc_c, revenue_c)
        nm_test = safe_div(net_inc_c, revenue_c)

        for ratio in (gm_test, opm_test, nm_test):
            if ratio is not None and (ratio < -1.0 or ratio > 1.0):
                revenue_c, revenue_p = None, None
                missing.append("revenue_ratio_bounds_failed")
                break

    # COGS sanity: if it's far larger than revenue, something is misparsed
    if revenue_c is not None and cogs_c is not None and revenue_c > 0:
        if cogs_c > revenue_c * 1.5:
            revenue_c, revenue_p = None, None
            missing.append("cogs_sanity_failed")

    gm_c = None if revenue_c is None else safe_div(gross_profit_c, revenue_c)
    gm_p = None if revenue_p is None else safe_div(gross_profit_p, revenue_p)

    opm_c = None if revenue_c is None else safe_div(op_inc_c, revenue_c)
    opm_p = None if revenue_p is None else safe_div(op_inc_p, revenue_p)

    nm_c = None if revenue_c is None else safe_div(net_inc_c, revenue_c)
    nm_p = None if revenue_p is None else safe_div(net_inc_p, revenue_p)

    out = {
        "period_current": p_cur,
        "period_prior": p_pri,
        "revenue": {"current": revenue_c, "prior": revenue_p, "yoy_pct": pct_change(revenue_c, revenue_p)},
        "gross_margin_pct": {
            "current": None if gm_c is None else gm_c * 100.0,
            "prior": None if gm_p is None else gm_p * 100.0,
            "yoy_bps": bps_change(None if gm_c is None else gm_c * 100.0, None if gm_p is None else gm_p * 100.0),
        },
        "r_and_d": {"current": r_and_d_c, "prior": r_and_d_p, "yoy_pct": pct_change(r_and_d_c, r_and_d_p)},
        "sga": {"current": sga_c, "prior": sga_p, "yoy_pct": pct_change(sga_c, sga_p)},
        "opex_total": {"current": opex_c, "prior": opex_p, "yoy_pct": pct_change(opex_c, opex_p)},
        "operating_income": {"current": op_inc_c, "prior": op_inc_p, "yoy_pct": pct_change(op_inc_c, op_inc_p)},
        "operating_margin_pct": {
            "current": None if opm_c is None else opm_c * 100.0,
            "prior": None if opm_p is None else opm_p * 100.0,
            "yoy_bps": bps_change(None if opm_c is None else opm_c * 100.0, None if opm_p is None else opm_p * 100.0),
        },
        "net_income": {"current": net_inc_c, "prior": net_inc_p, "yoy_pct": pct_change(net_inc_c, net_inc_p)},
        "net_margin_pct": {
            "current": None if nm_c is None else nm_c * 100.0,
            "prior": None if nm_p is None else nm_p * 100.0,
            "yoy_bps": bps_change(None if nm_c is None else nm_c * 100.0, None if nm_p is None else nm_p * 100.0),
        },
    }
    return out, missing


def compute_balance_metrics(bs_stmt: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    missing: List[str] = []
    periods = bs_stmt.get("periods") or []
    items = bs_stmt.get("items") or {}

    p_cur, p_pri, i_cur, i_pri = pick_current_prior_periods(periods)

    cash_c = get_item(items, "cash_and_equivalents", i_cur)
    cash_p = get_item(items, "cash_and_equivalents", i_pri)

    assets_c = get_item(items, "total_assets", i_cur)
    liab_c = get_item(items, "total_liabilities", i_cur)

    equity_c = get_item(items, "total_equity", i_cur)

    out = {
        "period_current": p_cur,
        "period_prior": p_pri,
        "cash_and_equivalents": {"current": cash_c, "prior": cash_p, "qoq_pct": pct_change(cash_c, cash_p)},
        "total_assets": {"current": assets_c},
        "total_liabilities": {"current": liab_c},
        "total_equity": {"current": equity_c},
    }

    if assets_c is None:
        missing.append("total_assets")
    if liab_c is None:
        missing.append("total_liabilities")

    return out, missing


def compute_cashflow_metrics(cf_stmt: Dict[str, Any], revenue_current: Optional[float]) -> Tuple[Dict[str, Any], List[str]]:
    missing: List[str] = []
    periods = cf_stmt.get("periods") or []
    items = cf_stmt.get("items") or {}

    p_cur, p_pri, i_cur, i_pri = pick_current_prior_periods(periods)

    cfo = get_item(items, "net_cfo", i_cur)
    capex = get_item(items, "capex", i_cur)

    if cfo is None:
        missing.append("net_cfo")
    if capex is None:
        missing.append("capex")

    fcf = None
    if cfo is not None and capex is not None:
        fcf = cfo + capex if capex < 0 else cfo - capex

    out = {
        "period_current": p_cur,
        "period_prior": p_pri,
        "net_cfo": {"current": cfo},
        "capex": {"current": capex},
        "fcf": {"current": fcf},
        "cfo_margin_pct": None if cfo is None or revenue_current is None else (cfo / revenue_current) * 100.0,
        "capex_margin_pct": None if capex is None or revenue_current is None else (abs(capex) / revenue_current) * 100.0,
        "fcf_margin_pct": None if fcf is None or revenue_current is None else (fcf / revenue_current) * 100.0,
    }
    return out, missing


def build_facts_block(is_metrics: Dict[str, Any], units: str) -> List[str]:
    rev = is_metrics.get("revenue", {})
    gm = is_metrics.get("gross_margin_pct", {})
    rnd = is_metrics.get("r_and_d", {})
    sga = is_metrics.get("sga", {})
    opex = is_metrics.get("opex_total", {})
    opm = is_metrics.get("operating_margin_pct", {})
    nm = is_metrics.get("net_margin_pct", {})

    facts: List[str] = []
    facts.append(
        f"Revenue {fmt_pct(rev.get('yoy_pct'))} YoY "
        f"({fmt_num(rev.get('current'))} vs {fmt_num(rev.get('prior'))}, {units})."
    )
    facts.append(f"Gross margin {fmt_pct(gm.get('current'))} ({fmt_bps(gm.get('yoy_bps'))} YoY).")
    facts.append(
        f"R&D {fmt_pct(rnd.get('yoy_pct'))} YoY; "
        f"SG&A {fmt_pct(sga.get('yoy_pct'))} YoY; "
        f"Total opex {fmt_pct(opex.get('yoy_pct'))} YoY."
    )
    facts.append(
        f"Operating margin {fmt_pct(opm.get('current'))} ({fmt_bps(opm.get('yoy_bps'))} YoY); "
        f"Net margin {fmt_pct(nm.get('current'))} ({fmt_bps(nm.get('yoy_bps'))} YoY)."
    )
    return facts


def compute_derived_metrics(
    ticker: str,
    form: str,
    filing_date: str,
    statements_normalized_path: Path,
    output_path: Path,
) -> Dict[str, Any]:
    stmts = read_json(statements_normalized_path)

    is_stmt = stmts.get("income_statement") or stmts.get("is") or {}
    bs_stmt = stmts.get("balance_sheet") or stmts.get("bs") or {}
    cf_stmt = stmts.get("cash_flow") or stmts.get("cf") or {}

    is_metrics, miss_is = compute_income_metrics(is_stmt)
    revenue_current = is_metrics.get("revenue", {}).get("current")

    bs_metrics, miss_bs = compute_balance_metrics(bs_stmt)
    cf_metrics, miss_cf = compute_cashflow_metrics(cf_stmt, revenue_current=revenue_current)

    missing_fields = sorted(set(miss_is + miss_bs + miss_cf))
    confidence = "high"
    if len(missing_fields) >= 3:
        confidence = "medium"
    if "revenue" in missing_fields:
        confidence = "low"

    units = stmts.get("units") or "USD"
    facts_block = build_facts_block(is_metrics, units=units)

    out = {
        "ticker": ticker,
        "form": form,
        "filing_date": filing_date,
        "period_current": is_metrics.get("period_current"),
        "period_prior": is_metrics.get("period_prior"),
        "units": units,
        "income_statement": is_metrics,
        "balance_sheet": bs_metrics,
        "cash_flow": cf_metrics,
        "flags": {"missing_fields": missing_fields, "confidence": confidence},
        "facts_block": facts_block,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    return out
