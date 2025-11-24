import csv
import requests

COMPANY_CSV = "company_ids.csv"

def read_company_ids(csv_file):
    """Return a list of (company_name, company_id)"""
    companies = []
    with open(csv_file, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row["company"]
            cid = row["id"]
            if cid != "NOT FOUND":
                companies.append((name, cid))
    return companies

def fetch_latest_post(company_id):
    """Fetch the latest post for a company"""
    url = f"https://api.forum.placera.se/v1/posts?company={company_id}&ordering=-created&page_size=1"
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    results = data.get("results", [])
    if results:
        return results[0]  # return the latest post
    return None

def fetch_first_comment(post_id):
    """Fetch the first comment for a given post"""
    url = f"https://api.forum.placera.se/v1/posts/{post_id}/comments?page_size=1&ordering=created"
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    comments = data.get("results", [])
    if comments:
        return comments[0].get("content", "").strip()
    return None

def main():
    companies = read_company_ids(COMPANY_CSV)

    for name, cid in companies:
        print(f"\n=== {name} ({cid}) ===")
        try:
            post = fetch_latest_post(cid)
        except Exception as e:
            print(f"Error fetching post: {e}")
            continue

        if not post:
            print("No posts found.")
            continue

        main_content = post.get("content", "").strip()
        print(f"Post: {main_content}")

        if post.get("reply_count", 0) > 0:
            try:
                comment = fetch_first_comment(post["id"])
            except Exception as e:
                print(f"Error fetching comment: {e}")
                comment = None
            if comment:
                print(f"Comment: {comment}")
            else:
                print("Comment: NOT FOUND")
        else:
            print("Comment: None")

if __name__ == "__main__":
    main()
