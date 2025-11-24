"""
Scrape the latest comments from the Yahoo Finance community page for a ticker.

Requirements:
    pip install playwright
    playwright install chromium
"""

import sys
import time
from dataclasses import dataclass
from typing import List, Optional

from playwright.sync_api import (
    TimeoutError as PlaywrightTimeoutError,
    sync_playwright,
)


YF_COMMUNITY_URL = "https://finance.yahoo.com/quote/{ticker}/community/"
DEFAULT_COMMENT_LIMIT = 10


@dataclass
class CommunityComment:
    message_id: str
    username: str
    timestamp: str
    sentiment_tag: Optional[str]
    text: str


def _maybe_click(page, selector: str, timeout: int = 4000) -> None:
    """Best-effort click helper; ignore if the element never appears."""
    try:
        button = page.locator(selector)
        page.locator("body").press("Escape")
        button.first.scroll_into_view_if_needed(timeout=timeout)
        button.first.click(timeout=timeout)
    except PlaywrightTimeoutError:
        pass
    except Exception:
        pass


def _deep_scroll_to_bottom(page, passes: int = 4, pause: float = 0.8) -> None:
    """Scroll repeatedly to the bottom of the page to trigger lazy loads."""
    for _ in range(passes):
        try:
            page.evaluate("window.scrollTo(0, document.body.scrollHeight);")
        except Exception:
            page.mouse.wheel(0, 6000)
        page.wait_for_timeout(int(pause * 1000))
    try:
        page.evaluate("window.scrollTo(0, 0);")
    except Exception:
        page.mouse.wheel(0, -6000)
        page.wait_for_timeout(300)


def _dismiss_banners(page) -> None:
    """Handle cookie / consent dialogs so that comments are visible."""
    page.wait_for_timeout(500)

    def _nudge_viewport():
        try:
            page.mouse.wheel(0, 2000)
            page.wait_for_timeout(200)
            page.mouse.wheel(0, -1800)
            page.wait_for_timeout(200)
        except Exception:
            pass

    # Yahoo cookie banner variants (English + Swedish)
    banner_selectors = [
        "button:has-text('Accept all')",
        "button:has-text('Accept All')",
        "button:has-text('I agree')",
        "button:has-text('Reject all')",
        "button:has-text('Reject All')",
        "button:has-text('Avvisa alla')",
        "button:has-text('Avvisa Alla')",
    ]
    for _ in range(3):
        clicked = False
        for selector in banner_selectors:
            before = page.locator(selector).count()
            if before == 0:
                continue
            _nudge_viewport()
            _maybe_click(page, selector)
            after = page.locator(selector).count()
            if before != after:
                clicked = True
        if clicked:
            break

    # Force a deep scroll after dismissal to trigger lazy load + ensure banner hidden
    try:
        page.mouse.wheel(0, 6000)
        page.wait_for_timeout(500)
        page.mouse.wheel(0, -4000)
    except Exception:
        pass


def _expand_dynamic_sections(page, max_rounds: int = 5) -> None:
    """Click 'View comments', 'View replies', and 'See more' controls to reveal content."""
    expand_selectors = [
        "button:has-text('View comments')",
        "button:has-text('View Comments')",
        "button:has-text('View more comments')",
        "button:has-text('View more replies')",
        "button:has-text('View replies')",
        "span:has-text('See more')",
    ]

    for _ in range(max_rounds):
        clicked_any = False
        for selector in expand_selectors:
            locator = page.locator(selector)
            instances = locator.count()
            if instances == 0:
                continue
            for idx in range(min(instances, 5)):
                try:
                    locator.nth(idx).click()
                    page.wait_for_timeout(150)
                    clicked_any = True
                except PlaywrightTimeoutError:
                    continue
                except Exception:
                    continue
        if not clicked_any:
            break


def _ensure_sort_mode(page, value: str = "Newest") -> None:
    """Open the sort menu and ensure the desired sort option is selected."""
    try:
        sort_button = page.locator("button#spotim-sort-by")
        sort_button.wait_for(state="visible", timeout=5000)
        sort_button.click()
        menu = page.locator('div[data-testid="sorting-menu"]')
        menu.wait_for(state="visible", timeout=3000)
        target_option = menu.locator(
            f'button[data-testid="{value.lower()}"], span:has-text("{value}")'
        )
        target_option.first.click()
        page.wait_for_timeout(400)
    except PlaywrightTimeoutError:
        pass
    except Exception:
        pass


def _scroll_for_more(page, pause: float = 1.0) -> None:
    """Scroll down to trigger lazy loading of additional comments."""
    page.mouse.wheel(0, 2500)
    page.wait_for_timeout(pause * 1000)


def _extract_comment(element) -> Optional[CommunityComment]:
    """Convert a single comment DOM element into a data object."""
    try:
        message_id = element.get_attribute("data-message-id") or ""
        username = (
            element.locator('[data-spot-im-class="message-username"]')
            .inner_text(timeout=1000)
            .strip()
        )
        timestamp = (
            element.locator('[data-spot-im-class="message-timestamp"]')
            .get_attribute("title")
            or element.locator('[data-spot-im-class="message-timestamp"]').inner_text(
                timeout=1000
            )
        )
        sentiment_tag = None
        sentiment_locator = element.locator(
            ".components-MessageContent-components-CommentLabel-index__label"
        )
        if sentiment_locator.count() > 0:
            sentiment_tag = sentiment_locator.first.inner_text().strip()
        text = (
            element.locator('[data-spot-im-class="message-text"]')
            .inner_text(timeout=1000)
            .strip()
        )
        return CommunityComment(
            message_id=message_id,
            username=username,
            timestamp=timestamp.strip(),
            sentiment_tag=sentiment_tag,
            text=text,
        )
    except PlaywrightTimeoutError:
        return None
    except Exception:
        return None


def fetch_latest_comments(ticker: str, limit: int = DEFAULT_COMMENT_LIMIT) -> List[CommunityComment]:
    url = YF_COMMUNITY_URL.format(ticker=ticker.upper())
    print(f"🔗 Visiting {url}\n")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(locale="en-US")
        page = context.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)
        _deep_scroll_to_bottom(page)
        _dismiss_banners(page)
        _ensure_sort_mode(page, "Newest")
        _expand_dynamic_sections(page)

        try:
            page.wait_for_selector(
                "ow-ads_conversation_comment-list li",
                timeout=20000,
            )
            message_views = page.locator(
                "ow-ads_conversation_comment-list div.components-MessageLayout-index__message-view"
            )
            first_two: List[CommunityComment] = []
            for idx in range(min(2, message_views.count())):
                extracted = _extract_comment(message_views.nth(idx))
                if extracted:
                    first_two.append(extracted)
            if first_two:
                print("📥 First two comments loaded:")
                for idx, comment in enumerate(first_two, start=1):
                    sentiment = f"[{comment.sentiment_tag}]" if comment.sentiment_tag else ""
                    print(f"   {idx}. {sentiment} {comment.username} – {comment.timestamp}")
                    print(f"      {comment.text}")
        except PlaywrightTimeoutError:
            raise RuntimeError("Timed out waiting for community comments to load.")

        comments: List[CommunityComment] = []
        seen_ids = set()
        attempts_without_growth = 0

        while len(comments) < limit and attempts_without_growth < 6:
            elements = page.locator("div.components-MessageLayout-index__message-view")
            count = elements.count()
            start_len = len(comments)

            for idx in range(count):
                comment = _extract_comment(elements.nth(idx))
                if comment and comment.message_id not in seen_ids:
                    seen_ids.add(comment.message_id)
                    comments.append(comment)
                    if len(comments) >= limit:
                        break

            if len(comments) == start_len:
                attempts_without_growth += 1
            else:
                attempts_without_growth = 0

            if len(comments) < limit:
                _ensure_sort_mode(page, "Newest")
                _scroll_for_more(page)
                _expand_dynamic_sections(page)

        browser.close()
        return comments[:limit]


def main():
    ticker = input("Enter ticker symbol (e.g. AAPL): ").strip().upper()
    if not ticker:
        print("Ticker is required.")
        sys.exit(1)

    try:
        comments = fetch_latest_comments(ticker)
    except RuntimeError as exc:
        print(f"⚠️  {exc}")
        sys.exit(1)

    if not comments:
        print("No comments found.")
        return

    print(f"\n📝 Latest {len(comments)} comments for {ticker}:\n")
    for idx, comment in enumerate(comments, start=1):
        sentiment = f"[{comment.sentiment_tag}]" if comment.sentiment_tag else ""
        print(f"{idx}. {sentiment} {comment.username} – {comment.timestamp}")
        print(comment.text)
        print("-" * 80)


if __name__ == "__main__":
    main()
