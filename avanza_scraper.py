
"""
Minimal Playwright helper that opens Placera's Axfood forum page and prints the
body text of the first two visible posts.
"""

import sys
from typing import Optional

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

PLACERA_AXFOOD_URL = "https://forum.placera.se/bolag/axfood"


def _dismiss_popups(page) -> None:
    """Best-effort cookie/consent dismissal."""
    selectors = [
        "#onetrust-accept-btn-handler",
        "button:has-text('Godkänn alla')",
        "button:has-text('Acceptera alla')",
        "button:has-text('Accept all')",
    ]

    for selector in selectors:
        try:
            locator = page.locator(selector)
            if locator.count():
                locator.first.click(timeout=1500)
                page.wait_for_timeout(500)
                break
        except PlaywrightTimeoutError:
            continue
        except Exception:
            continue


def _extract_post(page, index: int) -> Optional[str]:
    """Return the text contents of the nth forum post body (0-based)."""
    try:
        post = page.locator("div.post-body").nth(index)
        post.wait_for(state="visible", timeout=10000)
        return post.inner_text().strip()
    except PlaywrightTimeoutError:
        return None
    except Exception:
        return None


def fetch_first_axfood_posts(count: int = 2) -> list[str]:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(locale="sv-SE")
        page = context.new_page()
        page.goto(PLACERA_AXFOOD_URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)
        _dismiss_popups(page)
        posts: list[str] = []
        for idx in range(count):
            text = _extract_post(page, idx)
            if text:
                posts.append(text)
        browser.close()
        return posts


def main():
    print(f"🔗 Opening {PLACERA_AXFOOD_URL}")
    posts = fetch_first_axfood_posts()
    if not posts:
        print("⚠️  Failed to find forum posts.")
        sys.exit(1)
    print("\n📝 First forum posts:\n")
    for idx, text in enumerate(posts, start=1):
        print(f"{idx}. {text}\n")


if __name__ == "__main__":
    main()


