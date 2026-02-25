# src/filings/cli.py
import argparse
import json
import re
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from .analysis import compute_derived_metrics
from .config import FilingsConfig
from .edgar import EdgarClient
from .extract import extract_key_sections
from .chunk import chunk_text
from .llm import build_llm
from .news import fetch_recent_news, news_to_prompt_block
from .normalize import normalize_statement_table
from .parse import html_to_clean_text
from .pdf_report import build_primer_web_text, write_primer_pdf
from .segments import extract_segments_from_primary_html
from .statement_files import find_statement_files
from .statements import (
    condense_statement_table,
    extract_statement_table_from_statement_html,
    infer_units_from_statement_html,
)
from . import prompts


# --- MVP guardrails for cloud/free-tier rate limits ---
SECTION_ALLOWLIST_FOR_TEST = {
    "business",
    "risk_factors",
    "mda",
    "financial_statements",
}
MAX_CHUNKS_PER_SECTION_FOR_TEST = 3


def run_for_ticker(cfg: FilingsConfig, ticker: str) -> Path:
    edgar = EdgarClient(
        user_agent=cfg.user_agent,
        min_interval_sec=cfg.min_request_interval_sec,
        cache_dir=cfg.cache_dir,
    )
    llm = build_llm(cfg.llm_provider, cfg.ollama_host, cfg.ollama_model)

    # Pick the latest filing across allowed forms (by filing_date)
    refs = []
    filing_errors: list[str] = []
    for form in cfg.forms:
        try:
            refs.append(edgar.latest_filing(ticker, form=form))
        except Exception as error:
            filing_errors.append(f"{form}: {error}")
            continue

    if not refs:
        details = "; ".join(filing_errors) if filing_errors else "unknown error while querying SEC endpoints"
        raise ValueError(f"No filings found for {ticker} in forms={cfg.forms}. Details: {details}")

    # filing_date is YYYY-MM-DD, so lexicographic max works
    ref = max(refs, key=lambda r: r.filing_date)

    print(
        f"[DEBUG] Selected filing: {ref.ticker} {ref.form} {ref.filing_date} {ref.accession_number}"
    )

    raw_html = edgar.download_primary_html(ref)

    base = cfg.cache_dir / ref.ticker / ref.accession_no_dashes
    base.mkdir(parents=True, exist_ok=True)

    # --- Extract statements from statement-specific HTML (via FilingSummary.xml) ---
    summary_xml = edgar.download_filing_summary_xml(ref)
    stmt_files = find_statement_files(summary_xml)

    units = None

    income_tbl = None
    balance_tbl = None
    cashflow_tbl = None

    income_norm = None
    balance_norm = None
    cashflow_norm = None

    if stmt_files.income_html:
        income_html = edgar.download_statement_html(ref, stmt_files.income_html)
        units = units or infer_units_from_statement_html(income_html)
        income_tbl = extract_statement_table_from_statement_html(income_html)

        if income_tbl:
            print("\n[DEBUG] INCOME TABLE (first 10 rows)")
            for r in income_tbl.rows[:10]:
                print(r)

            income_norm = normalize_statement_table(
                income_tbl, kind="is", units=units, source_file=stmt_files.income_html
            )

    if stmt_files.balance_html:
        balance_html = edgar.download_statement_html(ref, stmt_files.balance_html)
        units = units or infer_units_from_statement_html(balance_html)
        balance_tbl = extract_statement_table_from_statement_html(balance_html)
        if balance_tbl:
            balance_norm = normalize_statement_table(
                balance_tbl, kind="bs", units=units, source_file=stmt_files.balance_html
            )

    if stmt_files.cashflow_html:
        cashflow_html = edgar.download_statement_html(ref, stmt_files.cashflow_html)
        units = units or infer_units_from_statement_html(cashflow_html)
        cashflow_tbl = extract_statement_table_from_statement_html(cashflow_html)
        if cashflow_tbl:
            cashflow_norm = normalize_statement_table(
                cashflow_tbl, kind="cf", units=units, source_file=stmt_files.cashflow_html
            )

    # 1) Human-readable tables for the PDF (condensed)
    statements = {
        "units": units or "USD (units not detected)",
        "income": condense_statement_table(
            income_tbl,
            kind="is",
            max_lines=getattr(cfg, "max_lines_per_statement", 14),
            max_cols=getattr(cfg, "max_statement_cols", 3),
        )
        if income_tbl
        else None,
        "balance": condense_statement_table(
            balance_tbl,
            kind="bs",
            max_lines=getattr(cfg, "max_lines_per_statement", 14),
            max_cols=getattr(cfg, "max_statement_cols", 3),
        )
        if balance_tbl
        else None,
        "cashflow": condense_statement_table(
            cashflow_tbl,
            kind="cf",
            max_lines=getattr(cfg, "max_lines_per_statement", 14),
            max_cols=getattr(cfg, "max_statement_cols", 3),
        )
        if cashflow_tbl
        else None,
    }

    # 2) Machine-usable normalized payloads (save alongside primer)
    # NOTE: we persist BOTH key styles:
    # - legacy: "is"/"bs"/"cf"
    # - analysis-friendly: "income_statement"/"balance_sheet"/"cash_flow"
    normalized = {
        "units": units or None,
        "is": income_norm,
        "bs": balance_norm,
        "cf": cashflow_norm,
        "income_statement": income_norm,
        "balance_sheet": balance_norm,
        "cash_flow": cashflow_norm,
    }
    statements_path = base / "statements_normalized.json"
    statements_path.write_text(
        json.dumps(normalized, indent=2, ensure_ascii=False),
        encoding="utf-8",
        errors="ignore",
    )

    # 3) Deterministic derived metrics (no LLM math allowed)
    derived_path = base / "derived_metrics.json"
    derived = compute_derived_metrics(
        ticker=ref.ticker,
        form=ref.form,
        filing_date=ref.filing_date,
        statements_normalized_path=statements_path,
        output_path=derived_path,
    )

    # Verified metrics block to inject into final synthesis prompt (LLM must not recompute)
    facts_block = "\n".join(f"- {x}" for x in (derived.get("facts_block") or []))
    derived_block_for_prompt = (
        "VERIFIED numeric facts computed deterministically from extracted statements.\n"
        "Rules:\n"
        "- Use these facts verbatim.\n"
        "- Do NOT recompute percentages or bps.\n"
        "- If something is missing, omit it.\n\n"
        f"{facts_block}".strip()
    )

    segments = extract_segments_from_primary_html(raw_html)

    news_items = fetch_recent_news(
        cache_dir=base,
        ticker=ref.ticker,
        company_name=ref.ticker,  # upgrade later to legal name if you want
        allow_domains=list(getattr(cfg, "news_allow_domains", ())),
        ttl_sec=int(getattr(cfg, "news_ttl_sec", 12 * 3600)),
        max_items=8,
    )
    (base / "news.txt").write_text(
        news_to_prompt_block(news_items), encoding="utf-8", errors="ignore"
    )

    # Optional: 1 sharp paragraph from headlines only (LLM = compression engine)
    news_summary_prompt = f"""
You are compressing recent business news into ONE sharp paragraph for an investor.
Rules:
- Use ONLY the headlines provided
- Do not invent facts
- No bullets
- 60–90 words
Headlines:
{news_to_prompt_block(news_items)}
""".strip()

    news_summary = llm.summarize(
        prompts.SYSTEM,
        news_summary_prompt,
        max_tokens=220,
    ).strip()

    clean = html_to_clean_text(raw_html)
    (base / "clean.txt").write_text(clean, encoding="utf-8", errors="ignore")

    extracted = extract_key_sections(clean)

    section_outputs = []
    for section_name, section_text in extracted.sections.items():
        if section_name not in SECTION_ALLOWLIST_FOR_TEST:
            continue

        chunks = chunk_text(section_text, cfg.chunk_max_words, cfg.chunk_overlap_words)
        chunks = chunks[:MAX_CHUNKS_PER_SECTION_FOR_TEST]

        chunk_summaries = []
        for j, ch in enumerate(chunks):
            p = prompts.summarize_section_prompt(
                company=ref.ticker,
                form=ref.form,
                section_name=f"{section_name} (chunk {j+1}/{len(chunks)})",
                filing_date=ref.filing_date,
                text=ch,
            )
            chunk_summaries.append(llm.summarize(prompts.SYSTEM, p, max_tokens=420))

        merged = "\n\n".join(chunk_summaries).strip()
        (base / f"summary_{section_name}.txt").write_text(
            merged, encoding="utf-8", errors="ignore"
        )
        section_outputs.append(f"## {section_name}\n{merged}")

    if not section_outputs:
        raise RuntimeError(
            "No sections were summarized. This usually means section extraction failed. "
            "Check filings_cache/<TICKER>/<ACCESSION>/clean.txt and adjust extract.py patterns."
        )

    section_summaries = "\n\n".join(section_outputs)

    # --- First pass memo synthesis ---
    final_prompt = prompts.final_primer_prompt(
        ref.ticker,
        ref.form,
        ref.filing_date,
        section_summaries,
        news_block=news_to_prompt_block(news_items),
        verified_metrics_block=derived_block_for_prompt,
    )

    final = llm.summarize(
        prompts.SYSTEM,
        final_prompt,
        max_tokens=1200,
    )

    # --- Post-check: enforce verified revenue YoY in the memo (retry once) ---
    try:
        rev_yoy = (
            derived.get("income_statement", {})
            .get("revenue", {})
            .get("yoy_pct")
        )
        if isinstance(rev_yoy, (int, float)):
            m = re.search(
                r"revenue[^.\n]{0,120}?(\d{1,3}(?:\.\d+)?)\s*%\s*(?:yoy|year[-\s]?over[-\s]?year)",
                final,
                re.I,
            )
            if m:
                memo_yoy = float(m.group(1))
                if abs(memo_yoy - float(rev_yoy)) > 2.0:
                    strict_system = (
                        prompts.SYSTEM
                        + "\n\nNUMERIC INTEGRITY OVERRIDE: All % and bps must match [VERIFIED METRICS] exactly. Do not estimate."
                    )
                    final = llm.summarize(
                        strict_system,
                        final_prompt,
                        max_tokens=1200,
                    )
    except Exception:
        pass

    (base / "primer.txt").write_text(final, encoding="utf-8", errors="ignore")
    web_text = build_primer_web_text(
        body=final,
        segments=segments,
        statements=statements,
        news_items=news_items,
        news_summary=news_summary,
    )
    (base / "primer_web.txt").write_text(web_text, encoding="utf-8", errors="ignore")

    cfg.primers_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = cfg.primers_dir / f"{ref.ticker}_{ref.form}_{ref.filing_date}.pdf"
    title = f"{ref.ticker} — {ref.form} ({ref.filing_date}) Primer"
    write_primer_pdf(
        pdf_path,
        title=title,
        body=final,
        segments=segments,
        statements=statements,
        news_items=news_items,
        news_summary=news_summary,
    )

    return pdf_path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", nargs="+", required=True, help="Tickers, e.g. AAPL MSFT NVDA")
    ap.add_argument("--user-agent", default=None)

    # Provider selection
    ap.add_argument("--llm-provider", default=None, help="openai_compatible|ollama|none")

    # Reuse existing field names for simplicity:
    # - For ollama: --ollama-host http://localhost:11434 and --ollama-model llama3.1:8b
    # - For openai_compatible (Groq): --ollama-host https://api.groq.com/openai/v1 and --ollama-model llama-3.1-8b-instant
    ap.add_argument("--ollama-model", default=None)
    ap.add_argument("--ollama-host", default=None)

    args = ap.parse_args()

    cfg = FilingsConfig()

    if args.user_agent:
        cfg = FilingsConfig(**{**cfg.__dict__, "user_agent": args.user_agent})
    if args.llm_provider:
        cfg = FilingsConfig(**{**cfg.__dict__, "llm_provider": args.llm_provider})
    if args.ollama_model:
        cfg = FilingsConfig(**{**cfg.__dict__, "ollama_model": args.ollama_model})
    if args.ollama_host:
        cfg = FilingsConfig(**{**cfg.__dict__, "ollama_host": args.ollama_host})

    outputs = []
    for t in args.tickers:
        pdf = run_for_ticker(cfg, t)
        outputs.append(str(pdf))

    print("Generated primers:")
    for o in outputs:
        print(" -", o)


if __name__ == "__main__":
    main()
