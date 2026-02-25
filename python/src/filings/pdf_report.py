# src/filings/pdf_report.py
from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import List, Optional, Any

from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas
from reportlab.lib.units import inch

# Optional deps used if present
try:
    import matplotlib.pyplot as plt
except Exception:  # pragma: no cover
    plt = None


def _safe_str(x: Any) -> str:
    return "" if x is None else str(x)


def _filter_body_lines(body: str) -> str:
    banned_headings = {
        "## Condensed Financial Picture (Narrative)",
        "## Key Risks & Watchlist Metrics",
    }

    out = []
    for raw in body.split("\n"):
        s = raw.strip()

        if s in banned_headings:
            continue

        # Drop LLM placeholders
        if s.startswith("[Omitted — rendered"):
            continue
        if s.startswith("[Table:"):
            continue
        if s.startswith("| Category"):
            continue
        if s.startswith("| ---"):
            continue

        out.append(raw)

    return "\n".join(out).strip()


def _rows_to_text(title: str, rows: list[list[str]]) -> str:
    if not rows:
        return ""
    lines = [title]
    for row in rows:
        cells = [str(c).strip() for c in row if str(c).strip()]
        if not cells:
            continue
        lines.append(" | ".join(cells))
    return "\n".join(lines).strip()


def build_primer_web_text(
    body: str,
    segments: Any = None,
    statements: Any = None,
    news_items: Optional[List[Any]] = None,
    news_summary: Optional[str] = None,
) -> str:
    """
    Build a plain-text transcript that mirrors the same data sources used by the PDF.
    """
    body = _filter_body_lines(body)

    out: list[str] = []

    def append_block(text: str) -> None:
        txt = (text or "").strip("\n")
        if txt:
            out.append(txt)
            out.append("")

    def render_segments() -> None:
        if not segments or not getattr(segments, "segments", None):
            return
        lines = ["Operating Segments"]
        segs = segments.segments
        total_pct = sum(float(getattr(s, "pct", 0.0) or 0.0) for s in segs)
        if total_pct >= 1.0:
            for s in segs[:8]:
                lines.append(
                    f"• {str(getattr(s, 'name', '')).strip()}: {float(getattr(s, 'pct', 0.0) or 0.0):.1f}%"
                )
        else:
            for s in segs[:8]:
                lines.append(
                    f"• {str(getattr(s, 'name', '')).strip()}: {str(getattr(s, 'value', '')).strip()}"
                )
        append_block("\n".join(lines))

    def render_statements() -> None:
        if not statements or not isinstance(statements, dict):
            return
        lines: list[str] = ["Financial Picture", "Condensed financial statements from the latest filing."]
        units = str(statements.get("units") or "").strip()
        if units:
            lines.append(f"Units: {units}")

        income = statements.get("income")
        if income and getattr(income, "rows", None):
            lines.append(_rows_to_text("Income Statement (condensed)", income.rows))

        balance = statements.get("balance")
        if balance and getattr(balance, "rows", None):
            lines.append(_rows_to_text("Balance Sheet (condensed)", balance.rows))

        cashflow = statements.get("cashflow")
        if cashflow and getattr(cashflow, "rows", None):
            lines.append(_rows_to_text("Cash Flow (condensed)", cashflow.rows))

        append_block("\n\n".join([x for x in lines if x.strip()]))

    def render_news() -> None:
        if not news_items and not news_summary:
            return
        lines = ["Latest News"]
        if news_summary:
            lines.append(str(news_summary).strip())
        if news_items:
            for it in news_items[:6]:
                src = _safe_str(getattr(it, "source", "")).strip()
                title_ = _safe_str(getattr(it, "title", "")).strip()
                line = f"• {src}: {title_}".strip()
                lines.append(line)
        append_block("\n".join(lines))

    for raw in body.split("\n"):
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            append_block("")
            continue

        if stripped.startswith("#"):
            level = len(stripped) - len(stripped.lstrip("#"))
            text = stripped.lstrip("#").strip()
            tnorm = text.lower()

            if level == 2 and tnorm.startswith("operating segments"):
                render_segments()
                continue
            if level == 2 and (
                tnorm.startswith("condensed financials")
                or tnorm.startswith("financial picture")
                or "condensed financial picture" in tnorm
            ):
                render_statements()
                continue
            if level == 2 and tnorm.startswith("latest news"):
                render_news()
                continue

            append_block(text)
            continue

        if stripped.startswith("- "):
            append_block(f"• {stripped[2:].strip()}")
        else:
            append_block(stripped)

    # collapse excessive blank lines while preserving paragraph breaks
    text = "\n".join(out)
    text = "\n".join([ln.rstrip() for ln in text.splitlines()])
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    return text.strip()


def _render_pie_chart_png(out_png: Path, segments: Any) -> Optional[Path]:
    """
    segments is expected to have: segments.segments = [{name, pct or value}]
    """
    if plt is None:
        return None
    if not segments or not getattr(segments, "segments", None):
        return None

    names = []
    values = []
    for s in segments.segments:
        n = getattr(s, "name", None)
        pct = getattr(s, "pct", None)
        val = getattr(s, "value", None)
        if n and pct is not None:
            names.append(str(n))
            values.append(float(pct))
        elif n and val is not None:
            names.append(str(n))
            values.append(float(val))

    if len(values) < 2:
        return None

    out_png.parent.mkdir(parents=True, exist_ok=True)

    fig = plt.figure(figsize=(3.0, 2.2), dpi=200)
    ax = fig.add_subplot(111)
    ax.pie(values, labels=names, autopct="%1.0f%%", textprops={"fontsize": 7})
    ax.set_title("Segments", fontsize=9)
    fig.tight_layout()
    # Keep transparency so the page watermark does not look "cut" behind chart images.
    fig.savefig(out_png, transparent=True)
    plt.close(fig)

    return out_png


def write_primer_pdf(
    out_path: Path,
    title: str,
    body: str,
    segments: Any = None,
    statements: Any = None,
    news_items: Optional[List[Any]] = None,
    news_summary: Optional[str] = None,
) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)

    c = canvas.Canvas(str(out_path), pagesize=LETTER)
    width, height = LETTER

    left = 0.75 * inch
    right = 0.75 * inch
    top = 0.9 * inch
    bottom = 0.75 * inch

    x = left
    y = height - top
    page_num = 1

    # ---------- helpers ----------
    def footer() -> None:
        c.setFont("Helvetica", 9)
        c.drawRightString(width - right, 0.5 * inch, str(page_num))

    def new_page() -> None:
        nonlocal y, page_num
        footer()
        c.showPage()
        page_num += 1
        draw_watermark()
        draw_page_logo()
        y = height - top

    def draw_watermark() -> None:
        # Single low-contrast tilted DISU wordmark in the page center.
        c.saveState()
        c.setFillGray(0.94)
        c.translate(width / 2, height / 2)
        c.rotate(26)
        c.setFont("Helvetica-Bold", 52)
        c.drawCentredString(0, 0, "DISU")
        c.restoreState()

    def draw_page_logo() -> None:
        # Top-right page logo (wordmark + two symbol marks) to match app branding.
        logo_right = width - right
        logo_top = height - (top * 0.58)

        c.saveState()
        c.setStrokeColorRGB(0.20, 0.29, 0.43)
        c.setFillColorRGB(0.20, 0.29, 0.43)

        # Wordmark
        c.setFont("Helvetica-Bold", 11)
        c.drawRightString(logo_right - 52, logo_top, "DISU")

        # Symbol 1 (diamond + chevron)
        s1x = logo_right - 37
        s1y = logo_top - 1
        c.setLineWidth(1.0)
        p = c.beginPath()
        p.moveTo(s1x, s1y + 7)
        p.lineTo(s1x + 7, s1y)
        p.lineTo(s1x, s1y - 7)
        p.lineTo(s1x - 7, s1y)
        p.close()
        c.drawPath(p, stroke=1, fill=0)
        c.line(s1x - 3.5, s1y, s1x + 3, s1y + 3.5)
        c.line(s1x - 3.5, s1y, s1x + 3, s1y - 3.5)

        # Symbol 2 (tilted grid mark)
        s2x = logo_right - 17
        s2y = logo_top - 1
        c.saveState()
        c.translate(s2x, s2y)
        c.rotate(8)
        c.setLineWidth(0.95)
        c.rect(-6.5, -6, 13, 12, stroke=1, fill=0)
        c.line(-2.2, -6, -2.2, 6)
        c.line(2.2, -6, 2.2, 6)
        c.line(-6.5, -2.0, 6.5, -2.0)
        c.line(-6.5, 2.0, 6.5, 2.0)
        c.restoreState()

        c.restoreState()

    def ensure_space(min_y: float = None) -> None:
        nonlocal y
        threshold = min_y if min_y is not None else bottom
        if y < threshold:
            new_page()

    def wrap_text(text: str, font_name: str, font_size: int, max_width: float) -> list[str]:
        c.setFont(font_name, font_size)
        words = text.split()
        if not words:
            return [""]
        lines: list[str] = []
        cur = words[0]
        for w in words[1:]:
            trial = f"{cur} {w}"
            if c.stringWidth(trial, font_name, font_size) <= max_width:
                cur = trial
            else:
                lines.append(cur)
                cur = w
        lines.append(cur)
        return lines

    def draw_heading(text: str, level: int = 2) -> None:
        nonlocal y
        if level == 1:
            font, size, gap = "Helvetica-Bold", 13, 0.22 * inch
        else:
            font, size, gap = "Helvetica-Bold", 12, 0.20 * inch
        ensure_space(bottom + 0.6 * inch)
        c.setFont(font, size)
        c.drawString(x, y, text)
        y -= gap
        c.setFont("Helvetica", 10)

    def draw_paragraph(text: str, font_size: int = 10) -> None:
        nonlocal y
        max_width = width - left - right
        line_h = 0.17 * inch if font_size >= 10 else 0.155 * inch
        para_gap = 0.10 * inch
        c.setFont("Helvetica", font_size)

        for raw in text.split("\n"):
            line = raw.strip()
            if not line:
                y -= para_gap
                continue
            wrapped = wrap_text(line, "Helvetica", font_size, max_width)
            for wline in wrapped:
                ensure_space()
                c.drawString(x, y, wline)
                y -= line_h
            y -= para_gap

    def draw_table(title_: str, rows: List[List[str]]) -> None:
        """
        Simple compact table: no grid, just aligned columns.
        """
        nonlocal y
        draw_heading(title_, level=2)

        max_width = width - left - right
        font = "Helvetica"
        font_size = 8.8
        line_h = 0.145 * inch
        gap = 0.08 * inch

        # compute column widths (cap)
        ncols = max(len(r) for r in rows) if rows else 0
        if ncols == 0:
            return

        # rough allocation: first col wider
        col_widths = []
        if ncols == 1:
            col_widths = [max_width]
        else:
            first = max_width * 0.52
            rest = (max_width - first) / (ncols - 1)
            col_widths = [first] + [rest] * (ncols - 1)

        c.setFont(font, font_size)

        for i, r in enumerate(rows):
            ensure_space(bottom + 0.25 * inch)
            # header row slightly bolder if it contains non-numeric labels
            if i == 0:
                c.setFont("Helvetica-Bold", font_size)
            else:
                c.setFont(font, font_size)

            cx = x
            for j in range(ncols):
                cell = r[j] if j < len(r) else ""
                cell = _safe_str(cell)

                # wrap within column if needed
                lines = wrap_text(cell, c._fontname, c._fontsize, col_widths[j])
                # only show first line to keep compact
                cell_line = lines[0] if lines else ""
                c.drawString(cx, y, cell_line)
                cx += col_widths[j]

            y -= line_h

        y -= gap

    def draw_segments(segments_obj: Any) -> None:
        nonlocal y
        if not segments_obj or not getattr(segments_obj, "segments", None):
            return

        draw_heading("Operating Segments", level=2)

        # table rows
        segs = segments_obj.segments
        total_pct = sum(float(getattr(s, "pct", 0.0) or 0.0) for s in segs)
        rows = [["Segment", "Share"]]
        for s in segs[:8]:
            rows.append([_safe_str(getattr(s, "name", "")), f"{float(getattr(s, 'pct', 0.0) or 0.0):.1f}%"])
        # normalize display if pct missing
        if total_pct < 1.0:
            rows = [["Segment", "Value"]] + [[_safe_str(getattr(s, "name", "")), _safe_str(getattr(s, "value", ""))] for s in segs[:8]]

        # draw table
        draw_table("Segments (share)", rows)

        # pie chart
        charts_dir = out_path.parent / "_charts"
        png = _render_pie_chart_png(charts_dir / "segments.png", segments_obj)
        if png and png.exists():
            ensure_space(bottom + 2.3 * inch)
            img_w = 3.1 * inch
            img_h = 2.3 * inch
            c.drawImage(str(png), x, y - img_h + 0.1 * inch, width=img_w, height=img_h, preserveAspectRatio=True, mask="auto")
            y -= img_h + 0.15 * inch

    def draw_statements(statements_obj: Any) -> None:
        if not statements_obj:
            return

        # statements_obj is expected to be a dict:
        # {"units": "...", "income": Table|None, "balance": Table|None, "cashflow": Table|None}
        units = (statements_obj.get("units") if isinstance(statements_obj, dict) else None) or ""

        draw_heading("Financial Picture", level=2)
        draw_paragraph("Condensed financial statements from the latest filing.", font_size=9)
        if units:
            draw_paragraph(f"Units: {units}", font_size=9)

        is_tbl = statements_obj.get("income") if isinstance(statements_obj, dict) else None
        bs_tbl = statements_obj.get("balance") if isinstance(statements_obj, dict) else None
        cf_tbl = statements_obj.get("cashflow") if isinstance(statements_obj, dict) else None


        if is_tbl and getattr(is_tbl, "rows", None):
            draw_table("Income Statement (condensed)", is_tbl.rows)
        if bs_tbl and getattr(bs_tbl, "rows", None):
            draw_table("Balance Sheet (condensed)", bs_tbl.rows)
        if cf_tbl and getattr(cf_tbl, "rows", None):
            draw_table("Cash Flow (condensed)", cf_tbl.rows)

    def draw_news(items: Optional[List[Any]], summary: Optional[str]) -> None:
        nonlocal y
        if not items and not summary:
            return

        if y < bottom + 1.2 * inch:
            return

        draw_heading("Latest News", level=2)

        if summary:
            draw_paragraph(summary.strip(), font_size=10)

        if items:
            # show up to 6 compact headlines
            max_width = width - left - right
            line_h = 0.155 * inch
            c.setFont("Helvetica", 9)

            for it in items[:6]:
                ensure_space(bottom + 0.25 * inch)
                src = _safe_str(getattr(it, "source", ""))
                title_ = _safe_str(getattr(it, "title", ""))
                line = f"• {src}: {title_}".strip()
                wrapped = wrap_text(line, "Helvetica", 9, max_width)
                c.drawString(x, y, wrapped[0])
                y -= line_h

            y -= 0.10 * inch

    # ---------- title ----------
    draw_watermark()
    draw_page_logo()
    c.setFont("Helvetica-Bold", 18)
    ensure_space(bottom + 0.5 * inch)
    c.drawString(x, y, title)
    y -= 0.35 * inch

    # ---------- body (filtered) ----------
    body = _filter_body_lines(body)

    max_width = width - left - right
    line_h = 0.17 * inch
    para_gap = 0.10 * inch

    for raw in body.split("\n"):
        line = raw.rstrip()

        if not line.strip():
            y -= para_gap
            continue

        if line.lstrip().startswith("#"):
            level = len(line) - len(line.lstrip("#"))
            text = line.lstrip("#").strip()

            # ---- IN-PLACE ARTIFACT RENDERING (fixes ordering) ----
            tnorm = text.lower().strip()
            if level == 2:
                if tnorm.startswith("operating segments"):
                    draw_segments(segments)
                    continue

                if (
                    tnorm.startswith("condensed financials")
                    or tnorm.startswith("financial picture")
                    or "condensed financial picture" in tnorm
                ):
                    draw_statements(statements)
                    continue

                if tnorm.startswith("latest news"):
                    draw_news(news_items, news_summary)
                    continue

                ensure_space(bottom + 1.2 * inch)
            else:
                ensure_space(bottom + 0.6 * inch)

            if level <= 1:
                font_name, font_size, gap = "Helvetica-Bold", 13, 0.24 * inch
            elif level == 2:
                font_name, font_size, gap = "Helvetica-Bold", 12, 0.22 * inch
            else:
                font_name, font_size, gap = "Helvetica-Bold", 11, 0.20 * inch

            c.setFont(font_name, font_size)
            c.drawString(x, y, text)
            y -= gap
            c.setFont("Helvetica", 10)
            continue

        stripped = line.strip()
        is_bullet = stripped.startswith("- ") or stripped.startswith("• ")
        bullet_char = "•" if is_bullet else ""
        bullet_text = stripped[2:].strip() if is_bullet else stripped

        bullet_indent = 0.22 * inch if is_bullet else 0.0
        bullet_gap = 0.14 * inch if is_bullet else 0.0

        font_name = "Helvetica"
        font_size = 10

        available_width = max_width - bullet_indent - bullet_gap
        wrapped_lines = wrap_text(bullet_text, font_name, font_size, available_width)

        for k, wline in enumerate(wrapped_lines):
            ensure_space()

            if is_bullet:
                if k == 0:
                    c.setFont(font_name, font_size)
                    c.drawString(x, y, bullet_char)
                c.setFont(font_name, font_size)
                c.drawString(x + bullet_indent + bullet_gap, y, wline)
            else:
                c.setFont(font_name, font_size)
                c.drawString(x, y, wline)

            y -= line_h

        y -= para_gap

    footer()
    c.save()
