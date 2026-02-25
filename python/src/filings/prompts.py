SYSTEM = """You are an investment research assistant.
Be concrete, skeptical, and cite exact phrases when relevant.
Focus on material changes, risks, leverage, liquidity, dilution, and accounting flags.
Be concise and avoid filler."""

def summarize_section_prompt(company: str, form: str, section_name: str, filing_date: str, text: str) -> str:
    return f"""
Company: {company}
Form: {form}
Filing date: {filing_date}
Section: {section_name}

Task:
- Summarize the section in 8–15 bullets max.
- Extract red flags (accounting, liquidity, debt, litigation, customer concentration, guidance).
- Extract catalysts / positive deltas.
- If the section is noisy, focus on *what changed* and *what is material*.

Section text:
{text}
""".strip()

def final_primer_prompt(
    company: str,
    form: str,
    filing_date: str,
    section_summaries: str,
    news_block: str = "",
    verified_metrics_block: str = "",
) -> str:
    return f"""
You are generating a **one-page investment memo** for a professional investor.

This is a **dense reference page**, similar to an internal investment book.
The goal is maximum signal per square inch.

AUDIENCE
- Long-term, fundamentals-driven investor
- Financially literate
- Wants clarity, not completeness

GLOBAL RULES (MANDATORY)
- Target length: ~600–650 words TOTAL
- Prefer prose paragraphs over bullets (except Watchlist)
- No section should exceed ~120 words
- Do NOT repeat filing dates, form names, or boilerplate
- Do NOT include filler like “Not provided”
- Do NOT speculate or add external knowledge
- Use ONLY the provided source material blocks below
- If information is missing, omit it silently

NUMERIC INTEGRITY (MANDATORY)
- Any numeric % (growth, margins, bps) MUST come from [VERIFIED METRICS].
- Do NOT recompute, estimate, round differently, or invent alternatives.
- If a % is not present in [VERIFIED METRICS], do not mention that %.

STYLE
- Investment memo tone
- Concrete, skeptical, factual
- Compress aggressively
- Write as if space is expensive

---

## Company Snapshot

In ~90–110 words:
Explain what customers actually pay for and why they keep paying.
Emphasize integration, switching costs, and ecosystem economics if present.
Avoid listing products unless they explain economics.

Hard rules:
- No bullets
- No metadata
- Do not repeat concepts across the sentence and paragraph

---

## Economic Engine

In **60–90 words**:
- Identify the primary cash-generating engine AND what structurally sustains it
- Identify where capital is being reinvested
- Identify any long-dated or speculative options

Explicitly state:
- What scales cheaply
- What is capital-intensive
- Where returns are uncertain or deferred

No forecasts. No hype.

---

## Business Model

Write **1 short paragraphs UNDER THIS SINGLE HEADING**.

The paragraph ≤ ~70 words.

Mandatory coverage:
- Revenue mechanics (how money is actually made)
- Cost structure and operating leverage
- Capital intensity and margin durability

Rules:
- Avoid generic phrases (“strong brand”, “innovation”)
- Every claim must tie to mechanics in the filing
- Focus exclusively on economics: margin structure, cost asymmetry, operating leverage, capital intensity.
- If a sentence could apply to most companies in the sector, delete it.

---

## Operating Segments
[Omitted — rendered as segment table + pie chart extracted from filing.]

---

## Period over Period

Describe **only material changes** versus the prior comparable period.

Focus on:
- Directional shifts (growth, margins, capital allocation)
- Management signals embedded in numbers or disclosures
- Changes that alter the business trajectory

Use [VERIFIED METRICS] for any numeric claims.

---

## Watchlist

List **4–6 concrete signals** implied by the filing.

Focus on:
- Balance sheet stress or strengthening
- Cash conversion vs earnings
- Capital intensity inflections
- Dilution, leverage, or funding dependency
- Margin compression or expansion drivers

Rules:
- Signals only, not explanations
- No repetition of risks already discussed
- Each bullet should be monitorable over time

---

## Latest News

In **≤ 80 words**:
- Summarize only news that meaningfully affects perception, regulation, or capital allocation
- Treat news as context, not truth

No stock price commentary unless structurally meaningful.
No more than 4 headlines.

---

## Condensed Financials

This section begins a new page.
Render only condensed financial tables (Income Statement, Balance Sheet, Cash Flow).
No narrative text.

---

SOURCE MATERIAL (ONLY ALLOWED INPUT):

[VERIFIED METRICS]
{verified_metrics_block}

[FILING SUMMARIES]
{section_summaries}

[RECENT NEWS HEADLINES]
{news_block}
""".strip()
