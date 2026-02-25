import csv
from urllib.parse import quote_plus

import requests

COMPANIES = [
    "alibaba",
    "apple",
    "bahnhof",
    "avanza",
    "berkshire",
    "ferronordic",
    "axfood",
    "spiltan",
    "investor",
    "meta",
    "microsoft",
    "stoneco",
    "teqnion",
    "visa",
]


def fetch_ids(query: str):
    url = (
        "https://api.forum.placera.se/search"
        f"?q={quote_plus(query)}"
        "&page_size=50"
        "&kind=company&kind=profile&kind=group"
    )

    response = requests.get(url, timeout=15)
    response.raise_for_status()
    data = response.json()

    ids = []
    for item in data.get("results", []):
        company = item.get("company")
        if company and "id" in company:
            ids.append(company["id"])

    return ids


def main():
    output_rows = []

    for name in COMPANIES:
        ids = fetch_ids(name)
        if ids:
            for cid in ids:
                output_rows.append([name, cid])
            print(f"{name}: {', '.join(ids)}")
        else:
            output_rows.append([name, "NOT FOUND"])
            print(f"{name}: NOT FOUND")

    with open("company_ids.csv", "w", newline="", encoding="utf-8") as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow(["company", "id"])
        writer.writerows(output_rows)

    print("\nSaved to company_ids.csv")


if __name__ == "__main__":
    main()
