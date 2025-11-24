import os
import csv
import re
import time
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

# --- Setup ---
nltk.download("vader_lexicon", quiet=True)
load_dotenv()

# --- Reddit API ---
REDDIT_CLIENT_ID = os.getenv("REDDIT_CLIENT_ID")
REDDIT_CLIENT_SECRET = os.getenv("REDDIT_CLIENT_SECRET")
REDDIT_USER_AGENT = os.getenv("REDDIT_USER_AGENT")

reddit = praw.Reddit(
    client_id=REDDIT_CLIENT_ID,
    client_secret=REDDIT_CLIENT_SECRET,
    user_agent=REDDIT_USER_AGENT
)

sia = SentimentIntensityAnalyzer()
model = SentenceTransformer("all-MiniLM-L6-v2")

# --- Financial keyword sentiment adjustments ---
financial_keywords = {
    "moon": 0.3, "dip": -0.2, "puts": -0.3, "calls": 0.3,
    "bagholder": -0.4, "bullish": 0.4, "bearish": -0.4, "rocket": 0.2,
    "short squeeze": 0.3, "dump": -0.3, "pump": 0.2, "load up": 0.3
}

# --- Dynamic alias builder ---
def build_alias_list(ticker, company_name):
    base_aliases = [ticker.lower(), f"${ticker.lower()}"]
    if company_name:
        name_clean = re.sub(r"[\.,]|inc|corp|ltd|plc|group|co", "", company_name.lower())
        parts = name_clean.split()
        base_aliases += [name_clean] + parts
    return list(set(base_aliases))

# --- Adjust sentiment based on finance slang ---
def adjust_sentiment(comment, vader_score):
    adjusted = vader_score
    for word, multiplier in financial_keywords.items():
        if word in comment.lower():
            adjusted += multiplier
    return max(min(adjusted, 1.0), -1.0)

# --- Comment quality filter ---
def is_quality_comment(text):
    if len(text) < 10 or len(text.split()) < 3:
        return False
    spam_patterns = [
        r"diamond hands", r"tendies", r"ape gang", r"shitpost", r"rekt",
        r"moon!!!", r"stonks", r"🚀", r"💎", r"🦍"
    ]
    return not any(re.search(p, text.lower()) for p in spam_patterns)

# --- Semantic + keyword relevance filter ---
def is_relevant_comment(comment, alias_list, reference_embedding, threshold=0.35):
    text = comment.lower()
    if any(alias in text for alias in alias_list):
        return True
    comment_embedding = model.encode(text, convert_to_tensor=True)
    sim_score = util.cos_sim(reference_embedding, comment_embedding).item()
    return sim_score >= threshold

# --- Fetch comments safely with rate limit handling ---
def fetch_comments(submission, alias_list, reference_embedding):
    try:
        submission.comments.replace_more(limit=2)
        comments_list = []
        for comment in submission.comments.list()[:200]:  # limit deep trees
            if comment.body and is_quality_comment(comment.body):
                if is_relevant_comment(comment.body, alias_list, reference_embedding):
                    comments_list.append({
                        "text": comment.body,
                        "created_utc": comment.created_utc,
                        "upvotes": comment.score,
                        "subreddit": submission.subreddit.display_name
                    })
        return comments_list

    except prawcore.exceptions.TooManyRequests as e:
        sleep_time = getattr(e, "sleep_time", 60)
        print(f"⏳ Rate limited. Sleeping {sleep_time}s...")
        time.sleep(sleep_time)
        return []
    except Exception as e:
        print(f"⚠️ Error fetching {submission.id}: {e}")
        return []

# --- Sentiment scoring ---
def score_comment(comment):
    vader = sia.polarity_scores(comment["text"])["compound"]
    adj = adjust_sentiment(comment["text"], vader)
    weight = max(comment["upvotes"], 1)
    return adj, weight

# --- Main ---
if __name__ == "__main__":
    ticker = input("Enter ticker symbol: ").strip().upper()
    company_name = input("Enter company name (optional): ").strip()
    days = 30

    now = int(time.time())
    after_timestamp = now - days * 24 * 60 * 60
    alias_list = build_alias_list(ticker, company_name)
    print(f"Alias list: {alias_list}")

    reference_text = f"This comment discusses {company_name or ticker} or its stock performance."
    reference_embedding = model.encode(reference_text, convert_to_tensor=True)

    # --- Fetch submissions ---
    subreddits = ["wallstreetbets", "stocks", "investing", "StockMarket", "options", "trading"]
    submissions = []
    for sub in subreddits:
        try:
            subs = list(reddit.subreddit(sub).search(
                f"{ticker} OR ${ticker}",
                sort="new",
                time_filter="month",
                limit=50
            ))
            submissions += subs
        except Exception as e:
            print(f"⚠️ Error searching in {sub}: {e}")

    print(f"\n🔎 Found {len(submissions)} submissions across {len(subreddits)} subreddits.")

    # --- Parallel comment fetching ---
    all_comments = []
    MAX_WORKERS = min(5, len(submissions))
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(fetch_comments, sub, alias_list, reference_embedding) for sub in submissions]
        for future in tqdm(as_completed(futures), total=len(futures), desc="Fetching comments"):
            all_comments.extend(future.result())

    # --- Deduplicate comments ---
    seen = set()
    unique_comments = []
    for c in all_comments:
        if c["text"] not in seen:
            seen.add(c["text"])
            unique_comments.append(c)

    print(f"\n💬 Total unique filtered comments: {len(unique_comments)}")

    # --- Parallel sentiment scoring ---
    if unique_comments:
        with ThreadPoolExecutor(max_workers=10) as executor:
            results = list(executor.map(score_comment, unique_comments))
        sentiments, weights = zip(*results)
        weighted_avg = np.average(sentiments, weights=weights)
        sentiment_index = round(50 + 50 * weighted_avg, 2)
    else:
        sentiment_index = 50.0

    print(f"\n📈 Overall Sentiment Index for {ticker}: {sentiment_index}/100")

    # --- Save results to CSV ---
    output_file = f"reddit_sentiment_{ticker}_v3.csv"
    with open(output_file, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Index", "SentimentScore", "Upvotes", "Subreddit", "DateUTC", "Comment"])
        for i, c in enumerate(unique_comments, 1):
            vader = sia.polarity_scores(c["text"])["compound"]
            adj = adjust_sentiment(c["text"], vader)
            date = datetime.utcfromtimestamp(c["created_utc"]).strftime("%Y-%m-%d %H:%M:%S")
            writer.writerow([i, f"{adj:.2f}", c["upvotes"], c["subreddit"], date, c["text"]])

    print(f"\n✅ Saved {len(unique_comments)} filtered comments to '{output_file}'")
