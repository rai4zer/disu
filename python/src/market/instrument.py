"""Instrument detail bridge: profile, financials, news and analyst estimates.

One spawn returns everything the instrument page needs. That is the same
reasoning as fetcher.py — interpreter start plus the yfinance import costs ~1.9s
and dominates everything after it, so four separate calls for four tabs would
cost four times as much as one call for all four.

**What this module will not do is invent a tab.** Measured 2026-09-03, only
equities carry fundamentals: an index, a future, an FX cross and a crypto pair
all return completely empty income statements, balance sheets and analyst
estimates, and ^OMX returns no news at all. So every section here is optional
and the payload says which ones were actually resolved. The page renders the
tabs it has data for. An empty "KPI" tab on gold would be a promise the data
cannot keep (docs/synthetic-data-policy.md).

`quoteType` is the discriminator and is passed through verbatim: EQUITY, INDEX,
FUTURE, CURRENCY, CRYPTOCURRENCY.

Contract: docs/contracts/instrument-profile.schema.json
"""

from __future__ import annotations

import json
import re
import sys
import time
import traceback
import warnings
from datetime import datetime, timezone
from typing import Any

warnings.filterwarnings("ignore")

BRIDGE_VERSION = "instrument-bridge-v1"

CEO_TITLE = re.compile(r"\bceo\b|chief executive", re.I)

# The income-statement lines the KPI tab charts, in render order. yfinance
# labels vary by filer, so each is looked up by name and simply absent when the
# filer does not report it -- never zero, which would draw a bar claiming the
# company earned nothing.
INCOME_LINES = [
    ("revenue", "Total Revenue"),
    ("grossProfit", "Gross Profit"),
    ("operatingIncome", "Operating Income"),
    ("netIncome", "Net Income"),
]

BALANCE_LINES = [
    ("assets", "Total Assets"),
    ("equity", "Stockholders Equity"),
    ("debt", "Total Debt"),
    ("liabilities", "Total Liabilities Net Minority Interest"),
]


def _finite(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return None if out != out or out in (float("inf"), float("-inf")) else out


def _positive(value: Any) -> float | None:
    out = _finite(value)
    return out if out is not None and out > 0 else None


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _iso(value: Any) -> str | None:
    """Feed timestamp as ISO-8601 UTC. Never substitutes our own clock."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    if isinstance(value, datetime):
        at = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return None
    if seconds <= 0:
        return None
    try:
        return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    except (OverflowError, OSError, ValueError):
        return None


def _profile(info: dict[str, Any]) -> dict[str, Any]:
    """The overview tab: what this thing is, in the issuer's own words.

    `summary` is yfinance's `longBusinessSummary` — the company's own
    description, passed through unedited. It is not paraphrased or generated,
    because a generated description of a company is exactly the kind of
    plausible text nobody can audit.
    """
    officers = info.get("companyOfficers") or []
    ceo = None
    if isinstance(officers, list):
        for officer in officers:
            if not isinstance(officer, dict):
                continue
            # Match the role wherever it sits in the title. Nordic filers write
            # "CEO, President, Member of the Group Executive Board & Director",
            # so an exact-equality check finds nobody. \bceo\b keeps "CFO" and
            # "Chief Digital Officer" out while accepting "Chairman & CEO".
            #
            # Some issuers -- Apple among them -- simply do not list a CEO in
            # this feed. That yields None, which is the honest answer; the
            # overview omits the row rather than guessing from seniority.
            if CEO_TITLE.search(officer.get("title") or ""):
                ceo = _text(officer.get("name"))
                if ceo:
                    break

    return {
        "name": _text(info.get("longName")) or _text(info.get("shortName")),
        "quoteType": _text(info.get("quoteType")),
        "exchange": _text(info.get("fullExchangeName")) or _text(info.get("exchange")),
        "currency": (_text(info.get("currency")) or "").upper() or None,
        "summary": _text(info.get("longBusinessSummary")),
        "sector": _text(info.get("sector")),
        "industry": _text(info.get("industry")),
        "website": _text(info.get("website")),
        "country": _text(info.get("country")),
        "employees": _finite(info.get("fullTimeEmployees")),
        "ceo": ceo,
        # The "Mer / Expand" block on the overview tab.
        "marketCap": _positive(info.get("marketCap")),
        "sharesOutstanding": _positive(info.get("sharesOutstanding")),
        "peRatio": _finite(info.get("trailingPE")),
        "forwardPe": _finite(info.get("forwardPE")),
        "priceToBook": _finite(info.get("priceToBook")),
        "eps": _finite(info.get("trailingEps")),
        "dividendYield": _finite(info.get("dividendYield")),
        "beta": _finite(info.get("beta")),
        "fiftyTwoWeekHigh": _positive(info.get("fiftyTwoWeekHigh")),
        "fiftyTwoWeekLow": _positive(info.get("fiftyTwoWeekLow")),
    }


def _statement(frame: Any, lines: list[tuple[str, str]]) -> list[dict[str, Any]]:
    """One statement as a list of per-period rows, newest last.

    Reversed into chronological order because every consumer is a bar chart
    reading left to right, and yfinance hands back newest-first.

    A line the filer does not report is omitted from that period rather than
    set to zero. A zero bar and a missing bar look identical on a chart and
    mean opposite things.
    """
    if frame is None or getattr(frame, "empty", True):
        return []

    periods: list[dict[str, Any]] = []
    for column in frame.columns:
        row: dict[str, Any] = {"period": _iso(column) or str(column)[:10]}
        found = False
        for key, label in lines:
            if label not in frame.index:
                continue
            value = _finite(frame.loc[label, column])
            if value is not None:
                row[key] = value
                found = True
        if found:
            periods.append(row)

    periods.reverse()
    return periods


def _news(ticker: Any, limit: int = 12) -> list[dict[str, Any]]:
    """Recent stories about this instrument, as the feed reported them.

    Headline, publisher, timestamp and link only — deliberately no summary or
    sentiment. Summarising a story we did not write, on a page next to a price,
    is how an editorial claim gets attributed to us.
    """
    try:
        raw = ticker.news or []
    except Exception as error:  # noqa: BLE001
        print(f"[instrument-bridge] news: {type(error).__name__}: {error}", file=sys.stderr)
        return []

    out: list[dict[str, Any]] = []
    for item in raw[:limit]:
        if not isinstance(item, dict):
            continue
        # yfinance 1.x nests the story under `content`; older shapes are flat.
        content = item.get("content") if isinstance(item.get("content"), dict) else item
        title = _text(content.get("title"))
        if not title:
            continue

        provider = content.get("provider")
        publisher = _text(provider.get("displayName")) if isinstance(provider, dict) else _text(content.get("publisher"))

        link = None
        for key in ("canonicalUrl", "clickThroughUrl"):
            candidate = content.get(key)
            if isinstance(candidate, dict):
                link = _text(candidate.get("url"))
            elif isinstance(candidate, str):
                link = _text(candidate)
            if link:
                break
        link = link or _text(content.get("link"))

        out.append(
            {
                "title": title,
                "publisher": publisher,
                "publishedAt": _iso(content.get("pubDate") or content.get("providerPublishTime")),
                "link": link,
            }
        )
    return out


def _analysts(ticker: Any) -> dict[str, Any] | None:
    """Recommendation spread and price targets, or None when nobody covers it.

    Returns None rather than an empty shell so the caller can drop the tab
    entirely. An "Analysts" tab reading 0/0/0/0/0 would look like unanimous
    indifference rather than like an absence of coverage.
    """
    out: dict[str, Any] = {}

    try:
        recs = ticker.recommendations
        if recs is not None and not recs.empty:
            row = recs.iloc[0]
            spread = {
                key: int(value)
                for key, label in [
                    ("strongBuy", "strongBuy"),
                    ("buy", "buy"),
                    ("hold", "hold"),
                    ("sell", "sell"),
                    ("strongSell", "strongSell"),
                ]
                if (value := _finite(row.get(label))) is not None
            }
            if sum(spread.values()) > 0:
                out["recommendations"] = spread
                out["analystCount"] = sum(spread.values())
    except Exception as error:  # noqa: BLE001
        print(f"[instrument-bridge] recommendations: {type(error).__name__}: {error}", file=sys.stderr)

    try:
        targets = ticker.analyst_price_targets or {}
        if isinstance(targets, dict):
            resolved = {
                key: value
                for key in ("current", "low", "high", "mean", "median")
                if (value := _positive(targets.get(key))) is not None
            }
            # A target range needs both ends; a lone "high" is not a range and
            # would render as a point estimate the analysts never gave.
            if "low" in resolved and "high" in resolved:
                out["priceTarget"] = resolved
    except Exception as error:  # noqa: BLE001
        print(f"[instrument-bridge] price targets: {type(error).__name__}: {error}", file=sys.stderr)

    return out or None


def collect(symbol: str) -> dict[str, Any]:
    import yfinance as yf

    started = time.monotonic()
    normalized = symbol.strip().upper()
    ticker = yf.Ticker(normalized)

    try:
        info = ticker.info or {}
    except Exception as error:  # noqa: BLE001
        print(f"[instrument-bridge] info: {type(error).__name__}: {error}", file=sys.stderr)
        info = {}

    profile = _profile(info)

    # An unknown symbol answers with an empty info dict and no price. Saying so
    # is better than returning a page-shaped payload full of nulls, which the UI
    # would render as a real instrument nobody has data for.
    if not profile["name"] and not _positive(info.get("regularMarketPrice")):
        return {"ok": False, "error": f"No instrument data for {normalized}"}

    quote_type = (profile.get("quoteType") or "").upper()

    income: list[dict[str, Any]] = []
    balance: list[dict[str, Any]] = []
    analysts = None

    # Only equities have these. Asking anyway costs two slow, always-empty
    # upstream calls per index and commodity page view.
    if quote_type == "EQUITY":
        try:
            income = _statement(ticker.income_stmt, INCOME_LINES)
            balance = _statement(ticker.balance_sheet, BALANCE_LINES)
        except Exception as error:  # noqa: BLE001
            print(f"[instrument-bridge] financials: {type(error).__name__}: {error}", file=sys.stderr)
        analysts = _analysts(ticker)

    news = _news(ticker)

    return {
        "ok": True,
        "symbol": normalized,
        "profile": profile,
        "financials": {"income": income, "balance": balance} if (income or balance) else None,
        "news": news,
        "analysts": analysts,
        # What the page may render. Computed here rather than inferred in the UI
        # so one rule decides it, and the UI cannot disagree with the payload.
        "sections": {
            "overview": bool(profile["name"]),
            "kpi": bool(income or balance),
            "news": bool(news),
            "analysts": bool(analysts),
        },
        "meta": {"bridgeVersion": BRIDGE_VERSION, "elapsedMs": round((time.monotonic() - started) * 1000, 1)},
    }


def main() -> int:
    try:
        symbol = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read().strip()
        if not symbol:
            raise ValueError("no symbol given")
        payload = collect(symbol)
    except Exception as error:  # noqa: BLE001
        json.dump({"ok": False, "error": f"{type(error).__name__}: {error}", "traceback": traceback.format_exc()}, sys.stdout)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 1

    json.dump(payload, sys.stdout, allow_nan=False)
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
