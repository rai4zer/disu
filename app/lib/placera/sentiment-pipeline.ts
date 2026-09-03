/**
 * The Placera sentiment pipeline.
 *
 * Lifted out of `app/api/placera/route.ts` unchanged. It was extracted for a
 * board of pre-computed readings that has since been reverted — running the
 * pipeline for a watchlist meant dozens of forum calls per company, well over
 * Placera's rate limit — so today there is again exactly one caller.
 *
 * Kept extracted anyway, because the split is worth having on its own terms:
 * the route is now only the part that is a route's job (query parameters,
 * status codes, cache headers), and the work itself — resolve a company, read
 * its posts and replies inside the lookback window, score each entity,
 * summarise — is a plain function that can be read and tested without a
 * request. Nothing about the behaviour changed in either direction.
 */

import type {
  PlaceraComment,
  PlaceraEntity,
  PlaceraPayload,
  PlaceraPost,
  SentimentSummary
} from "@/app/placera/types";


const PLACERA_BASE_URL = "https://api.forum.placera.se/v1";
const PLACERA_EDGE_BASE_URL = "https://api.forum.placera.se";
const PLACERA_SEARCH_URL = "https://api.forum.placera.se/search";
const LOOKBACK_DAYS = 90;
const POSTS_PAGE_SIZE = 50;
const COMMENTS_PAGE_SIZE = 50;
const MAX_POST_PAGES = 12;
const MAX_COMMENT_PAGES = 8;
const TIMEOUT_MS = 10000;

type PlaceraListResponse<T> = {
  results?: T[];
  next?: string | null;
};

type RawPost = {
  id?: string;
  content?: string;
  reply_count?: number;
  created?: string;
  client_url?: string;
};

type RawComment = {
  id?: string;
  content?: string;
  created?: string;
  author?: {
    name?: string;
  };
};

type RawSearchResult = {
  company?: {
    id?: string;
  };
};

function parseDate(value: string | null): number {
  if (!value) {
    return 0;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    });
  } finally {
    clearTimeout(timer);
  }
}

async function parseErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 200);
  } catch {
    return "Unable to read upstream error body";
  }
}

async function resolveCompanyId(companyQuery: string): Promise<string | null> {
  const searchUrl = `${PLACERA_SEARCH_URL}?q=${encodeURIComponent(
    companyQuery
  )}&page_size=50&kind=company&kind=profile&kind=group`;

  const searchResponse = await fetchWithTimeout(searchUrl);
  if (!searchResponse.ok) {
    throw new Error(`Placera search failed with status ${searchResponse.status}`);
  }

  const searchJson = (await searchResponse.json()) as PlaceraListResponse<RawSearchResult>;
  const rawResults = Array.isArray(searchJson.results) ? searchJson.results : [];

  for (const result of rawResults) {
    const id = result.company?.id;
    if (id && id.trim().length > 0) {
      return id.trim();
    }
  }

  return null;
}

function mapRawComments(rawComments: RawComment[]): PlaceraComment[] {
  return rawComments.map((comment) => ({
    id: String(comment.id ?? ""),
    content: comment.content ?? "",
    created: comment.created ?? null,
    author_name: comment.author?.name ?? null
  }));
}

function isInWindow(created: string | null, cutoffTs: number): boolean {
  return parseDate(created) >= cutoffTs;
}

async function fetchCommentsFromEndpoint(
  urlBuilder: (page: number) => string,
  cutoffTs: number
): Promise<PlaceraComment[] | null> {
  const collected: PlaceraComment[] = [];
  const seen = new Set<string>();
  let previousNext: string | null | undefined = undefined;

  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const url = urlBuilder(page);

    try {
      const response = await fetchWithTimeout(url);
      if (response.status === 404) {
        return [];
      }
      if (!response.ok) {
        return null;
      }

      const json = (await response.json()) as PlaceraListResponse<RawComment>;
      const rawComments = Array.isArray(json.results) ? json.results : [];
      if (rawComments.length === 0) {
        break;
      }

      const mapped = mapRawComments(rawComments);
      let addedThisPage = 0;
      for (const comment of mapped) {
        if (!isInWindow(comment.created, cutoffTs)) {
          continue;
        }
        const dedupeId = comment.id || `${comment.created ?? "na"}-${comment.author_name ?? "anon"}-${comment.content}`;
        if (seen.has(dedupeId)) {
          continue;
        }
        seen.add(dedupeId);
        collected.push(comment);
        addedThisPage += 1;
      }

      const lastCreated = rawComments[rawComments.length - 1]?.created ?? null;
      if (parseDate(lastCreated) < cutoffTs) {
        break;
      }
      if (addedThisPage === 0) {
        // Defensive break: some endpoints can repeat the same page despite incrementing page query.
        break;
      }
      if (json.next === previousNext) {
        break;
      }
      previousNext = json.next;

      if (!json.next) {
        break;
      }
    } catch {
      return null;
    }
  }

  return collected;
}

async function fetchRepliesOrComments(postId: string, cutoffTs: number): Promise<PlaceraComment[]> {
  const comments = await fetchCommentsFromEndpoint(
    (page) =>
      `${PLACERA_BASE_URL}/posts/${postId}/comments?ordering=-created&page_size=${COMMENTS_PAGE_SIZE}&page=${page}`,
    cutoffTs
  );
  if (Array.isArray(comments)) {
    return comments;
  }

  const replies = await fetchCommentsFromEndpoint(
    (page) =>
      `${PLACERA_EDGE_BASE_URL}/posts/${postId}/replies?ordering=-created&page_size=${COMMENTS_PAGE_SIZE}&page=${page}`,
    cutoffTs
  );
  if (Array.isArray(replies)) {
    return replies;
  }

  console.error(`Failed to fetch replies/comments for post ${postId}`);
  return [];
}

async function fetchRecentPosts(companyId: string, cutoffTs: number): Promise<RawPost[]> {
  const posts: RawPost[] = [];

  for (let page = 1; page <= MAX_POST_PAGES; page += 1) {
    const postsUrl = `${PLACERA_BASE_URL}/posts?company=${encodeURIComponent(
      companyId
    )}&ordering=-created&page_size=${POSTS_PAGE_SIZE}&page=${page}`;
    const response = await fetchWithTimeout(postsUrl);

    if (!response.ok) {
      const bodyPreview = await parseErrorBody(response);
      throw new Error(`Failed to fetch posts from Placera (${response.status}): ${bodyPreview}`);
    }

    const json = (await response.json()) as PlaceraListResponse<RawPost>;
    const batch = Array.isArray(json.results) ? json.results : [];
    if (batch.length === 0) {
      break;
    }

    for (const post of batch) {
      if (isInWindow(post.created ?? null, cutoffTs)) {
        posts.push(post);
      }
    }

    const lastCreated = batch[batch.length - 1]?.created ?? null;
    if (parseDate(lastCreated) < cutoffTs) {
      break;
    }
    if (!json.next) {
      break;
    }
  }

  return posts;
}

function buildEntities(posts: PlaceraPost[]): PlaceraEntity[] {
  const entities: PlaceraEntity[] = [];
  const seen = new Set<string>();

  function pushUnique(entity: PlaceraEntity) {
    const signature = [
      entity.entity_type,
      entity.author_name ?? "",
      entity.created ?? "",
      entity.content.trim().replace(/\s+/g, " ").slice(0, 280)
    ].join("|");
    if (seen.has(signature)) {
      return;
    }
    seen.add(signature);
    entities.push(entity);
  }

  for (const post of posts) {
    pushUnique({
      id: post.id,
      entity_type: "post",
      parent_post_id: post.id,
      content: post.content,
      created: post.created,
      author_name: null,
      sentiment_score: 0,
      sentiment_bucket: "neutral"
    });

    for (const comment of post.comments) {
      pushUnique({
        id: comment.id,
        entity_type: "reply",
        parent_post_id: post.id,
        content: comment.content,
        created: comment.created,
        author_name: comment.author_name,
        sentiment_score: 0,
        sentiment_bucket: "neutral"
      });
    }
  }

  return entities.sort((a, b) => parseDate(b.created) - parseDate(a.created));
}

const TOKEN_REGEX = /[a-zA-Z\u00c0-\u024f\u00e5\u00e4\u00f6\u00c5\u00c4\u00d6]+/g;

const WORD_SCORES: Record<string, number> = {
  buy: 2.4,
  bullish: 2.5,
  upside: 1.8,
  growth: 1.5,
  beat: 1.6,
  strong: 1.4,
  rebound: 1.5,
  undervalued: 1.8,
  breakout: 1.7,
  long: 1.2,
  profit: 1.4,
  raise: 1.2,
  upgraded: 1.8,
  outperformance: 1.9,
  buyback: 1.7,
  överpresterar: 1.9,
  tillväxt: 1.6,
  stark: 1.3,
  köpläge: 2.2,
  uppgång: 1.6,
  vinst: 1.5,
  rapportlyft: 1.9,
  köprekommendation: 2.4,
  sell: -2.4,
  bearish: -2.5,
  downside: -1.8,
  weak: -1.4,
  miss: -1.6,
  overvalued: -1.8,
  loss: -1.5,
  short: -1.2,
  downgrade: -1.9,
  cut: -1.3,
  warning: -1.6,
  fraud: -2.5,
  dilution: -2.0,
  bankruptcy: -3.0,
  underperform: -2.0,
  fall: -1.5,
  nedgång: -1.6,
  svag: -1.4,
  säljläge: -2.2,
  förlust: -1.5,
  vinstvarning: -2.4,
  sänkt: -1.6,
  säljrekommendation: -2.4,
  övervärderad: -1.9
};

const POSITIVE_PHRASES: Array<[RegExp, number]> = [
  [/\bbeat(s|ing)? (expectations|estimates)\b/i, 2.4],
  [/\braise(d|s)? guidance\b/i, 2.2],
  [/\bstrong (quarter|report|results)\b/i, 1.8],
  [/\bdouble bottom\b/i, 1.5],
  [/\bbreakout\b/i, 1.7],
  [/\bhöjd prognos\b/i, 2.3],
  [/\bstark rapport\b/i, 1.9]
];

const NEGATIVE_PHRASES: Array<[RegExp, number]> = [
  [/\bmiss(ed|es)? (expectations|estimates)\b/i, -2.4],
  [/\bcut(s|ting)? guidance\b/i, -2.2],
  [/\bprofit warning\b/i, -2.6],
  [/\bearnings warning\b/i, -2.6],
  [/\bdead cat bounce\b/i, -1.8],
  [/\bdebt spiral\b/i, -2.4],
  [/\bvinstvarning\b/i, -2.6],
  [/\bsvag rapport\b/i, -1.9]
];

const NEGATIONS = new Set([
  "not",
  "no",
  "never",
  "without",
  "hardly",
  "barely",
  "inte",
  "ej",
  "icke",
  "knappast",
  "aldrig",
  "utan"
]);

const INTENSIFIERS = new Set([
  "very",
  "extremely",
  "super",
  "highly",
  "really",
  "mycket",
  "väldigt",
  "starkt",
  "klart",
  "jätte"
]);

const DAMPENERS = new Set([
  "slightly",
  "somewhat",
  "barely",
  "modestly",
  "lite",
  "något",
  "delvis"
]);

const CONTRAST_MARKERS = new Set(["but", "however", "though", "men", "dock"]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_REGEX) ?? []).filter((token) => token.length > 1);
}

function scorePhrases(text: string): number {
  let score = 0;

  for (const [pattern, value] of POSITIVE_PHRASES) {
    if (pattern.test(text)) {
      score += value;
    }
  }

  for (const [pattern, value] of NEGATIVE_PHRASES) {
    if (pattern.test(text)) {
      score += value;
    }
  }

  return score;
}

function scoreTokens(tokens: string[]): number {
  let score = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const base = WORD_SCORES[token];
    if (!base) {
      continue;
    }

    const recent = tokens.slice(Math.max(0, i - 3), i);
    const hasNegation = recent.some((t) => NEGATIONS.has(t));
    const hasIntensifier = recent.some((t) => INTENSIFIERS.has(t));
    const hasDampener = recent.some((t) => DAMPENERS.has(t));

    let adjusted = base;
    if (hasNegation) {
      adjusted = adjusted * -0.85;
    }
    if (hasIntensifier) {
      adjusted = adjusted * 1.25;
    }
    if (hasDampener) {
      adjusted = adjusted * 0.75;
    }

    score += adjusted;
  }

  return score;
}

function scoreEntity(text: string): number {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return 0;
  }

  const hasContrast = tokens.some((token) => CONTRAST_MARKERS.has(token));

  let score = scorePhrases(text) + scoreTokens(tokens);
  if (hasContrast) {
    const parts = text.split(/\b(?:but|however|though|men|dock)\b/i);
    if (parts.length >= 2) {
      const tail = parts[parts.length - 1];
      const tailTokens = tokenize(tail);
      const tailScore = scorePhrases(tail) + scoreTokens(tailTokens);
      // Common forum structure: "good x, but bad y". Emphasize final clause.
      score = score * 0.6 + tailScore * 0.9;
    }
  }

  // Smooth out very long comments so they do not dominate aggregate sentiment.
  return score / (Math.abs(score) + 4);
}

function toBand(score: number): SentimentSummary["band"] {
  if (score >= 55) {
    return "very_bullish";
  }
  if (score >= 20) {
    return "bullish";
  }
  if (score <= -55) {
    return "very_bearish";
  }
  if (score <= -20) {
    return "bearish";
  }
  return "neutral";
}

function toBadge(score: number): SentimentSummary["badge"] {
  if (score <= -75) {
    return "armageddon";
  }
  if (score <= -45) {
    return "strong_bear";
  }
  if (score <= -15) {
    return "bear";
  }
  if (score < 15) {
    return "neutral";
  }
  if (score < 45) {
    return "bull";
  }
  if (score < 75) {
    return "strong_bull";
  }
  return "exuberance";
}

function toConfidenceLevel(value: number): "low" | "medium" | "high" {
  if (value >= 70) {
    return "high";
  }
  if (value >= 40) {
    return "medium";
  }
  return "low";
}

function computeSentiment(entities: PlaceraEntity[]): SentimentSummary {
  if (entities.length === 0) {
    return {
      score: 0,
      label: "neutral",
      band: "neutral",
      confidence: { score: 0, level: "low" },
      distribution: {
        positive: { count: 0, percent: 0 },
        neutral: { count: 0, percent: 0 },
        negative: { count: 0, percent: 0 }
      },
      badge: "neutral",
      total_entities: 0
    };
  }

  let aggregate = 0;
  let nonZeroEntities = 0;
  let positiveCount = 0;
  let neutralCount = 0;
  let negativeCount = 0;

  for (const entity of entities) {
    const entityScore = scoreEntity(entity.content);
    entity.sentiment_score = Math.round(clamp(entityScore * 100, -100, 100));
    if (Math.abs(entityScore) > 0.02) {
      nonZeroEntities += 1;
    }
    if (entityScore > 0.12) {
      positiveCount += 1;
      entity.sentiment_bucket = "positive";
    } else if (entityScore < -0.12) {
      negativeCount += 1;
      entity.sentiment_bucket = "negative";
    } else {
      neutralCount += 1;
      entity.sentiment_bucket = "neutral";
    }
    aggregate += entityScore;
  }

  const coverage = nonZeroEntities / entities.length;
  const average = aggregate / entities.length;
  const weighted = average * (0.6 + 0.4 * coverage);
  const score = Math.round(clamp(weighted * 100, -100, 100));
  const band = toBand(score);
  const badge = toBadge(score);

  let label: SentimentSummary["label"] = "neutral";
  if (score > 15) {
    label = "positive";
  } else if (score < -15) {
    label = "negative";
  }

  const balance = Math.abs(positiveCount - negativeCount) / Math.max(1, entities.length);
  const sampleStrength = clamp(entities.length / 40, 0, 1);
  const directionalStrength = clamp(Math.abs(score) / 50, 0, 1);
  const confidenceScore = Math.round(
    clamp(
      100 * (0.45 * sampleStrength + 0.3 * coverage + 0.25 * Math.max(balance, directionalStrength)),
      0,
      100
    )
  );

  const percent = (count: number) => Math.round((count / entities.length) * 100);

  return {
    score,
    label,
    band,
    confidence: {
      score: confidenceScore,
      level: toConfidenceLevel(confidenceScore)
    },
    distribution: {
      positive: { count: positiveCount, percent: percent(positiveCount) },
      neutral: { count: neutralCount, percent: percent(neutralCount) },
      negative: { count: negativeCount, percent: percent(negativeCount) }
    },
    badge,
    total_entities: entities.length
  };
}


/**
 * Resolve, fetch, score. The whole pipeline behind one call.
 *
 * Throws rather than returning an error shape: the two callers want different
 * things from a failure (the route maps it to a status code, the board drops
 * the card), and an exception lets each decide.
 */
export async function loadPlaceraSentiment(input: {
  companyId?: string | null;
  companyQuery?: string | null;
}): Promise<PlaceraPayload> {
  const companyId =
    input.companyId || (input.companyQuery ? await resolveCompanyId(input.companyQuery) : null);

  if (!companyId) {
    throw new PlaceraCompanyNotFoundError(input.companyQuery ?? "");
  }

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  const cutoffTs = cutoff.getTime();

  const rawPosts = await fetchRecentPosts(companyId, cutoffTs);

  const posts: PlaceraPost[] = await Promise.all(
    rawPosts.map(async (post) => {
      const id = String(post.id ?? "");

      return {
        id,
        content: post.content ?? "",
        reply_count: typeof post.reply_count === "number" ? post.reply_count : 0,
        created: post.created ?? null,
        client_url: post.client_url ?? null,
        comments: id ? await fetchRepliesOrComments(id, cutoffTs) : []
      };
    })
  );

  const entities = buildEntities(posts);

  return {
    companyId,
    companyQuery: input.companyQuery ?? undefined,
    lookback_days: LOOKBACK_DAYS,
    window_start: cutoff.toISOString(),
    window_end: now.toISOString(),
    posts,
    entities,
    sentiment: computeSentiment(entities)
  };
}

/** No Placera forum exists for this query — a 404, not a 500. */
export class PlaceraCompanyNotFoundError extends Error {
  constructor(public readonly companyQuery: string) {
    super(`No Placera company id found for query: ${companyQuery}`);
    this.name = "PlaceraCompanyNotFoundError";
  }
}
