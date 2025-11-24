import requests
import json

# --- CONFIG ---
url = "https://api-2-0.spot.im/v1.0.0/conversation/realtime/read"

headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    "Content-Type": "application/json",
    "x-access-token": "<PASTE_X_ACCESS_TOKEN_HERE>",
    "x-spot-id": "<PASTE_X_SPOT_ID_HERE>",
    "x-post-id": "<PASTE_X_POST_ID_HERE>"
}

payload = {
    "postId": "<PASTE_X_POST_ID_HERE>",
    "spotId": "<PASTE_X_SPOT_ID_HERE>",
    "limit": 50  # number of comments to fetch at a time
}

response = requests.post(url, headers=headers, json=payload)
data = response.json()

# --- Extract comments ---
comments = []
for comment in data.get('comments', []):
    comments.append(comment.get('text', ''))

print(f"Extracted {len(comments)} comments:\n")
for i, c in enumerate(comments, 1):
    print(f"{i}. {c}\n")
