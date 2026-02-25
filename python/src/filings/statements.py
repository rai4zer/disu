# src/filings/statements.py
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Dict, Tuple, Any

from bs4 import BeautifulSoup


# ------------------------------------------------------------------------------
# Data model
# ------------------------------------------------------------------------------

@dataclass(frozen=True)
class Table:
    title: str
    rows: List[List[str]]  # already cleaned


# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------

# More permissive: supports decimals (EPS), commas, optional $, optional parentheses
_NUM_RE = re.compile(r"^\(?-?\$?\d[\d,]*(\.\d+)?\)?$")

_DATE_RE = re.compile(r"\b(20\d{2}|19\d{2})\b", re.I)


def _clean_cell(s: str) -> str:
    s = re.sub(r"\s+", " ", s or "").strip()
    s = s.replace("−", "-")
    return s


def _right_trim_empty(row: List[str]) -> List[str]:
    i = len(row)
    while i > 0 and row[i - 1] in ("", "\u00a0"):
        i -= 1
    return row[:i]


def _is_hidden_table(tbl: Any) -> bool:
    style = (tbl.get("style") or "").replace(" ", "").lower()
    if "display:none" in style or "visibility:hidden" in style:
        return True

    for p in tbl.parents:
        if getattr(p, "get", None):
            pstyle = (p.get("style") or "").replace(" ", "").lower()
            if "display:none" in pstyle or "visibility:hidden" in pstyle:
                return True
    return False


def _is_xbrl_def_table(tbl: Any) -> bool:
    classes = set(tbl.get("class") or [])
    if "authRefData" in classes:
        return True
    tid = (tbl.get("id") or "").lower()
    return tid.startswith("defref_")


def _count_numeric_cells(rows: List[List[str]]) -> int:
    n = 0
    for r in rows:
        for c in r:
            if _NUM_RE.match((c or "").replace(" ", "")):
                n += 1
    return n


def _row_has_periods(row: List[str]) -> int:
    # counts year-like tokens; strong signal of a period header
    return sum(1 for c in row if _DATE_RE.search(c or ""))


def _estimate_numeric_cols(rows: List[List[str]], scan_rows: int = 10) -> int:
    """
    Estimate how many columns look numeric by counting columns that have >=2 numeric
    cells within the first `scan_rows` rows.
    """
    if not rows:
        return 0
    max_cols = max(len(r) for r in rows[:scan_rows])
    hits = [0] * max_cols
    for r in rows[:scan_rows]:
        for j, c in enumerate(r):
            if j < len(hits) and _NUM_RE.match((c or "").replace(" ", "")):
                hits[j] += 1
    return sum(1 for h in hits if h >= 2)


def _find_period_header(rows: List[List[str]], scan: int = 12) -> Tuple[Optional[int], List[int]]:
    """
    Returns (row_index, period_col_indices).
    Periods are detected by presence of year tokens (e.g., 2025) or date strings containing years.
    """
    best_i: Optional[int] = None
    best_cols: List[int] = []
    for i, r in enumerate(rows[:scan]):
        cols = [j for j, c in enumerate(r) if _DATE_RE.search(c or "")]
        if len(cols) >= 2 and len(cols) > len(best_cols):
            best_i = i
            best_cols = cols
    return best_i, best_cols


# ------------------------------------------------------------------------------
# HTML parsing
# ------------------------------------------------------------------------------

def _parse_html_tables(html: str) -> List[Table]:
    soup = BeautifulSoup(html, "lxml")

    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    out: List[Table] = []

    for idx, tbl in enumerate(soup.find_all("table")):
        if _is_hidden_table(tbl) or _is_xbrl_def_table(tbl):
            continue

        title = ""

        cap = tbl.find("caption")
        if cap:
            title = _clean_cell(cap.get_text(" ", strip=True))

        rows: List[List[str]] = []
        for tr in tbl.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            row = [_clean_cell(c.get_text(" ", strip=True)) for c in cells]
            row = _right_trim_empty(row)
            if any(row):
                rows.append(row)

        if len(rows) < 3:
            continue

        # infer title from first row if needed
        if not title and rows:
            first = " ".join(rows[0])
            if any(k in first.lower() for k in ["statement", "statements", "balance", "cash", "income", "operations", "earnings"]):
                title = first[:180].strip()

        out.append(Table(title=title or f"table_{idx}", rows=rows))

    return out


# ------------------------------------------------------------------------------
# Public extraction
# ------------------------------------------------------------------------------

def extract_statement_table_from_statement_html(statement_html: str) -> Optional[Table]:
    """
    Pick the most likely *primary* visible statement table from a statement HTML file.

    Old behavior (numeric_cells, row_count) is too easy to hijack by supplemental tables.
    New behavior prioritizes:
      - period header signal (years/dates in a header row)
      - >=2 numeric columns
      - numeric density
      - title/header keyword match ("consolidated", etc.)
    """
    tables = _parse_html_tables(statement_html)
    if not tables:
        return None

    def score(t: Table) -> Tuple[int, int, int, int]:
        rows = t.rows

        period_signal = max((_row_has_periods(r) for r in rows[:6]), default=0)
        numeric_cols = _estimate_numeric_cols(rows, scan_rows=10)
        numeric_cells = _count_numeric_cells(rows)

        title_blob = (t.title or "").lower()
        title_signal = 0
        if any(k in title_blob for k in ["income", "operations", "earnings", "balance", "financial position", "cash flow", "cash flows"]):
            title_signal += 1
        if "consolidated" in title_blob:
            title_signal += 1

        # prioritize: period header > numeric_cols > numeric_cells > rows (+ title bump)
        return (period_signal, numeric_cols, numeric_cells, len(rows) + 10 * title_signal)

    best = max(tables, key=score)

    ps, ncols, _, _ = score(best)
    # sanity: must resemble a statement: >=2 numeric cols; period signal helps but isn't strictly required
    if ncols < 2:
        return None
    # If we have *zero* period signal and weak numeric cols, it's probably not the main statement
    if ps == 0 and ncols < 3:
        return None

    return best


def infer_units_from_statement_html(statement_html: str) -> Optional[str]:
    text = BeautifulSoup(statement_html, "lxml").get_text(" ", strip=True).lower()
    if "in millions" in text or "$ in millions" in text:
        return "USD millions"
    if "in thousands" in text or "$ in thousands" in text:
        return "USD thousands"
    return None


# ------------------------------------------------------------------------------
# Condensing
# ------------------------------------------------------------------------------

_CANON_ROWS: Dict[str, List[Tuple[str, str]]] = {
    "is": [
    # Top line
    (r"^net sales$|^total net sales$|^revenue$|^total revenue$", "Net sales"),

    # Cost line
    (r"^cost of sales$|^cost of (revenue|goods)$|^cost of goods sold$", "Cost of sales"),

    # Gross line
    (r"^gross margin$|^gross profit$", "Gross profit"),

    # Operating expense components
    (r"^research and development$", "R&D"),
    (r"^selling, general and administrative$", "SG&A"),
    (r"^total operating expenses$", "Total operating expenses"),

    # Operating result
    (r"^operating (income|loss)$", "Operating income"),

    # Below operating
    (r"^income before (income )?tax", "Pre-tax income"),
    (r"^provision for income taxes$|^income tax$", "Income tax"),
    (r"^net (income|loss)$", "Net income"),

    # EPS
    (r"^basic$", "EPS (basic)"),
    (r"^diluted$", "EPS (diluted)"),
],
    "bs": [
        (r"^cash and cash equivalents", "Cash & equivalents"),
        (r"^marketable securities", "Marketable securities"),
        (r"^total current assets", "Total current assets"),
        (r"^total assets", "Total assets"),
        (r"^total current liabilities", "Total current liabilities"),
        (r"^total liabilities$", "Total liabilities"),
        (r"^total (stockholders|shareholders)('?|’) equity", "Total equity"),
        (r"^total liabilities and (stockholders|shareholders)('?|’) equity", "Total liab & equity"),
    ],
    "cf": [
        (r"^net (income|loss)$", "Net income"),
        (r"^depreciation and amortization", "D&A"),
        (r"^share-?based compensation", "SBC"),
        (r"^net cash (provided|used) by operating activities", "Net cash from operations"),
        (r"^payments for property and equipment|^purchases of property and equipment|^capital expenditures", "Capex"),
        (r"^net cash (provided|used) by investing activities", "Net cash from investing"),
        (r"^net cash (provided|used) by financing activities", "Net cash from financing"),
    ],
}


def _condense_table_truncate(tbl: Table, max_lines: int = 14, max_cols: int = 3) -> Table:
    trimmed = [r[:max_cols] for r in tbl.rows[:max_lines]]
    return Table(title=tbl.title, rows=trimmed)


def _norm_label(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower()).rstrip(":").strip()


def _match_row(label: str, patterns: List[Tuple[str, str]]) -> Optional[str]:
    t = _norm_label(label)
    if not t:
        return None
    for pat, pretty in patterns:
        if re.search(pat, t):
            return pretty
    return None


def condense_statement_table(
    tbl: Optional[Table], kind: str, max_lines: int = 14, max_cols: int = 3
) -> Optional[Table]:
    """
    Produce a compact, stable table for PDF rendering.

    Strategy:
      1) find a period header row and its period columns
      2) keep label + up to `max_cols` period columns
      3) select a canonical set of line items via regex (kind-specific)
      4) if matching fails, fall back to truncation
    """
    if not tbl:
        return None

    rows = tbl.rows
    hdr_i, period_cols = _find_period_header(rows, scan=12)

    # fallback if period columns cannot be found
    if hdr_i is None or len(period_cols) < 2:
        condensed = _condense_table_truncate(tbl, max_lines=max_lines, max_cols=max_cols)
        title = condensed.title.strip() or {"is": "Income Statement", "bs": "Balance Sheet", "cf": "Cash Flow"}.get(kind, "Statement")
        return Table(title=title, rows=condensed.rows)

    # Choose up to max_cols period columns
    period_cols = period_cols[:max_cols]

    hdr = rows[hdr_i]
    out_rows: List[List[str]] = []

    # If header row starts with a period (date/year), it means there is no label column in the header.
    # In that case, force a blank label header so dates align above numeric columns.
    label_header = hdr[0] if len(hdr) > 0 else ""
    if period_cols and period_cols[0] == 0 and _DATE_RE.search(label_header or ""):
        label_header = ""

    out_rows.append([label_header] + [hdr[c] if c < len(hdr) else "" for c in period_cols])

    patterns = _CANON_ROWS.get(kind, [])
    seen = set()

    for r in rows[hdr_i + 1 :]:
        if not r or len(r) < 2:
            continue
        label = r[0]
        pretty = _match_row(label, patterns)
        if not pretty or pretty in seen:
            continue

        extract_cols = period_cols

        # If header periods start at col 0 but data rows include a leading label col,
        # shift extraction right by 1 (same fix as normalize.py).
        if (
            period_cols
            and period_cols[0] == 0
            and len(hdr) > 0
            and _DATE_RE.search(hdr[0] or "")
            and len(r) == len(hdr) + 1
        ):
            extract_cols = [c + 1 for c in period_cols]

        vals = [(r[c] if c < len(r) else "") for c in extract_cols]

        # require at least one numeric-ish value
        if not any(v and _NUM_RE.match((v or "").replace(" ", "")) for v in vals):
            continue

        out_rows.append([pretty] + vals)
        seen.add(pretty)

        if len(out_rows) >= max_lines:
            break

    # If we captured too little, the issuer labels likely differ; fall back to truncation
    if len(out_rows) < 5:
        condensed = _condense_table_truncate(tbl, max_lines=max_lines, max_cols=max_cols)
        title = condensed.title.strip() or {"is": "Income Statement", "bs": "Balance Sheet", "cf": "Cash Flow"}.get(kind, "Statement")
        return Table(title=title, rows=condensed.rows)

    title = (tbl.title or "").strip() or {"is": "Income Statement", "bs": "Balance Sheet", "cf": "Cash Flow"}.get(kind, "Statement")
    return Table(title=title, rows=out_rows)


# ------------------------------------------------------------------------------
# Classification
# ------------------------------------------------------------------------------

_KIND_KEYWORDS = {
    "bs": ["balance sheet", "balance sheets", "assets", "liabilities", "equity", "financial position"],
    "is": ["statements of income", "statement of income", "revenue", "net income", "earnings", "operations"],
    "cf": ["cash flows", "cash flow", "operating activities", "investing activities", "financing activities"],
}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def infer_kind_from_table(tbl: Table) -> Optional[str]:
    blob = _norm(
        " ".join(
            [tbl.title]
            + ([" ".join(tbl.rows[0])] if tbl.rows else [])
        )
    )

    scores = {k: 0 for k in _KIND_KEYWORDS}
    for kind, kws in _KIND_KEYWORDS.items():
        for kw in kws:
            if kw in blob:
                scores[kind] += 1

    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else None


# ------------------------------------------------------------------------------
# Filing-level extraction (utility)
# ------------------------------------------------------------------------------

def extract_statements_from_filing_dir(
    filing_dir: str,
) -> Dict[str, Tuple[Table, Optional[str], str]]:
    from pathlib import Path

    out: Dict[str, Tuple[Table, Optional[str], str]] = {}
    dirp = Path(filing_dir)

    for f in sorted(dirp.glob("stmt_R*.htm")):
        html = f.read_text(encoding="utf-8", errors="ignore")
        tbl = extract_statement_table_from_statement_html(html)
        if not tbl:
            continue

        kind = infer_kind_from_table(tbl)
        if not kind:
            continue

        units = infer_units_from_statement_html(html)

        # Prefer more descriptive titles if duplicates exist
        if kind in out:
            prev_tbl, _, _ = out[kind]
            if len((tbl.title or "")) <= len((prev_tbl.title or "")):
                continue

        out[kind] = (tbl, units, f.name)

    return out
