import re
from dataclasses import dataclass
from typing import Dict

@dataclass(frozen=True)
class ExtractedSections:
    sections: Dict[str, str]


# We support both 10-K and 10-Q:
# - 10-K: Item 1 (Business), 1A (Risk Factors), 7 (MD&A), 8 (Financial Statements)
# - 10-Q: Item 1 (Financial Statements), 1A (Risk Factors), 2 (MD&A), 3 (Quantitative & Qualitative),
#         4 (Controls & Procedures)
#
# We map multiple possible headings into a single canonical key (mda, financial_statements, etc.).
ITEM_PATTERNS = [
    # --- Business (10-K) ---
    ("business", r"\bITEM\s+1\.*\s+BUSINESS\b"),

    # --- Risk Factors (10-K/10-Q sometimes) ---
    ("risk_factors", r"\bITEM\s+1A\.*\s+RISK\s+FACTORS\b"),

    # --- MD&A ---
    # 10-Q: Item 2. 10-K: Item 7.
    ("mda", r"\bITEM\s+2\.*\s+MANAGEMENT[’']?S\s+DISCUSSION\s+AND\s+ANALYSIS\b"),
    ("mda", r"\bITEM\s+7\.*\s+MANAGEMENT[’']?S\s+DISCUSSION\s+AND\s+ANALYSIS\b"),

    # --- Financial statements ---
    # 10-Q: Item 1. 10-K: Item 8.
    ("financial_statements", r"\bITEM\s+1\.*\s+FINANCIAL\s+STATEMENTS\b"),
    ("financial_statements", r"\bITEM\s+8\.*\s+FINANCIAL\s+STATEMENTS\b"),

    # Optional useful sections (kept for later allowlisting)
    ("quantitative_qualitative", r"\bITEM\s+3\.*\s+QUANTITATIVE\s+AND\s+QUALITATIVE\b"),
    ("controls_procedures", r"\bITEM\s+4\.*\s+CONTROLS\s+AND\s+PROCEDURES\b"),
]


def _find_positions(text_upper: str, start_at: int = 0) -> Dict[str, int]:
    """
    Find earliest occurrence of each canonical key at/after start_at.
    If multiple patterns map to the same key (e.g. mda), keep the earliest.
    """
    pos: Dict[str, int] = {}
    sub = text_upper[start_at:]

    for key, pat in ITEM_PATTERNS:
        m = re.search(pat, sub, flags=re.IGNORECASE)
        if not m:
            continue
        abs_pos = start_at + m.start()
        if key not in pos or abs_pos < pos[key]:
            pos[key] = abs_pos

    return pos


def extract_key_sections(clean_text: str) -> ExtractedSections:
    t = clean_text
    U = t.upper()

    # Skip likely Table of Contents / cover pages.
    # Filings often repeat ITEM headings in ToC.
    offsets = [0, 15000, 30000, 60000]

    pos: Dict[str, int] = {}
    for off in offsets:
        pos = _find_positions(U, start_at=off)
        # Require at least 2 sections to avoid ToC-only hits
        if len(pos) >= 2:
            break

    if not pos:
        return ExtractedSections({"full": t})

    keys_sorted = sorted(pos.items(), key=lambda kv: kv[1])

    out: Dict[str, str] = {}
    for i, (key, start) in enumerate(keys_sorted):
        end = keys_sorted[i + 1][1] if i + 1 < len(keys_sorted) else len(t)
        out[key] = t[start:end].strip()

    return ExtractedSections(out)
