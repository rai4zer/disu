# src/filings/segments.py
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Tuple

from bs4 import BeautifulSoup


@dataclass(frozen=True)
class Segment:
    name: str
    value: float  # numeric (as parsed)
    pct: float


@dataclass(frozen=True)
class SegmentBreakdown:
    label: str
    segments: List[Segment]


_NUM = re.compile(r"[-]?\d[\d,]*\.?\d*")


def _parse_number(s: str) -> Optional[float]:
    s = (s or "").replace("−", "-")
    m = _NUM.search(s.replace(",", ""))
    if not m:
        return None
    try:
        return float(m.group(0))
    except Exception:
        return None


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def extract_segments_from_primary_html(primary_html: str) -> Optional[SegmentBreakdown]:
    """
    Heuristic HTML approach:
    - Find a table with 'segment'/'reportable' and looks like a breakdown.
    - Use first column as names + one numeric column as values.
    """
    soup = BeautifulSoup(primary_html, "lxml")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    candidate_tables = soup.find_all("table")

    best: Optional[Tuple[int, List[List[str]], str]] = None  # (score, rows, label)

    for tbl in candidate_tables:
        rows = []
        for tr in tbl.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            row = [_clean(c.get_text(" ", strip=True)) for c in cells]
            if any(row):
                rows.append(row)
        if len(rows) < 4:
            continue

        blob = " ".join(" ".join(r) for r in rows[:6]).lower()

             # --- HARD REJECTS (EPS tables etc.) ---
        hard_bad = ["earnings per share", "basic", "diluted", "net income per share"]
        if any(b in blob for b in hard_bad):
            continue

        score = 0

        # must look like sales/revenue breakdown
        if "net sales" in blob or "revenue" in blob:
            score += 4

        # segment-ish anchors
        if "segment" in blob or "reportable" in blob:
            score += 3

        # apple-specific segment/geography/product anchors (helps a lot)
        anchors = [
            "americas", "europe", "greater china", "japan", "rest of asia pacific",
            "products", "services"
        ]
        score += 2 * sum(1 for a in anchors if a in blob)

        if "total" in blob:
            score += 1

        # avoid obvious non-segment tables
        bad = ["cash flow", "balance sheet", "statement of operations", "maturities", "thereafter", "debt"]
        score -= 3 * sum(1 for b in bad if b in blob)


        if best is None or score > best[0]:
            best = (score, rows, "Operating Segments")

    if not best or best[0] < 3:
        return None

    _, rows, label = best

    # find a numeric column by scanning row 2..n for numbers
    ncols = max(len(r) for r in rows)
    col_scores = [0] * ncols
    for r in rows[1:]:
        for j in range(min(len(r), ncols)):
            if _parse_number(r[j]) is not None:
                col_scores[j] += 1

    # assume col 0 is names; pick best numeric column != 0
    num_col = max(range(1, ncols), key=lambda j: col_scores[j], default=1)
    if col_scores[num_col] < 2:
        return None

    raw = []
    for r in rows[1:]:
        if len(r) <= num_col:
            continue
        name = r[0]
        val = _parse_number(r[num_col])
        if not name or val is None:
            continue
        if name.lower().strip() in ("total", "totals"):
            continue
        raw.append((name, val))

    if len(raw) < 2:
        return None

    total = sum(v for _, v in raw)
    if total <= 0:
        return None

    segments = [Segment(name=n, value=v, pct=(v / total) * 100.0) for n, v in raw]
    # sort descending
    segments.sort(key=lambda s: s.value, reverse=True)

    return SegmentBreakdown(label=label, segments=segments)
