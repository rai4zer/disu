# src/filings/config.py
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class FilingsConfig:
    cache_dir: Path = Path("filings_cache")
    primers_dir: Path = Path("primers")

    user_agent: str = "InvestmentResearchPlatform/1.0 (contact: you@example.com)"
    min_request_interval_sec: float = 0.35

    forms: tuple[str, ...] = ("10-K", "10-Q")

    chunk_max_words: int = 450
    chunk_overlap_words: int = 80

    # LLM
    llm_provider: str = "openai_compatible"  # "ollama" | "openai_compatible" | "none"

    # For ollama: http://localhost:11434
    # For openai_compatible: base_url like Groq
    ollama_host: str = "https://api.groq.com/openai/v1"

    # For ollama: model tag, e.g. llama3.1:8b
    # For groq: model id, e.g. llama-3.1-8b-instant
    ollama_model: str = "llama-3.3-70b-versatile"

        # Statements / segments rendering
    max_lines_per_statement: int = 14
    max_statement_cols: int = 3

    # News
    news_ttl_sec: int = 12 * 3600
    news_allow_domains: tuple[str, ...] = (
        "reuters.com",
        "bloomberg.com",
        "ft.com",
        "wsj.com",
        "cnbc.com",
        "finance.yahoo.com",
        "theverge.com",
    )

