import csv
import requests

COMPANY_CSV = "company_ids.csv"
POSTS_PER_COMPANY = 3       # max posts to fetch per company
COMMENTS_PAGE_SIZE = 50     # max comments to fetch per post (per API call)

def read_company_ids(csv_file):
    companies = []
    with open(csv_file, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row["company"]
            cid = row["id"]
            if cid != "NOT FOUND":
                companies.append((name, cid))
    return companies

def fetch_posts(company_id, page_size=POSTS_PER_COMPANY):
    url = f"https://api.forum.placera.se/v1/posts?company={company_id}&ordering=-created&page_size={page_size}"
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        return resp.json().get("results", [])
    except requests.exceptions.RequestException:
        return []

def fetch_comments(post_id, page_size=COMMENTS_PAGE_SIZE):
    """Fetch comments for a post. Return empty list if endpoint doesn't exist or 404."""
    url = f"https://api.forum.placera.se/v1/posts/{post_id}/comments?page_size={page_size}&ordering=created"
    try:
        resp = requests.get(url, timeout=15)
        if resp.status_code == 404:
            return []  # no comments for this post
        resp.raise_for_status()
        return resp.json().get("results", [])
    except requests.exceptions.RequestException:
        return []

def main():
    companies = read_company_ids(COMPANY_CSV)

    for name, cid in companies:
        print(f"\n=== {name} ({cid}) ===")
        posts = fetch_posts(cid)
        if not posts:
            print("No posts found.")
            continue

        for pidx, post in enumerate(posts[:POSTS_PER_COMPANY], start=1):
            post_content = post.get("content", "").strip()
            print(f"\nPost {pidx}: {post_content}")

            reply_count = post.get("reply_count", 0)
            if reply_count > 0:
                comments = fetch_comments(post["id"])
                if comments:
                    for cidx, comment in enumerate(comments, start=1):
                        comment_content = comment.get("content", "").strip()
                        author = comment.get("author", {}).get("name", "Unknown")
                        print(f"   Comment {cidx} by {author}: {comment_content}")
                else:
                    print("   Comments: None")
            else:
                print("   Comments: None")

if __name__ == "__main__":
    main()
