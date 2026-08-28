import type { PlaceraPayload } from "./types";

export type ForumSummary = {
  short: string;
  full: string;
  themes: string[];
  entityCount: number;
};

// Forum filler that carries no signal about the company.
const STOPWORDS = new Set([
  // Swedish
  "och", "att", "det", "som", "för", "med", "den", "har", "inte", "man", "kan", "är", "till", "på", "av", "en", "ett",
  "jag", "vi", "du", "de", "dem", "här", "där", "från", "eller", "men", "om", "ska", "skall", "var", "vad", "när",
  "bara", "mer", "mycket", "sig", "sin", "sina", "hans", "hennes", "detta", "denna", "dessa", "vara", "blir", "blev",
  "nu", "så", "alla", "andra", "efter", "över", "under", "vid", "utan", "genom", "igen", "ännu", "redan", "kanske",
  "aktien", "aktier", "bolaget", "bolag", "tror", "tycker", "verkar", "borde", "skulle", "kommer", "gick", "går",
  // English
  "the", "and", "that", "this", "with", "for", "are", "was", "were", "has", "have", "had", "not", "you", "your",
  "they", "them", "their", "from", "but", "about", "into", "than", "then", "there", "here", "what", "when", "will",
  "would", "could", "should", "can", "just", "like", "more", "some", "any", "all", "one", "two", "its", "out", "get",
  "got", "very", "also", "much", "still", "even", "now", "stock", "share", "shares", "company"
]);

const WORD_REGEX = /[a-zA-ZÀ-ɏ]+/g;

function topThemes(texts: string[], limit: number): string[] {
  const counts = new Map<string, number>();

  for (const text of texts) {
    // Count each word once per comment so a single ranting post cannot own a theme.
    const seen = new Set<string>();
    for (const match of text.toLowerCase().match(WORD_REGEX) ?? []) {
      if (match.length < 4 || STOPWORDS.has(match) || seen.has(match)) {
        continue;
      }
      seen.add(match);
      counts.set(match, (counts.get(match) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

function excerpt(text: string, maxLength: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) {
    return clean;
  }
  return `${clean.slice(0, maxLength).replace(/\s+\S*$/, "")}...`;
}

function moodPhrase(score: number, isSv: boolean): string {
  if (score >= 45) return isSv ? "tydligt positivt" : "clearly positive";
  if (score >= 15) return isSv ? "försiktigt positivt" : "cautiously positive";
  if (score <= -45) return isSv ? "tydligt negativt" : "clearly negative";
  if (score <= -15) return isSv ? "försiktigt negativt" : "cautiously negative";
  return isSv ? "i huvudsak neutralt" : "largely neutral";
}

function joinList(items: string[], isSv: boolean): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(", ")} ${isSv ? "och" : "and"} ${last}`;
}

/**
 * Deterministic, source-grounded recap of the forum window. Same payload in,
 * same text out — no sampling, no model call. Swap the body for an LLM later
 * without touching the call sites.
 */
export function buildForumSummary(data: PlaceraPayload, isSv: boolean, companyLabel: string): ForumSummary {
  const { entities, sentiment } = data;

  if (entities.length === 0) {
    const empty = isSv
      ? `Inga inlägg om ${companyLabel} hittades i forumet under de senaste ${data.lookback_days} dagarna.`
      : `No forum activity for ${companyLabel} was found in the last ${data.lookback_days} days.`;
    return { short: empty, full: empty, themes: [], entityCount: 0 };
  }

  const { positive, neutral, negative } = sentiment.distribution;
  const themes = topThemes(
    entities.map((entity) => entity.content),
    5
  );

  const ranked = [...entities].sort((a, b) => b.sentiment_score - a.sentiment_score);
  const mostPositive = ranked[0];
  const mostNegative = ranked[ranked.length - 1];

  const replies = entities.filter((entity) => entity.entity_type === "reply").length;
  const dominant = positive.count >= negative.count ? positive : negative;
  const dominantIsPositive = positive.count >= negative.count;

  const sentences: string[] = [];

  sentences.push(
    isSv
      ? `Bland ${entities.length} inlägg och svar om ${companyLabel} är tonen ${moodPhrase(sentiment.score, true)}.`
      : `Across ${entities.length} posts and replies about ${companyLabel}, the tone is ${moodPhrase(sentiment.score, false)}.`
  );

  sentences.push(
    isSv
      ? `${positive.percent}% av kommentarerna är positiva, ${neutral.percent}% neutrala och ${negative.percent}% negativa, med ${dominantIsPositive ? "positiva" : "negativa"} röster i ${dominant.count} av ${entities.length} inlägg.`
      : `${positive.percent}% of comments read positive, ${neutral.percent}% neutral and ${negative.percent}% negative, with the ${dominantIsPositive ? "positive" : "negative"} side accounting for ${dominant.count} of ${entities.length} entries.`
  );

  if (themes.length > 0) {
    sentences.push(
      isSv
        ? `Återkommande ämnen: ${joinList(themes, true)}.`
        : `Recurring topics: ${joinList(themes, false)}.`
    );
  }

  const short = sentences.join(" ");

  const extra: string[] = [...sentences];

  extra.push(
    isSv
      ? `Diskussionen består av ${data.posts.length} trådar och ${replies} svar, och säkerheten i mätningen är ${sentiment.confidence.level} (${sentiment.confidence.score}/100) eftersom ${Math.round((sentiment.distribution.neutral.percent / 100) * entities.length)} kommentarer saknar tydliga signalord.`
      : `The discussion spans ${data.posts.length} threads and ${replies} replies, and measurement confidence is ${sentiment.confidence.level} (${sentiment.confidence.score}/100) because ${Math.round((sentiment.distribution.neutral.percent / 100) * entities.length)} comments carry no clear signal words.`
  );

  if (mostPositive && mostPositive.sentiment_score > 0) {
    extra.push(
      isSv
        ? `Mest positiva rösten: "${excerpt(mostPositive.content, 180)}"`
        : `Most positive voice: "${excerpt(mostPositive.content, 180)}"`
    );
  }

  if (mostNegative && mostNegative.sentiment_score < 0) {
    extra.push(
      isSv
        ? `Mest negativa rösten (${mostNegative.sentiment_score}): "${excerpt(mostNegative.content, 180)}"`
        : `Most negative voice (${mostNegative.sentiment_score}): "${excerpt(mostNegative.content, 180)}"`
    );
  }

  return {
    short,
    full: extra.join(" "),
    themes,
    entityCount: entities.length
  };
}
