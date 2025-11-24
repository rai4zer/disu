import os
import time
import requests
from dotenv import load_dotenv

# --- Load environment variables ---
load_dotenv()
BEARER_TOKEN = os.getenv("X_BEARER_TOKEN")

# --- Fetch recent tweets ---
def fetch_recent_tweets(ticker):
    headers = {"Authorization": f"Bearer {BEARER_TOKEN}"}
    query = f"${ticker} OR {ticker} lang:en -is:retweet"
    url = "https://api.twitter.com/2/tweets/search/recent"  # correct base for X v2
    params = {
        "query": query,
        "max_results": "10",  # capped for free tier
        "tweet.fields": "created_at,public_metrics,lang",
    }

    response = requests.get(url, headers=headers, params=params)
    
    # Handle unauthorized
    if response.status_code == 401:
        raise Exception("❌ Unauthorized. Check your Bearer Token.")
    # Handle rate limit
    elif response.status_code == 429:
        print("⏳ Rate limit hit. Sleeping for 15 minutes...")
        time.sleep(15 * 60)
        return fetch_recent_tweets(ticker)
    # Handle other errors
    elif response.status_code != 200:
        raise Exception(f"❌ Request failed: {response.status_code} - {response.text}")
    
    data = response.json().get("data", [])
    tweets = [t["text"] for t in data]
    return tweets

# --- Run test ---
if __name__ == "__main__":
    ticker = "AAPL"
    tweets = fetch_recent_tweets(ticker)
    print(f"✅ Retrieved {len(tweets)} tweets for ${ticker}:")
    for t in tweets:
        print("-", t.replace("\n", " "))
