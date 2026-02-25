# src/filings/news.py
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional
import requests
import xml.etree.ElementTree as ET


@dataclass(frozen=True)
class NewsItem:
    source: str
    title: str
    published: str
    url: str


def _fetch_gnews_rss(query: str, timeout: int = 20) -> str:
    # Google News RSS is lightweight; filtering will happen after.
    url = "https://news.google.com/rss/search"
    params = {"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"}
    r = requests.get(url, params=params, timeout=timeout)
    r.raise_for_status()
    return r.text


def _parse_rss(xml_text: str) -> List[NewsItem]:
    root = ET.fromstring(xml_text)
    items = []
    for it in root.findall(".//item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        pub = (it.findtext("pubDate") or "").strip()
        source = (it.findtext("source") or "").strip()
        items.append(NewsItem(source=source or "Unknown", title=title, published=pub, url=link))
    return items


def fetch_recent_news(
    cache_dir: Path,
    ticker: str,
    company_name: str,
    allow_domains: Optional[List[str]] = None,
    ttl_sec: int = 12 * 3600,
    max_items: int = 8,
) -> List[NewsItem]:
    """
    Practical approach:
    - Query Google News RSS
    - Filter to major domains you allow (optional)
    - Cache daily to avoid hammering
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = f"{ticker.upper()}_news.json"
    cache_path = cache_dir / key

    if cache_path.exists():
        age = time.time() - cache_path.stat().st_mtime
        if age < ttl_sec:
            data = json.loads(cache_path.read_text(encoding="utf-8"))
            return [NewsItem(**x) for x in data][:max_items]

    query = f'{company_name} OR {ticker} (earnings OR supply OR guidance OR antitrust OR regulation OR demand)'
    xml_text = _fetch_gnews_rss(query)
    items = _parse_rss(xml_text)

    # Optional domain filtering
    if allow_domains:
        allow = set(d.lower() for d in allow_domains)
        filtered = []
        for x in items:
            u = x.url.lower()
            if any(d in u for d in allow):
                filtered.append(x)
        items = filtered or items  # fallback if too strict

    items = items[:max_items]
    cache_path.write_text(json.dumps([x.__dict__ for x in items], indent=2), encoding="utf-8")
    return items


def news_to_prompt_block(items: List[NewsItem]) -> str:
    lines = []
    for x in items:
        lines.append(f"- {x.source}: {x.title} ({x.published})")
    return "\n".join(lines).strip()
