"""Market quote bridge: yfinance primary, Finnhub secondary for US equities.

Why this exists at all, when app/lib/market/market-provider.ts already speaks to
Yahoo in TypeScript: Yahoo's endpoints require a crumb/cookie handshake that they
change without notice, and the hand-rolled client 403s on exactly the symbols a
Swedish portfolio is made of. `yfinance` maintains that handshake as its whole
job. Measured 2026-09-03 against the same key: it resolves `VOLV-B.ST`, `^OMX`,
`GC=F`, `SEKUSD=X` and `BTC-USD`, three of which Finnhub refuses on the current
plan.

Read one thing before editing: **this module has no placeholder mode.** A symbol
it cannot price comes back with `price: null` and a reason. It never estimates,
never carries a stale value forward into `price`, and never derives a
`previousClose` it was not given. `MARKET_MOCK_FALLBACK_MODE` is the switch that
governs invented prices elsewhere in the app, and the reason it needs no
representation here is that there is nothing on this path for it to permit
(docs/synthetic-data-policy.md).

Protocol: symbols in as argv or one-per-line on stdin, one JSON object out on
stdout, conforming to docs/contracts/market-quote.schema.json. Everything
diagnostic goes to stderr, because a stray print on stdout corrupts the payload
and the caller's parse error would point at the wrong thing entirely.

Batching is not an optimisation, it is the contract. Interpreter start plus the
yfinance import costs ~1.9s and one symbol costs ~0.05s after that, so the caller
is expected to ask for every symbol it wants in a single run.
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Iterable
from urllib.parse import quote as urlquote
from urllib.request import Request, urlopen

BRIDGE_VERSION = "market-bridge-v1"

# Finnhub's measured coverage (docs/market-live-feed.md, re-verified 2026-08-27):
# /quote answers US equities and 403s `.ST`, FX and every index. So the failover
# is attempted only where it can succeed -- asking it about VOLV-B.ST spends a
# request to be told no, and turns a clean "unavailable" into a slow one.
_NON_US_MARKERS = (".ST", ".OL", ".CO", ".HE", ".DE", ".PA", ".L", "=X", "=F", "-USD", "^")


def _is_us_equity(symbol: str) -> bool:
    upper = symbol.upper()
    return not any(marker in upper for marker in _NON_US_MARKERS)


def _finite(value: Any) -> float | None:
    """A number we are willing to publish, or None.

    bool is excluded deliberately: it is an int subclass in Python, and `True`
    silently becoming a price of 1.0 is the kind of fabrication this file exists
    to prevent.
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if out != out or out in (float("inf"), float("-inf")):  # NaN / inf
        return None
    # A non-positive price is not a cheap price, it is a broken read. Yahoo
    # returns 0.0 for a delisted or mis-typed ticker rather than an error.
    return out if out > 0 else None


def _iso(ts: Any) -> str | None:
    """Feed timestamp as ISO-8601 UTC, or None if it did not supply one.

    Never falls back to `now()`. The caller uses asOf to decide how stale a
    reading is, and stamping our own clock on a value of unknown age is how a
    reading from last Friday gets presented as current.
    """
    if ts is None or isinstance(ts, bool):
        return None
    try:
        seconds = float(ts)
    except (TypeError, ValueError):
        if isinstance(ts, datetime):
            at = ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
            return at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        return None
    if seconds <= 0:
        return None
    try:
        return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    except (OverflowError, OSError, ValueError):
        return None


def _unavailable(symbol: str, reason: str) -> dict[str, Any]:
    return {
        "symbol": symbol,
        "price": None,
        "previousClose": None,
        "currency": None,
        "asOf": None,
        "source": "none",
        "reason": reason,
    }


def _fetch_intraday_batch(symbols: list[str]) -> dict[str, tuple[float, str | None]]:
    """Last intraday bar per symbol, in one HTTP request: {symbol: (price, asOf)}.

    This exists for `asOf` as much as for the price. `fast_info` carries no
    timestamp of any kind — measured 2026-09-03, its keys are price and profile
    fields only — and a reading whose age is unknown is one the caller cannot
    judge. The 1-minute bar index is a real feed timestamp, tz-aware and
    reported by Yahoo rather than read off our clock.

    It is also the fast path: one batched request answers 24 symbols in ~0.6s,
    where 24 `fast_info` lookups cost ~5s.
    """
    import yfinance as yf

    try:
        frame = yf.download(
            symbols,
            period="1d",
            interval="1m",
            progress=False,
            group_by="ticker",
            auto_adjust=False,
            threads=True,
        )
    except Exception as error:  # noqa: BLE001 - fall through to the per-symbol path
        print(f"[market-bridge] batch download failed: {type(error).__name__}: {error}", file=sys.stderr)
        return {}

    out: dict[str, tuple[float, str | None]] = {}
    for symbol in symbols:
        try:
            # Shape, not symbol count, decides how to index. yfinance 1.2.0
            # returns a ticker-grouped MultiIndex even for a single symbol, but
            # older and newer versions flatten that case to plain field columns
            # -- and branching on `len(symbols) > 1` silently resolves nothing
            # for the one-symbol call on whichever version disagrees.
            grouped = getattr(frame.columns, "nlevels", 1) > 1 and symbol in frame.columns.get_level_values(0)
            closes = (frame[symbol]["Close"] if grouped else frame["Close"]).dropna()
            if closes.empty:
                continue
            price = _finite(closes.iloc[-1])
            if price is None:
                continue
            out[symbol] = (price, _iso(closes.index[-1].to_pydatetime()))
        except Exception:  # noqa: BLE001 - a symbol missing from the frame is just unresolved
            continue
    return out


def _fetch_yfinance(symbols: list[str]) -> dict[str, dict[str, Any]]:
    """Price every symbol we can via yfinance. Never raises for one bad symbol.

    Two calls per batch, because no one endpoint carries everything we publish:
    the batched intraday download supplies price and a real feed timestamp, and
    `fast_info` supplies currency and the previous official close. `fast_info` is
    used rather than `.info` because `.info` pulls a large profile document per
    symbol for data we do not use.

    Known cost: the `fast_info` leg is per-symbol, so it dominates a sweep at
    ~0.2s each. Currency is a property of the instrument rather than of the
    quote and effectively never changes, so a caller holding a previous
    observation can skip re-reading it; that is the caching layer's job, not
    this module's (app/lib/market/quote-cache.ts).
    """
    import yfinance as yf  # imported here so an import failure is reportable JSON

    intraday = _fetch_intraday_batch(symbols)

    out: dict[str, dict[str, Any]] = {}
    for symbol in symbols:
        batch = intraday.get(symbol)
        try:
            info = yf.Ticker(symbol).fast_info
            currency = info.get("currency")
            # The batched bar wins on price when both answered: it is the reading
            # whose timestamp we are about to publish, and pairing one source's
            # price with another's `asOf` would misdate it.
            price = (batch[0] if batch else None) or _finite(info.get("lastPrice"))
            previous_close = _finite(info.get("previousClose"))
            as_of = batch[1] if batch else None
        except Exception as error:  # noqa: BLE001 - one bad symbol must not sink the batch
            print(f"[market-bridge] {symbol}: {type(error).__name__}: {error}", file=sys.stderr)
            if not batch:
                continue
            price, previous_close, currency, as_of = batch[0], None, None, batch[1]

        if price is None:
            continue

        out[symbol] = {
            "symbol": symbol,
            "price": price,
            # Absent previous close stays absent. computeDayChange() in
            # app/lib/market/quote.ts returns null rather than a number when
            # this is null, which is the honest outcome.
            "previousClose": previous_close,
            "currency": currency.upper() if isinstance(currency, str) and currency else None,
            "asOf": as_of,
            "source": "yfinance",
        }
    return out


def _fetch_finnhub(symbols: list[str], token: str) -> dict[str, dict[str, Any]]:
    """Secondary for US equities only. Best-effort: failures are logged, not raised."""
    out: dict[str, dict[str, Any]] = {}
    for symbol in symbols:
        try:
            url = f"https://finnhub.io/api/v1/quote?symbol={urlquote(symbol)}&token={urlquote(token)}"
            request = Request(url, headers={"User-Agent": "disu-market-bridge"})
            with urlopen(request, timeout=6) as response:  # noqa: S310 - fixed https host
                payload = json.loads(response.read().decode("utf-8"))
            price = _finite(payload.get("c"))
            if price is None:
                continue
            out[symbol] = {
                "symbol": symbol,
                "price": price,
                "previousClose": _finite(payload.get("pc")),
                # Finnhub /quote does not report a currency. It is left null
                # rather than assumed USD: the assumption would be right most of
                # the time, and a currency that is right most of the time is
                # exactly the kind of value that gets trusted and then is wrong.
                "currency": None,
                "asOf": _iso(payload.get("t")),
                "source": "finnhub",
            }
        except Exception as error:  # noqa: BLE001
            print(f"[market-bridge] finnhub {symbol}: {type(error).__name__}: {error}", file=sys.stderr)
    return out


def collect(symbols: Iterable[str]) -> dict[str, Any]:
    started = time.monotonic()

    # Dedupe while preserving the caller's order: the payload is matched by
    # symbol, but a stable order keeps diffs and logs readable.
    requested: list[str] = []
    seen: set[str] = set()
    for raw in symbols:
        symbol = raw.strip().upper()
        if symbol and symbol not in seen:
            seen.add(symbol)
            requested.append(symbol)

    if not requested:
        return {"ok": True, "quotes": [], "meta": {"bridgeVersion": BRIDGE_VERSION, "requested": 0, "resolved": 0, "elapsedMs": 0}}

    resolved = _fetch_yfinance(requested)

    # Failover, narrowed twice over: only symbols yfinance could not price, and
    # only the ones Finnhub can actually answer.
    token = (os.environ.get("FINNHUB_API_KEY") or "").strip()
    if token:
        missing = [s for s in requested if s not in resolved and _is_us_equity(s)]
        if missing:
            resolved.update(_fetch_finnhub(missing, token))

    quotes = [resolved.get(symbol) or _unavailable(symbol, "no live source could price this symbol") for symbol in requested]

    return {
        "ok": True,
        "quotes": quotes,
        "meta": {
            "bridgeVersion": BRIDGE_VERSION,
            "requested": len(requested),
            "resolved": sum(1 for q in quotes if q["price"] is not None),
            "elapsedMs": round((time.monotonic() - started) * 1000, 1),
        },
    }


def main() -> int:
    try:
        symbols = sys.argv[1:]
        if not symbols and not sys.stdin.isatty():
            # stdin keeps a long symbol list off the argv length limit; the board
            # is 24 names today but a user's holdings are not bounded.
            symbols = [line for line in sys.stdin.read().splitlines()]
        payload = collect(symbols)
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
