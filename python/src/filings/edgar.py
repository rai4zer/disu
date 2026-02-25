# src/filings/edgar.py
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
import requests

TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik10}.json"
ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data/{cik_no_zeros}/{accession_no_dashes}/{primary_doc}"
FILING_DIR = "https://www.sec.gov/Archives/edgar/data/{cik_no_zeros}/{accession_no_dashes}/"

# Cache policy (seconds)
TICKER_MAP_TTL_SEC = 7 * 24 * 3600
SUBMISSIONS_TTL_SEC = 6 * 3600


@dataclass(frozen=True)
class FilingRef:
    ticker: str
    cik10: str
    cik_int: int
    accession_number: str
    primary_document: str
    form: str
    filing_date: str

    @property
    def accession_no_dashes(self) -> str:
        return self.accession_number.replace("-", "")

    @property
    def archives_url(self) -> str:
        return ARCHIVES_BASE.format(
            cik_no_zeros=str(self.cik_int),
            accession_no_dashes=self.accession_no_dashes,
            primary_doc=self.primary_document,
        )


class EdgarClient:
    def __init__(self, user_agent: str, min_interval_sec: float, cache_dir: Path):
        self.headers = {"User-Agent": user_agent, "Accept-Encoding": "gzip, deflate"}
        self.min_interval_sec = float(min_interval_sec)
        self._last_request_ts = 0.0
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    # ---------------- core HTTP helpers ----------------

    def _sleep_if_needed(self) -> None:
        dt = time.time() - self._last_request_ts
        if dt < self.min_interval_sec:
            time.sleep(self.min_interval_sec - dt)

    def _cache_is_fresh(self, path: Path, ttl_sec: Optional[int]) -> bool:
        if ttl_sec is None:
            return True
        try:
            return (time.time() - path.stat().st_mtime) < ttl_sec
        except Exception:
            return False

    def _get_json(
        self,
        url: str,
        cache_path: Optional[Path] = None,
        ttl_sec: Optional[int] = None,
    ) -> Dict[str, Any]:
        if cache_path and cache_path.exists() and self._cache_is_fresh(cache_path, ttl_sec):
            return json.loads(cache_path.read_text(encoding="utf-8"))

        self._sleep_if_needed()
        r = requests.get(url, headers=self.headers, timeout=30)
        self._last_request_ts = time.time()
        r.raise_for_status()
        data = r.json()

        if cache_path:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(data), encoding="utf-8")

        return data

    def _get_text(self, url: str, cache_path: Optional[Path] = None) -> str:
        if cache_path and cache_path.exists():
            return cache_path.read_text(encoding="utf-8", errors="ignore")

        self._sleep_if_needed()
        r = requests.get(url, headers=self.headers, timeout=60)
        self._last_request_ts = time.time()
        r.raise_for_status()
        text = r.text

        if cache_path:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(text, encoding="utf-8", errors="ignore")

        return text

    # ---------------- SEC metadata ----------------

    def ticker_to_cik(self, ticker: str) -> Tuple[str, int]:
        ticker = ticker.upper().strip()
        cache_path = self.cache_dir / "_sec_company_tickers.json"
        mapping = self._get_json(TICKER_MAP_URL, cache_path, TICKER_MAP_TTL_SEC)

        for _, row in mapping.items():
            if str(row.get("ticker", "")).upper() == ticker:
                cik_int = int(row["cik_str"])
                return str(cik_int).zfill(10), cik_int

        raise ValueError(f"Ticker not found in SEC mapping: {ticker}")

    def submissions(self, cik10: str) -> Dict[str, Any]:
        cache_path = self.cache_dir / f"_submissions_{cik10}.json"
        return self._get_json(
            SUBMISSIONS_URL.format(cik10=cik10),
            cache_path,
            SUBMISSIONS_TTL_SEC,
        )

    def latest_filing(self, ticker: str, form: str = "10-K") -> FilingRef:
        cik10, cik_int = self.ticker_to_cik(ticker)
        sub = self.submissions(cik10)
        recent = sub.get("filings", {}).get("recent", {})

        for i, f in enumerate(recent.get("form", [])):
            if f == form:
                return FilingRef(
                    ticker=ticker.upper(),
                    cik10=cik10,
                    cik_int=cik_int,
                    accession_number=recent["accessionNumber"][i],
                    primary_document=recent["primaryDocument"][i],
                    form=f,
                    filing_date=recent["filingDate"][i],
                )

        raise ValueError(f"No filing found for {ticker} with form={form}")

    # ---------------- filing content ----------------

    def filing_dir_url(self, ref: FilingRef) -> str:
        return FILING_DIR.format(
            cik_no_zeros=str(ref.cik_int),
            accession_no_dashes=ref.accession_no_dashes,
        )

    def download_primary_html(self, ref: FilingRef) -> str:
        out = self.cache_dir / ref.ticker / ref.accession_no_dashes / "raw_primary.html"
        return self._get_text(ref.archives_url, cache_path=out)

    def download_filing_summary_xml(self, ref: FilingRef) -> str:
        url = self.filing_dir_url(ref) + "FilingSummary.xml"
        out = self.cache_dir / ref.ticker / ref.accession_no_dashes / "FilingSummary.xml"
        return self._get_text(url, cache_path=out)

    def download_statement_html(self, ref: FilingRef, filename: str) -> str:
        url = self.filing_dir_url(ref) + filename
        out = self.cache_dir / ref.ticker / ref.accession_no_dashes / f"stmt_{filename}"
        return self._get_text(url, cache_path=out)
