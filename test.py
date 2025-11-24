#!/usr/bin/env python3
"""
reddit_sentiment_gsheet_v2.py
- Reads Watchlist tickers from your Google Sheet (auto-detect headers).
- Runs Reddit sentiment scraping (10 subreddits, max 200 comments per ticker).
- Caches comments to speed repeated runs.
- Writes numeric sentiment score back to the detected "Sentiment Score" column.
"""

import os
import csv
import re
import time
import pickle
from datetime import datetime
from dotenv import load_dotenv
import nltk
from nltk.sentiment.vader import SentimentIntensityAnalyzer
import praw
from concurrent.futures import ThreadPoolExecutor, as_completed
from sentence_transformers import SentenceTransformer, util
import numpy as np
from tqdm import tqdm
import prawcore
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from typing import Dict, List, Tuple

# --- Setup / env ---
nltk.download("vader_lexicon", quiet=True)
load_dotenv()

REDDIT_CLIENT_ID = os.getenv("REDDIT_CLIENT_ID")
REDDIT_CLIENT_SECRET = os.getenv("REDDIT_CLIENT_SECRET")
REDDIT_USER_AGENT = os.getenv("REDDIT_USER_AGENT")

SHEET_KEY_PATH = os.getenv("GOOGLE_SHEET_KEY_PATH")
SHEET_NAME = os.getenv("GOOGLE_SHEET_NAME")
WATCHLIST_TAB = os.getenv("WATCHLIST_TAB_NAME")
PORTFOLIO_MASTER_TAB = os.getenv("PORTFOLIO_MASTER_TAB_NAME")

# --- Parameters you specified ---
SUBREDDITS = [
    "personalfinance", "wallstreetbets", "CryptoCurrency", "stocks", "StockMarket",
    "investing", "financialindependence", "Options", "SecurityAnalysis", "dividendinvesting"
]
MAX_COMMENTS_PER_TICKER = 200
POSTS_PER_SUBREDDIT = 50         # can adjust later
TICKER_CONCURRENCY = 3
SUBREDDIT_QUERY_SLEEP = 2        # seconds between subreddit queries per ticker
TICKER_SLEEP = 3                 # seconds between ticker runs (helps rate-limit safety)
CACHE_DIR = "reddit_cache_v2"
CSV_DIR = "reddit_csv_v2"

os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(CSV_DIR, exist_ok=True)

# --- Initialize clients & models ---
reddit = praw.Reddit(
    client_id=REDDIT_CLIENT_ID,
    client_secret=REDDIT_CLIENT_SECRET,
    user_agent=REDDIT_USER_AGENT
)

sia = SentimentIntensityAnalyzer()
# Lightweight good performer
model = SentenceTransformer("all-MiniLM-L6-v2")

# --- Finance keyword boosts/penalties ---
financial_keywords = {
    "moon": 0.3, "dip": -0.2, "puts": -0.3, "calls": 0.3,
    "bagholder": -0.4, "bullish": 0.4, "bearish": -0.4, "rocket": 0.2,
    "short squeeze": 0.3, "dump": -0.3, "pump": 0.2, "load up": 0.3
}

# --- Utility helpers ---
def col_idx_to_letter(idx: int) -> str:
    """0-based idx -> Excel column letter (A, B, ...)."""
    idx += 1
    letters = ""
    while idx:
        idx, rem = divmod(idx - 1, 26)
        letters = chr(65 + rem) + letters
    return letters

def normalize_header(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").strip().lower())

def find_header_row_and_map(ws, required_headers: List[str], peek_rows: int = 10) -> Tuple[int, Dict[str,int]]:
    """
    Returns (header_row_index (1-based), {header_key: col_index(0-based)})
    header search is case-insensitive and tolerant of spaces/punctuation.
    """
    data = ws.get_all_values()[:peek_rows]
    for r_idx, row in enumerate(data, start=1):
        norm_row = [normalize_header(c) for c in row]
        mapping = {}
        matched = 0
        for header in required_headers:
            norm_h = normalize_header(header)
            if norm_h in norm_row:
                mapping[header] = norm_row.index(norm_h)
                matched += 1
        if matched >= 2:  # at least ticker + company or sentiment
            return r_idx, mapping
    # fallback: assume header is row 1
    return 1, {hdr: idx for idx, hdr in enumerate(data[0])}

def build_alias_list(ticker, company_name):
    base_aliases = [ticker.lower(), f"${ticker.lower()}"]
    if company_name:
        name_clean = re.sub(r"[\.,]|inc|corp|ltd|plc|group|co", "", company_name.lower())
        parts = [p for p in name_clean.split() if p]
        base_aliases += [name_clean] + parts
    return list(set(base_aliases))

def adjust_sentiment(comment, vader_score):
    adjusted = vader_score
    lc = comment.lower()
    for word, multiplier in financial_keywords.items():
        if word in lc:
            adjusted += multiplier
    return max(min(adjusted, 1.0), -1.0)

SPAM_PATTERNS = [
    r"diamond hands", r"tendies", r"ape gang", r"shitpost", r"rekt",
    r"moon!!!", r"stonks", r"🚀", r"💎", r"🦍"
]

def is_quality_comment(text):
    if not text or len(text) < 10 or len(text.split()) < 3:
        return False
    low = text.lower()
    return not any(re.search(p, low) for p in SPAM_PATTERNS)

def is_relevant_comment(comment, alias_list, reference_embedding, threshold=0.35):
    text = comment.lower()
    if any(alias in text for alias in alias_list):
        return True
    # semantic similarity check
    comment_embedding = model.encode(text, convert_to_tensor=True)
    sim_score = util.cos_sim(reference_embedding, comment_embedding).item()
    return sim_score >= threshold

# --- Caching helpers ---
def cache_path_for_ticker(ticker: str) -> str:
    return os.path.join(CACHE_DIR, f"cache_{ticker.upper()}.pkl")

def load_cache(ticker: str):
    path = cache_path_for_ticker(ticker)
    if os.path.exists(path):
        try:
            with open(path, "rb") as f:
                return pickle.load(f)
        except Exception:
            return []
    return []

def save_cache(ticker: str, comments: List[dict]):
    path = cache_path_for_ticker(ticker)
    try:
        with open(path, "wb") as f:
            pickle.dump(comments, f)
    except Exception as e:
        print(f"⚠️ Failed saving cache for {ticker}: {e}")

# --- Reddit fetch / scoring ---
def fetch_comments_from_submission(submission, alias_list, reference_embedding, per_submission_cap=50):
    """
    Fetch comments for a single submission: limit replace_more and cap the #comments returned.
    """
    try:
        submission.comments.replace_more(limit=2)
        collected = []
        for comment in submission.comments.list()[:per_submission_cap]:
            if getattr(comment, "body", None) and is_quality_comment(comment.body):
                if is_relevant_comment(comment.body, alias_list, reference_embedding):
                    collected.append({
                        "text": comment.body,
                        "created_utc": comment.created_utc,
                        "upvotes": getattr(comment, "score", 0),
                        "subreddit": submission.subreddit.display_name
                    })
        return collected
    except prawcore.exceptions.TooManyRequests as e:
        sleep_time = getattr(e, "sleep_time", 60)
        print(f"⏳ Rate limited on submission fetch. Sleeping {sleep_time}s...")
        time.sleep(sleep_time)
        return []
    except Exception as e:
        # log and skip this submission
        # print(f"⚠️ Error fetching submission {getattr(submission,'id', 'unknown')}: {e}")
        return []

def compute_sentiment_for_ticker(ticker: str, company_name: str) -> Tuple[float, int]:
    """
    Returns (sentiment_index (0-100), n_comments_used)
    """
    ticker_up = ticker.upper()
    print(f"\n--- Processing {ticker_up} ---")
    alias_list = build_alias_list(ticker_up, company_name)
    reference_text = f"This comment discusses {company_name or ticker_up} or its stock performance."
    reference_embedding = model.encode(reference_text, convert_to_tensor=True)

    # Load cache and get last timestamp to fetch only newer later (we still enforce max comments total)
    cached = load_cache(ticker_up)
    cached_texts = {c["text"] for c in cached}
    all_comments = list(cached)  # start with cache (older comments)

    # Fetch submissions from each subreddit (with a small sleep to be polite)
    submissions = []
    for sub in SUBREDDITS:
        try:
            subs = list(reddit.subreddit(sub).search(f"{ticker_up} OR ${ticker_up}",
                                                     sort="new", time_filter="month", limit=POSTS_PER_SUBREDDIT))
            submissions.extend(subs)
        except Exception as e:
            print(f"⚠️ Error searching {sub} for {ticker_up}: {e}")
        time.sleep(SUBREDDIT_QUERY_SLEEP)

    # dedupe submissions by id
    subs_by_id = {}
    for s in submissions:
        try:
            sid = s.id
            subs_by_id[sid] = s
        except Exception:
            continue
    submissions = list(subs_by_id.values())

    # Fetch comments per submission (limited concurrency but in serial here to better respect rate limits)
    # We'll fetch in small parallel batches of submissions to speed up slightly but avoid huge bursts.
    N_BATCH = 8
    per_submission_cap = 200  # we still cap total comments after collating
    for i in range(0, len(submissions), N_BATCH):
        batch = submissions[i:i+N_BATCH]
        with ThreadPoolExecutor(max_workers=min(4, len(batch))) as ex:
            futures = [ex.submit(fetch_comments_from_submission, s, alias_list, reference_embedding, 50) for s in batch]
            for fut in as_completed(futures):
                try:
                    res = fut.result()
                    for c in res:
                        if c["text"] not in cached_texts:
                            all_comments.append(c)
                            cached_texts.add(c["text"])
                except Exception:
                    continue
        # stop early if we have enough comments
        if len(all_comments) >= MAX_COMMENTS_PER_TICKER:
            break

    # Enforce hard cap and keep most recent by created_utc
    all_comments_sorted = sorted(all_comments, key=lambda c: c.get("created_utc", 0), reverse=True)
    selected_comments = all_comments_sorted[:MAX_COMMENTS_PER_TICKER]

    # Save updated cache (merge cached + new selected comments)
    save_cache(ticker_up, selected_comments)

    # If no comments, return neutral 50
    if not selected_comments:
        print(f"[{ticker_up}] No relevant comments found — returning neutral 50.")
        return 50.0, 0

    # Score comments in parallel
    def score_comment(c):
        vader = sia.polarity_scores(c["text"])["compound"]
        adj = adjust_sentiment(c["text"], vader)
        weight = max(c.get("upvotes", 0), 1)
        return adj, weight

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(score_comment, selected_comments))

    sentiments, weights = zip(*results)
    weighted_avg = float(np.average(sentiments, weights=weights))
    sentiment_index = round(50 + 50 * weighted_avg, 2)

    # Save per-ticker CSV for audit
    csvfile = os.path.join(CSV_DIR, f"reddit_sentiment_{ticker_up}_v4.csv")
    try:
        with open(csvfile, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["Index", "SentimentScore", "Upvotes", "Subreddit", "DateUTC", "Comment"])
            for i, c in enumerate(selected_comments, 1):
                vader = sia.polarity_scores(c["text"])["compound"]
                adj = adjust_sentiment(c["text"], vader)
                date = datetime.utcfromtimestamp(c["created_utc"]).strftime("%Y-%m-%d %H:%M:%S")
                writer.writerow([i, f"{adj:.2f}", c["upvotes"], c["subreddit"], date, c["text"]])
    except Exception as e:
        print(f"⚠️ Failed to write CSV for {ticker_up}: {e}")

    print(f"[{ticker_up}] Comments used: {len(selected_comments)} → Sentiment: {sentiment_index}/100")
    return sentiment_index, len(selected_comments)

# --- Main orchestration: Sheets + concurrency ---
def main():
    # Google Sheets setup
    scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
    creds = ServiceAccountCredentials.from_json_keyfile_name(SHEET_KEY_PATH, scope)
    gc = gspread.authorize(creds)
    sheet = gc.open(SHEET_NAME)
    watchlist_ws = sheet.worksheet(WATCHLIST_TAB)
    portfolio_ws = sheet.worksheet(PORTFOLIO_MASTER_TAB)

    # Read a bunch of rows to detect headers (we'll read all once header located)
    peek = watchlist_ws.get_all_values()
    if not peek:
        raise SystemExit("Watchlist sheet is empty or not reachable.")

    header_row, mapping = find_header_row_and_map(watchlist_ws, ["Ticker", "Company Name", "Sentiment Score"], peek_rows=10)
    print(f"Detected header row at {header_row}, mapping: {mapping}")

    # read full sheet now
    data = watchlist_ws.get_all_values()
    # rows after header row are the data
    data_rows = data[header_row:]  # 0-based list; header_row is 1-based
    # map columns (if missing, try to find approximate columns)
    def get_col_index(header_name):
        if header_name in mapping:
            return mapping[header_name]
        # fallback: search header row for a fuzzy match
        hdrs_norm = [normalize_header(x) for x in data[header_row-1]]
        target_norm = normalize_header(header_name)
        if target_norm in hdrs_norm:
            return hdrs_norm.index(target_norm)
        # final fallback: raise
        raise KeyError(f"Header '{header_name}' not found in sheet.")

    ticker_col = get_col_index("Ticker")
    company_col = get_col_index("Company Name")
    sentiment_col = get_col_index("Sentiment Score")

    # Build list of tickers and original row numbers
    tickers_info = []
    for row_idx, row in enumerate(data_rows, start=header_row+1):  # actual sheet row numbers
        # some rows shorter than header length possible
        ticker = row[ticker_col].strip() if len(row) > ticker_col else ""
        company = row[company_col].strip() if len(row) > company_col else ""
        if ticker:
            tickers_info.append((row_idx, ticker.upper(), company))

    print(f"Found {len(tickers_info)} tickers in Watchlist to process.")

    # Process tickers in parallel batches (ticker-level concurrency)
    results_by_row = {}  # row -> (sentiment_value, n_comments)
    def worker(tup):
        rownum, tick, comp = tup
        try:
            sent, n = compute_sentiment_for_ticker(tick, comp)
            time.sleep(TICKER_SLEEP)
            return rownum, float(sent), int(n)
        except Exception as e:
            print(f"⚠️ Error processing {tick}: {e}")
            return rownum, 50.0, 0

    # Use ThreadPoolExecutor at ticker granularity
    with ThreadPoolExecutor(max_workers=TICKER_CONCURRENCY) as ex:
        futures = {ex.submit(worker, t): t for t in tickers_info}
        for fut in tqdm(as_completed(futures), total=len(futures), desc="Tickers"):
            rownum, sent_val, ncomm = fut.result()
            results_by_row[rownum] = (sent_val, ncomm)

    # Build batch update values for the sentiment column
    if not results_by_row:
        print("No results to write. Exiting.")
        return

    # Determine start and end rows for update (min to max)
    all_rows = sorted(results_by_row.keys())
    start_row = all_rows[0]
    end_row = all_rows[-1]
    num_rows = end_row - start_row + 1

    # Prepare values list (one column matrix) default empty
    values = [[""] for _ in range(num_rows)]
    for rownum, (sent_val, ncomm) in results_by_row.items():
        idx = rownum - start_row
        values[idx][0] = str(sent_val)

    # compute column letter for sentiment_col
    sentiment_col_letter = col_idx_to_letter(sentiment_col)
    range_a1 = f"{sentiment_col_letter}{start_row}:{sentiment_col_letter}{end_row}"
    print(f"Batch updating Sentiment column {range_a1} with {len(results_by_row)} results...")
    try:
        watchlist_ws.update(range_a1, values, value_input_option="USER_ENTERED")
    except Exception as e:
        print(f"⚠️ Failed batch update: {e}")
        # fallback to per-cell updates
        for rownum, (sent_val, _) in results_by_row.items():
            try:
                watchlist_ws.update_acell(f"{sentiment_col_letter}{rownum}", str(sent_val))
                time.sleep(0.25)
            except Exception as e2:
                print(f"Failed to update {rownum}: {e2}")

    print("\n✅ All done. Sentiment scores updated in Watchlist.")
    # Optionally print summary
    for rownum in sorted(results_by_row.keys()):
        s, n = results_by_row[rownum]
        print(f"Row {rownum}: {s} (comments used: {n})")

if __name__ == "__main__":
    main()
