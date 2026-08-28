#!/usr/bin/env python3
"""Does the Marketstack plan on this key return OMXS30?

Usage:
    python3 scripts/marketstack-omxs30-test.py        # reads .env
    MARKETSTACK_API_KEY=xxxx python3 scripts/marketstack-omxs30-test.py

Transport is curl, not urllib: python.org builds on macOS ship without a usable
root-certificate store and fail every HTTPS call with CERTIFICATE_VERIFY_FAILED,
while curl uses the system keychain. The key is never printed.

Answers, in order:
  1. Is OMXS30 in /indexlist at all?
  2. Does /indexinfo resolve it under any common spelling?
  3. Is the Stockholm exchange (XSTO) covered?
  4. Does a Nordic equity resolve (needed independently of indices)?
  5. How stale is the index datapoint?
"""
import json, os, re, subprocess, sys, urllib.parse

BASE = "https://api.marketstack.com/v2"
NAMES = ("MARKETSTACK_API_KEY", "MARKETSTACK_KEY", "MARKETSTACK_ACCESS_KEY")


def load_key():
    for n in NAMES:
        v = os.environ.get(n, "").strip()
        if v:
            return v, n
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = os.path.join(here, ".env")
    if os.path.exists(env):
        with open(env, encoding="utf-8", errors="ignore") as f:
            for line in f:
                m = re.match(r"\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$", line)
                if m and m.group(1) in NAMES:
                    return m.group(2).strip().strip("'\""), "%s (.env)" % m.group(1)
    return "", ""


KEY, SRC = load_key()
if not KEY:
    sys.exit("No key found. Set one of %s, or put it in .env" % ", ".join(NAMES))
print("using key from: %s (length %d, not shown)" % (SRC, len(KEY)))


def get(path, **params):
    params["access_key"] = KEY
    url = "%s/%s?%s" % (BASE, path, urllib.parse.urlencode(params))
    try:
        out = subprocess.run(
            ["curl", "-s", "-m", "40", "-w", "\n__HTTP__%{http_code}", url],
            capture_output=True, text=True, timeout=60,
        ).stdout
    except Exception as e:
        return {"error": {"code": "transport", "message": str(e)}}
    body, _, code = out.rpartition("\n__HTTP__")
    try:
        p = json.loads(body)
    except Exception:
        return {"error": {"code": "http_%s" % code, "message": body[:200]}}
    if isinstance(p, dict):
        p["_http"] = code
    return p


def err(p):
    if isinstance(p, dict) and p.get("error"):
        e = p["error"]
        return "[%s] %s: %s" % (p.get("_http", "?"), e.get("code"), e.get("message", ""))
    return None


def hr(t):
    print("\n=== %s" % t)


hr("1. Is OMXS30 in the supported index list?")
p = get("indexlist", limit=1000)
if err(p):
    print("  ERROR %s" % err(p))
else:
    data = p.get("data") or []
    print("  entries returned: %d (pagination: %s)" % (len(data), p.get("pagination")))
    hits = [d for d in data if any(k in json.dumps(d).lower() for k in ("omx", "stockholm", "sweden"))]
    print("  OMX/Stockholm/Sweden matches: %d" % len(hits))
    for h in hits[:25]:
        print("    %s" % json.dumps(h))
    if data:
        print("  sample entry shape: %s" % json.dumps(data[0])[:300])

hr("2. Direct index lookup, several spellings")
for sym in ("OMXS30", "OMXS30GI", "^OMX", "OMX", "XSTO", "OMXSPI"):
    p = get("indexinfo", index=sym)
    e = err(p)
    print("  %-9s -> %s" % (sym, e if e else json.dumps(p.get("data") or p)[:300]))

hr("3. Is the Stockholm exchange (XSTO) covered?")
p = get("exchanges", limit=1000)
if err(p):
    print("  ERROR %s" % err(p))
else:
    data = p.get("data") or []
    hits = [d for d in data if d.get("mic") == "XSTO" or "stockholm" in str(d.get("name", "")).lower()]
    print("  exchanges returned: %d, Stockholm matches: %d" % (len(data), len(hits)))
    for h in hits:
        print("    %s | %s | %s" % (h.get("mic"), h.get("name"), h.get("country")))

hr("4. Does a Nordic equity resolve? (Volvo B)")
for sym in ("VOLV-B.XSTO", "VOLV_B.XSTO", "VOLV-B.ST"):
    p = get("eod/latest", symbols=sym)
    e = err(p)
    if e:
        print("  %-13s -> %s" % (sym, e))
    else:
        d = p.get("data") or []
        print("  %-13s -> %s" % (sym, json.dumps(d[0])[:300] if d else "empty data"))

hr("5. Freshness of the index datapoint")
p = get("indexinfo", index="OMXS30")
print("  %s" % (err(p) or json.dumps(p.get("data") or p)[:600]))

print("""
How to read this:
  - Section 1 empty  -> OMXS30 is not covered; Marketstack is out for the strip.
  - Section 1 hit, 5 shows a date days old -> covered but end-of-day only, which
    means the market strip would render yesterday's close as if it were current.
  - Section 3 empty but 1 hit -> indices work, Nordic single equities do not.
""")
