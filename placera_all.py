import csv
import requests

COMPANY_CSV = "company_ids.csv"
COMMENTS_PER_COMPANY = 10  # max comments to fetch per company
POSTS_PAGE_SIZE = 50       # number of posts to fetch per company
COMMENTS_PAGE_SIZE = 50    # number of comments to fetch per post

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

def fetch_posts(company_id, page_size=POSTS_PAGE_SIZE):
    url = f"https://api.forum.placera.se/v1/posts?company={company_id}&ordering=-created&page_size={page_size}"
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        return resp.json().get("results", [])
    except requests.exceptions.RequestException:
        return []  # safe fallback if posts can't be fetched

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
        return []  # catch all request-related errors

def main():
    companies = read_company_ids(COMPANY_CSV)

    for name, cid in companies:
        print(f"\n=== {name} ({cid}) ===")
        comments_collected = 0
        posts = fetch_posts(cid)
        if not posts:
            print("No posts found.")
            continue

        for pidx, post in enumerate(posts, start=1):
            if comments_collected >= COMMENTS_PER_COMPANY:
                break

            post_content = post.get("content", "").strip()
            print(f"\nPost {pidx}: {post_content}")

            reply_count = post.get("reply_count", 0)
            if reply_count > 0:
                comments = fetch_comments(post["id"])
                for comment in comments:
                    if comments_collected >= COMMENTS_PER_COMPANY:
                        break
                    comment_content = comment.get("content", "").strip()
                    author = comment.get("author", {}).get("name", "Unknown")
                    print(f"   Comment {comments_collected + 1} by {author}: {comment_content}")
                    comments_collected += 1

            if reply_count == 0 or comments_collected == 0:
                print("   Comments: None")

        if comments_collected == 0:
            print("No comments found for this company.")

if __name__ == "__main__":
    main()
