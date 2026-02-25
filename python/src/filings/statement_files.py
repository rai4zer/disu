# src/filings/statement_files.py
from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class StatementFiles:
    income_html: Optional[str]
    balance_html: Optional[str]
    cashflow_html: Optional[str]


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def find_statement_files(filing_summary_xml: str) -> StatementFiles:
    root = ET.fromstring(filing_summary_xml)
    reports = root.findall(".//Report")

    def pick(best: Optional[str], cand: str, blob: str) -> str:
        # prefer consolidated versions if available
        if best is None:
            return cand
        b = _norm(blob)
        if "consolidated" in b and "consolidated" not in _norm(best):
            return cand
        # otherwise keep first found
        return best

    income = None
    balance = None
    cashflow = None

    income_kws = [
        "statement of operations", "statements of operations",
        "income statement", "statements of income",
        "statement of income", "statements of income (loss)",
        "statements of earnings", "statement of earnings",
        "results of operations",
        "consolidated statements of operations",
        "consolidated statements of income",
        "consolidated statements of earnings",
    ]
    balance_kws = [
        "balance sheet", "balance sheets",
        "statement of financial position", "statements of financial position",
        "consolidated balance sheets",
    ]
    cashflow_kws = [
        "cash flow", "cash flows",
        "statement of cash flows", "statements of cash flows",
        "consolidated statements of cash flows",
    ]

    for r in reports:
        short = _norm(r.findtext("ShortName"))
        longn = _norm(r.findtext("LongName"))
        html = (r.findtext("HtmlFileName") or "").strip()
        if not html:
            continue

        blob = f"{short} {longn}"

        if any(k in blob for k in income_kws):
            income = pick(income, html, blob)

        if any(k in blob for k in balance_kws):
            balance = pick(balance, html, blob)

        if any(k in blob for k in cashflow_kws):
            cashflow = pick(cashflow, html, blob)

    return StatementFiles(income_html=income, balance_html=balance, cashflow_html=cashflow)
