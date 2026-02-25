import re
import warnings
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

# Silence noisy warning; we still parse as HTML for robustness.
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

def html_to_clean_text(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")

    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    root = soup.body if soup.body else soup
    text = root.get_text(separator="\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()
