"use client";

/**
 * The Sentiment tab: what the Placera forum is saying about this company.
 *
 * This tab only exists for Stockholm listings, because Placera is a Swedish
 * retail board and has no threads for Apple (`instrument-tools.ts`). The rule
 * is the same one the data tabs follow — a tab exists where its data can.
 *
 * The condensed form is the whole design problem here. The `/placera` module
 * showed every post and every reply, which is a reading task. What someone on
 * an instrument page wants is the *shape* of the conversation: how positive,
 * how confident that reading is, and how much was actually said. So the panel
 * leads with a distribution bar and a count, and the posts sit behind an
 * expander for anyone who wants to check the machine's work.
 *
 * Confidence is displayed, never hidden. A score computed from four posts and
 * a score computed from four hundred look identical as a number, and the
 * difference is the only thing that makes the number usable.
 */

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";

type Distribution = { count: number; percent: number };

type SentimentSummary = {
  score: number;
  label: string;
  band: string;
  confidence: { score: number; level: string };
  distribution: { positive: Distribution; neutral: Distribution; negative: Distribution };
  total_entities: number;
};

type PlaceraPost = { id: string; content: string; created: string | null; client_url: string | null };

type Payload = {
  sentiment?: SentimentSummary;
  posts?: PlaceraPost[];
  lookback_days?: number;
  window_start?: string;
  window_end?: string;
  error?: string;
};

/**
 * How many posts the expander actually renders.
 *
 * Named once because the label and the slice must agree: a button reading
 * "show 600 posts" that then renders 20 is a small lie, and this panel's whole
 * job is to be the trustworthy summary of a noisy source.
 */
const POSTS_SHOWN = 20;

const LABELS: Record<string, { en: string; sv: string }> = {
  positive: { en: "Positive", sv: "Positiv" },
  bullish: { en: "Positive", sv: "Positiv" },
  neutral: { en: "Neutral", sv: "Neutral" },
  negative: { en: "Negative", sv: "Negativ" },
  bearish: { en: "Negative", sv: "Negativ" },
  low: { en: "low", sv: "låg" },
  medium: { en: "medium", sv: "medel" },
  high: { en: "high", sv: "hög" }
};

function label(key: string | undefined, sv: boolean): string {
  if (!key) return "—";
  const found = LABELS[key.toLowerCase()];
  return found ? (sv ? found.sv : found.en) : key;
}

export default function SentimentPanel({ companyQuery, sv }: { companyQuery: string; sv: boolean }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPosts, setShowPosts] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/placera?companyQuery=${encodeURIComponent(companyQuery)}`, {
        cache: "no-store"
      });
      const body = (await response.json()) as Payload;
      if (!response.ok) {
        // A 404 here means Placera has no forum for this company, which is a
        // real answer about coverage rather than a failure of ours.
        setError(
          response.status === 404
            ? sv
              ? "Placera har inget forum för det här bolaget."
              : "Placera has no forum for this company."
            : (body.error ?? (sv ? "Kunde inte hämta sentiment." : "Could not load sentiment."))
        );
        setPayload(null);
        return;
      }
      setPayload(body);
    } catch {
      setError(sv ? "Kunde inte hämta sentiment." : "Could not load sentiment.");
    } finally {
      setLoading(false);
    }
  }, [companyQuery, sv]);

  useEffect(() => {
    void load();
  }, [load]);

  const s = payload?.sentiment;
  const dist = s?.distribution;
  const posts = payload?.posts ?? [];

  return (
    <div className={styles.panel}>
      <div className={styles.toolHead}>
        <div>
          <h2>{sv ? "Forumsentiment" : "Forum sentiment"}</h2>
          <p className={styles.note}>
            {sv
              ? `Placeras forum, senaste ${payload?.lookback_days ?? 90} dagarna.`
              : `The Placera forum, last ${payload?.lookback_days ?? 90} days.`}
          </p>
        </div>
      </div>

      {loading ? <p className={styles.note}>{sv ? "Hämtar…" : "Loading…"}</p> : null}
      {!loading && error ? <p className={styles.toolError}>{error}</p> : null}

      {!loading && s && dist ? (
        <>
          <div className={styles.sentimentHead}>
            <div>
              <p className={styles.sentimentScore}>{label(s.band || s.label, sv)}</p>
              <p className={styles.note}>
                {/* Confidence and volume travel with the score, always. The
                    same number from 4 posts and from 400 means different
                    things, and only these two say which. */}
                {sv ? "Tillförlitlighet" : "Confidence"}: {label(s.confidence?.level, sv)} ·{" "}
                {s.total_entities} {sv ? "inlägg och svar" : "posts and replies"}
              </p>
            </div>
          </div>

          {s.total_entities > 0 ? (
            <div className={styles.distBar} role="img" aria-label={sv ? "Fördelning" : "Distribution"}>
              {dist.positive.percent > 0 ? (
                <span className={styles.distPos} style={{ width: `${dist.positive.percent}%` }} />
              ) : null}
              {dist.neutral.percent > 0 ? (
                <span className={styles.distNeu} style={{ width: `${dist.neutral.percent}%` }} />
              ) : null}
              {dist.negative.percent > 0 ? (
                <span className={styles.distNeg} style={{ width: `${dist.negative.percent}%` }} />
              ) : null}
            </div>
          ) : null}

          <ul className={styles.legend}>
            <li>
              <span className={`${styles.swatch} ${styles.distPos}`} aria-hidden="true" />
              {sv ? "Positiva" : "Positive"} {dist.positive.count}
            </li>
            <li>
              <span className={`${styles.swatch} ${styles.distNeu}`} aria-hidden="true" />
              {sv ? "Neutrala" : "Neutral"} {dist.neutral.count}
            </li>
            <li>
              <span className={`${styles.swatch} ${styles.distNeg}`} aria-hidden="true" />
              {sv ? "Negativa" : "Negative"} {dist.negative.count}
            </li>
          </ul>

          {posts.length > 0 ? (
            <>
              <button
                type="button"
                className={styles.expand}
                onClick={() => setShowPosts((v) => !v)}
                aria-expanded={showPosts}
              >
                {showPosts
                  ? sv
                    ? "Dölj inlägg"
                    : "Hide posts"
                  : sv
                    ? `Visa ${Math.min(posts.length, POSTS_SHOWN)} av ${posts.length} inlägg`
                    : `Show ${Math.min(posts.length, POSTS_SHOWN)} of ${posts.length} posts`}
              </button>

              {showPosts ? (
                <ul className={styles.news}>
                  {posts.slice(0, POSTS_SHOWN).map((post) => (
                    <li key={post.id} className={styles.newsItem}>
                      <div className={styles.newsMeta}>
                        {post.created ? (
                          <time dateTime={post.created}>
                            {new Date(post.created).toLocaleDateString(sv ? "sv-SE" : "en-GB", { dateStyle: "medium" })}
                          </time>
                        ) : null}
                      </div>
                      {/* Verbatim and untruncated-in-meaning: the post is
                          evidence for the score above it, so paraphrasing it
                          would remove the only thing it is here to provide. */}
                      <p className={styles.postBody}>{post.content.slice(0, 400)}</p>
                      {post.client_url ? (
                        <a href={post.client_url} target="_blank" rel="noopener noreferrer nofollow" className={styles.postLink}>
                          {sv ? "Läs på Placera" : "Read on Placera"}
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}

          <p className={styles.disclaimer}>
            {sv
              ? "Sentiment är en automatisk lexikonbaserad läsning av offentliga forumtrådar. Det mäter vad enskilda personer skriver, inte bolagets utveckling, och är inte investeringsrådgivning."
              : "Sentiment is an automated, lexicon-based reading of public forum threads. It measures what individuals wrote, not how the company is performing, and is not investment advice."}
          </p>
        </>
      ) : null}
    </div>
  );
}
