# src/filings/normalize.py
from __future__ import annotations

import re
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from src.filings.statements import Table

_NUM_CLEAN_RE = re.compile(r"[,\s]")
_DATE_PATTERNS = [
    ("%b. %d, %Y", re.compile(r"^[A-Za-z]{3}\.\s+\d{1,2},\s+\d{4}$")),
    ("%b %d, %Y", re.compile(r"^[A-Za-z]{3}\s+\d{1,2},\s+\d{4}$")),
]

def _norm_text(s: str) -> str:
    s = (s or "").strip().lower()
    s = s.replace("’", "'")
    s = re.sub(r"\s+", " ", s)
    return s

def parse_number(cell: str) -> Optional[int]:
    s = (cell or "").strip()
    if not s:
        return None

    s = s.replace("$", "").strip()

    neg = False
    if s.startswith("(") and s.endswith(")"):
        neg = True
        s = s[1:-1].strip()

    s = _NUM_CLEAN_RE.sub("", s)
    if not s or s in {"-", "—"}:
        return None
    if not re.fullmatch(r"-?\d+", s):
        return None

    v = int(s)
    return -v if neg else v

def parse_period(cell: str) -> Optional[str]:
    s = (cell or "").strip()
    if not s:
        return None
    for fmt, rx in _DATE_PATTERNS:
        if rx.match(s):
            dt = datetime.strptime(s, fmt)
            return dt.strftime("%Y-%m-%d")
    return None

def find_period_row(rows: List[List[str]], scan: int = 10) -> Tuple[Optional[int], List[str], List[int]]:
    best_idx: Optional[int] = None
    best_periods: List[str] = []
    best_cols: List[int] = []

    for i, r in enumerate(rows[:scan]):
        cols = [j for j, c in enumerate(r) if parse_period(c)]
        if len(cols) < 2:
            continue
        periods = [parse_period(r[j]) for j in cols]
        periods = [p for p in periods if p]  # type: ignore

        if len(periods) > len(best_periods):
            best_idx = i
            best_periods = periods
            best_cols = cols

    return best_idx, best_periods, best_cols

def is_sectionish(label: str) -> bool:
    t = _norm_text(label)
    if not t:
        return True
    if t.endswith(":"):
        return True
    if "[abstract]" in t:
        return True
    if t in {"current assets", "costs and expenses", "changes in assets and liabilities"}:
        return True
    return False

# normalize.py (replace _MAP_IS with this expanded version)
_MAP_IS: List[Tuple[str, str]] = [
    # Top line (Apple calls it "Net sales")
    (r"^net sales$", "revenue"),
    (r"^total net sales$", "revenue"),
    (r"^revenue$", "revenue"),

    # Costs / profit
    (r"^cost of sales$|^cost of revenue$|^cost of goods sold$", "cogs"),
    (r"^gross margin$|^gross profit$", "gross_profit"),

    # Opex
    (r"^research and development$", "r_and_d"),
    (r"^selling, general and administrative$|^selling, general & administrative$", "sga"),
    (r"^total operating expenses$", "opex_total"),

    # Below the line
    (r"^operating income", "operating_income"),
    (r"^income before income taxes", "pretax_income"),
    (r"^provision for income taxes", "income_tax"),
    (r"^net income$", "net_income"),

    (r"^basic$", "eps_basic"),
    (r"^diluted$", "eps_diluted"),
]

_MAP_BS: List[Tuple[str, str]] = [
    (r"^cash and cash equivalents$", "cash_and_equivalents"),
    (r"^marketable securities$", "marketable_securities"),
    (r"^accounts receivable", "accounts_receivable"),
    (r"^total current assets$", "total_current_assets"),
    (r"^total assets$", "total_assets"),
    (r"^accounts payable$", "accounts_payable"),
    (r"^total current liabilities$", "total_current_liabilities"),
    (r"^total liabilities$", "total_liabilities"),
    (r"^total stockholders' equity$|^total shareholders' equity$", "total_equity"),
    (r"^total liabilities and stockholders' equity$|^total liabilities and shareholders' equity$", "total_liabilities_and_equity"),
]

_MAP_CF: List[Tuple[str, str]] = [
    (r"^net income$", "net_income"),
    (r"^depreciation and amortization$", "depreciation_amortization"),
    (r"^share-based compensation$", "share_based_compensation"),
    (r"^deferred income taxes$", "deferred_taxes"),
    (r"^net cash provided by operating activities$|^net cash (provided|used) by operating activities$", "net_cfo"),
    (r"^net cash (provided|used) by investing activities$", "net_cfi"),
    (r"^net cash (provided|used) by financing activities$", "net_cff"),
    (r"^capital expenditures$|^payments for property and equipment$|^purchases of property and equipment$", "capex"),
    (r"^free cash flow$", "free_cash_flow"),
]

_KIND_MAP = {"is": _MAP_IS, "bs": _MAP_BS, "cf": _MAP_CF}

def map_label_to_key(kind: str, label: str) -> Optional[str]:
    t = _norm_text(label)
    t = t.rstrip(":").strip()
    for pat, key in _KIND_MAP.get(kind, []):
        if re.search(pat, t):
            return key
    return None

def normalize_statement_table(
    tbl: Table,
    kind: str,
    units: Optional[str] = None,
    source_file: Optional[str] = None,
) -> Dict:
    rows = tbl.rows

    hdr_idx, periods, period_col_idxs = find_period_row(rows)
    if not periods or hdr_idx is None or len(period_col_idxs) != len(periods):
        return {
            "kind": kind,
            "units": units,
            "periods": [],
            "items": {},
            "source": {"title": tbl.title, "file": source_file},
            "error": "period_row_not_found",
        }

    hdr_row = rows[hdr_idx]

    items: Dict[str, List[Optional[int]]] = {}

    for r in rows[hdr_idx + 1 :]:
        if not r:
            continue

        label = r[0] if len(r) > 0 else ""
        if is_sectionish(label):
            continue

        key = map_label_to_key(kind, label)
        if not key:
            continue

            # Robust per-row column alignment:
        # Some rows differ in length due to colspans/blank cells, so len()-based shifting is brittle.
        # We choose the smallest shift (0..2) that yields numeric values in/near the first period columns.
        extract_cols = period_col_idxs

        if period_col_idxs:
            best_shift = 0
            for shift in (0, 1, 2):
                hits = 0
                # Check first 2 period cols for numeric parseability after shift
                for c in period_col_idxs[: min(2, len(period_col_idxs))]:
                    idx = c + shift
                    if idx < len(r) and parse_number(r[idx]) is not None:
                        hits += 1
                if hits >= 1:
                    best_shift = shift
                    break

            extract_cols = [c + best_shift for c in period_col_idxs]

        nums: List[Optional[int]] = []
        for col in extract_cols:
            cell = r[col] if col < len(r) else ""
            nums.append(parse_number(cell))

        if any(v is not None for v in nums) and len(nums) == len(periods):
            items[key] = nums

    return {
        "kind": kind,
        "units": units,
        "periods": periods,
        "items": items,
        "source": {"title": tbl.title, "file": source_file},
    }
