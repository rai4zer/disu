from __future__ import annotations

import argparse
import json
import traceback
from pathlib import Path

from src.filings.cli import run_for_ticker
from src.filings.config import FilingsConfig


def _parse_pdf_name(pdf_path: Path) -> tuple[str | None, str | None]:
    # Expected: <TICKER>_<FORM>_<YYYY-MM-DD>.pdf
    stem = pdf_path.stem
    parts = stem.split("_")
    if len(parts) < 3:
        return None, None
    form = parts[1]
    filing_date = "_".join(parts[2:])
    return form, filing_date


def _latest_primer_text(cache_dir: Path, ticker: str) -> str:
    ticker_dir = cache_dir / ticker
    if not ticker_dir.exists():
        return ""

    def _mtime(path: Path) -> float:
        try:
            return path.stat().st_mtime
        except OSError:
            return 0.0

    candidates = sorted(ticker_dir.glob("*/primer_web.txt"), key=_mtime, reverse=True)
    if not candidates:
        candidates = sorted(ticker_dir.glob("*/primer.txt"), key=_mtime, reverse=True)
    if not candidates:
        return ""

    return candidates[0].read_text(encoding="utf-8", errors="ignore").strip()


def _validate_success_payload(payload: dict[str, object], ticker: str) -> None:
    required_string_keys = ["ticker", "pdf_path", "pdf_abspath", "cache_dir", "primer_text"]
    for key in required_string_keys:
        value = payload.get(key)
        if not isinstance(value, str):
            raise ValueError(f"{key} must be a string")
    if str(payload["ticker"]).upper() != ticker.upper():
        raise ValueError("payload ticker does not match requested ticker")

    for key in ["form", "filing_date"]:
        value = payload.get(key)
        if value is not None and not isinstance(value, str):
            raise ValueError(f"{key} must be a string or null")


def main() -> None:
    parser = argparse.ArgumentParser(description="JSON bridge for filings primer generation")
    parser.add_argument("--ticker", required=True, type=str)
    parser.add_argument("--llm-provider", default="none", type=str)
    parser.add_argument("--user-agent", default=None, type=str)
    parser.add_argument("--ollama-model", default=None, type=str)
    parser.add_argument("--ollama-host", default=None, type=str)
    args = parser.parse_args()

    ticker = args.ticker.strip().upper()

    try:
        cfg = FilingsConfig()
        if args.user_agent:
            cfg = FilingsConfig(**{**cfg.__dict__, "user_agent": args.user_agent})
        if args.llm_provider:
            cfg = FilingsConfig(**{**cfg.__dict__, "llm_provider": args.llm_provider})
        if args.ollama_model:
            cfg = FilingsConfig(**{**cfg.__dict__, "ollama_model": args.ollama_model})
        if args.ollama_host:
            cfg = FilingsConfig(**{**cfg.__dict__, "ollama_host": args.ollama_host})

        pdf_path = run_for_ticker(cfg=cfg, ticker=ticker)
        form, filing_date = _parse_pdf_name(pdf_path)

        payload = {
            "ok": True,
            "ticker": ticker,
            "pdf_path": str(pdf_path),
            "pdf_abspath": str(pdf_path.resolve()),
            "form": form,
            "filing_date": filing_date,
            "cache_dir": str((cfg.cache_dir / ticker).resolve()),
            "primer_text": _latest_primer_text(cfg.cache_dir, ticker),
        }
        _validate_success_payload(payload, ticker)
        print(json.dumps(payload))
    except Exception as error:
        payload = {
            "ok": False,
            "error": str(error),
            "traceback": traceback.format_exc(limit=10),
        }
        print(json.dumps(payload))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
