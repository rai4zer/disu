import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { listPortfolioPositions } from "@/app/lib/portfolio/portfolio-positions";

type NewsItem = {
  title: string;
  link: string;
  source: "FT" | "WSJ" | "NYT" | "Google";
  publishedAt: string;
};

const LOOKBACK_DAYS = 14;
const TIMEOUT_MS = 7000;

const BROAD_FEEDS: Array<{ source: "FT" | "WSJ" | "NYT"; url: string }> = [
  { source: "FT", url: "https://www.ft.com/rss/companies/technology" },
  { source: "FT", url: "https://www.ft.com/rss/markets" },
  { source: "WSJ", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml" },
  { source: "WSJ", url: "https://feeds.a.dj.com/rss/RSSWSJD.xml" },
  { source: "NYT", url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml" },
  { source: "NYT", url: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml" }
];

const TARGET_SOURCES: Array<{ source: "FT" | "WSJ" | "NYT"; site: string }> = [
  { source: "FT", site: "site:ft.com" },
  { source: "WSJ", site: "site:wsj.com" },
  { source: "NYT", site: "site:nytimes.com" }
];

function sanitize(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function parseRssItems(xml: string): Array<{ title: string; link: string; pubDate: string }> {
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  const out: Array<{ title: string; link: string; pubDate: string }> = [];
  for (const item of items) {
    const title = item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const link = item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "";
    const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "";
    const cleanTitle = sanitize(title);
    const cleanLink = sanitize(link);
    if (!cleanTitle || !cleanLink) continue;
    out.push({ title: cleanTitle, link: cleanLink, pubDate: sanitize(pubDate) });
  }
  return out;
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.2" },
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseTs(value: string): number {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function cutoffTs(): number {
  return Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
}

export async function GET(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const terms = (await listPortfolioPositions(session.userId))
    .slice(0, 6)
    .flatMap((row) => [row.ticker, row.name])
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 6);

  const targetUrls = terms.flatMap((term) =>
    TARGET_SOURCES.map((src) => {
      const query = encodeURIComponent(`${term} ${src.site} stock`);
      return {
        source: src.source as "FT" | "WSJ" | "NYT",
        url: `https://news.google.com/rss/search?q=${query}&hl=en&gl=US&ceid=US:en`
      };
    })
  );

  const allFeeds: Array<{ source: "FT" | "WSJ" | "NYT" | "Google"; url: string }> = [
    ...BROAD_FEEDS,
    ...targetUrls.map((row) => ({ source: row.source, url: row.url }))
  ];

  const dedupe = new Set<string>();
  const news: NewsItem[] = [];
  const cutoff = cutoffTs();

  await Promise.all(
    allFeeds.map(async (feed) => {
      try {
        const xml = await fetchText(feed.url);
        const rows = parseRssItems(xml).slice(0, 8);
        for (const row of rows) {
          const ts = parseTs(row.pubDate);
          if (ts && ts < cutoff) continue;
          if (dedupe.has(row.link)) continue;
          dedupe.add(row.link);
          news.push({
            title: row.title,
            link: row.link,
            source: feed.source,
            publishedAt: ts ? new Date(ts).toISOString() : new Date().toISOString()
          });
        }
      } catch {
        // Best-effort feed aggregation.
      }
    })
  );

  const priority: Record<NewsItem["source"], number> = {
    FT: 1,
    WSJ: 2,
    NYT: 3,
    Google: 4
  };

  news.sort((a, b) => {
    const diff = parseTs(b.publishedAt) - parseTs(a.publishedAt);
    if (Math.abs(diff) < 60 * 60 * 1000) {
      return priority[a.source] - priority[b.source];
    }
    return diff;
  });

  return NextResponse.json({ ok: true, items: news.slice(0, 60) });
}
