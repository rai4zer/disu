"use client";

/**
 * The world's exchanges, on a map.
 *
 * An equal-area world map with one pin per financial centre, and beside each
 * pin a callout box carrying the venue's abbreviation, its headline index
 * level and the day's change. It answers "what is the world doing right now"
 * geographically, which the market rail's four lists cannot: the rail tells you
 * the Nikkei is up, the map tells you Asia is up and Europe is not.
 *
 * Two layers rather than one. The map, the leader lines and the pins are a
 * single SVG in the map's own coordinate system, because they all have to agree
 * about where Tokyo is. The callout boxes are HTML positioned over it in
 * percentages, because they are text — SVG text does not wrap, does not pick up
 * `.dsDelta`, and renders worse at 11px than the DOM does.
 *
 * The stage has a fixed size and scrolls horizontally below it. That is
 * deliberate: the callout positions in `exchange-catalogue.ts` are hand-placed
 * to fit the free ocean around each cluster, and free ocean is a fixed number
 * of pixels wide. Letting the map reflow would slide Frankfurt's box onto
 * Paris's at some viewport nobody tested. It is sized so the whole card fits a
 * laptop screen without scrolling, which is the constraint that sets how much
 * room the callouts get and therefore how many pins the map can carry.
 *
 * Every reading comes from `/api/market/exchanges` and is `null` when we could
 * not take it, which renders "—". A pin whose index did not resolve is still a
 * pin in the right place with no number beside it — never a placeholder level
 * (docs/synthetic-data-policy.md).
 */

import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/app/i18n/language";
import { projectToMap } from "@/app/lib/geo/equal-earth";
import { BORDERS_PATH, LAND_PATH } from "@/app/lib/geo/world-map-paths";
import { EXCHANGE_ENTRIES } from "@/app/lib/market/exchange-catalogue";
import styles from "./exchange-map.module.css";

type ExchangeQuote = {
  code: string;
  price: string | null;
  changePct: number | null;
  asOf: string | null;
};

/** Matches the route's own 45s cache, so an early poll is answered from it. */
const REFRESH_MS = 60_000;

/**
 * The window onto the generated map, in map units (the full sheet is
 * 1000 x 486.72). Trimmed at the left to drop the empty mid-Pacific and at the
 * bottom to drop Antarctica — but only that far: the crop still contains the
 * Aleutians, Hawaii and Tierra del Fuego, because a world map with the tip of
 * South America cut off reads as a mistake.
 */
const VIEW = { x: 60, y: 0, width: 940, height: 440 };

/** Graticule spacing in degrees, and how finely a curved meridian is sampled. */
const GRATICULE_STEP = 30;
const GRATICULE_SAMPLE = 5;

function toPercent(value: number, origin: number, extent: number): string {
  return `${((value - origin) / extent) * 100}%`;
}

function direction(changePct: number | null): "up" | "down" | "flat" {
  if (changePct === null || !Number.isFinite(changePct)) return "flat";
  if (changePct > 0) return "up";
  if (changePct < 0) return "down";
  return "flat";
}

function formatPct(changePct: number | null): string {
  if (changePct === null || !Number.isFinite(changePct)) return "—";
  const sign = changePct > 0 ? "+" : changePct < 0 ? "−" : "";
  return `${sign}${Math.abs(changePct).toFixed(2)}%`;
}

/** Meridians and parallels, drawn as sampled polylines because Equal Earth curves both. */
function buildGraticule(): string {
  const segments: string[] = [];

  for (let lon = -180; lon <= 180; lon += GRATICULE_STEP) {
    const points: string[] = [];
    for (let lat = -90; lat <= 90; lat += GRATICULE_SAMPLE) {
      const { x, y } = projectToMap(lat, lon);
      points.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    segments.push(`M${points.join("L")}`);
  }

  for (let lat = -60; lat <= 60; lat += GRATICULE_STEP) {
    const points: string[] = [];
    for (let lon = -180; lon <= 180; lon += GRATICULE_SAMPLE) {
      const { x, y } = projectToMap(lat, lon);
      points.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    segments.push(`M${points.join("L")}`);
  }

  return segments.join("");
}

const GRATICULE_PATH = buildGraticule();

export default function ExchangeMap() {
  const { language } = useLanguage();
  const isSv = language === "sv";

  const [quotes, setQuotes] = useState<Map<string, ExchangeQuote>>(new Map());
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/market/exchanges", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json().catch(() => ({}))) as { quotes?: ExchangeQuote[] };
        if (cancelled || !Array.isArray(payload.quotes)) return;
        setQuotes(new Map(payload.quotes.map((quote) => [quote.code, quote])));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  /** Projected pin and callout geometry. Pure trigonometry — computed once. */
  const placed = useMemo(
    () =>
      EXCHANGE_ENTRIES.map((entry) => ({
        entry,
        pin: projectToMap(entry.latitude, entry.longitude)
      })),
    []
  );

  const dash = isSv ? "Hämtar…" : "Loading…";

  return (
    <article className={`dsCard ${styles.card}`} aria-labelledby="exchange-map-title">
      <header className="dsCardHeader">
        <h2 className="dsCardTitle" id="exchange-map-title">
          {isSv ? "Världens börser" : "The world's exchanges"}
        </h2>
      </header>

      <div className={styles.viewport}>
        <div className={styles.stage}>
          <svg
            className={styles.map}
            viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
            role="img"
            aria-label={
              isSv
                ? "Världskarta med de största börserna utmarkerade."
                : "World map with the major stock exchanges marked."
            }
          >
            <path className={styles.graticule} d={GRATICULE_PATH} />
            <path className={styles.land} d={LAND_PATH} />
            <path className={styles.borders} d={BORDERS_PATH} />

            {/* Leader lines, under the pins so a pin is never cut in half. */}
            {placed.map(({ entry, pin }) => (
              <line
                key={`leader-${entry.code}`}
                className={styles.leader}
                data-active={active === entry.code ? "true" : undefined}
                x1={entry.chip.x}
                y1={entry.chip.y}
                x2={pin.x}
                y2={pin.y}
              />
            ))}

            {placed.map(({ entry, pin }) => {
              const dir = direction(quotes.get(entry.code)?.changePct ?? null);
              return (
                <g key={`pin-${entry.code}`} data-direction={dir} data-active={active === entry.code ? "true" : undefined}>
                  <circle className={styles.pinHalo} cx={pin.x} cy={pin.y} r={6} />
                  <circle className={styles.pin} cx={pin.x} cy={pin.y} r={2.6} />
                </g>
              );
            })}
          </svg>

          {/* The callout boxes. A list so a screen reader gets the readings in
              order rather than a decorative pile of divs over a picture. */}
          <ul className={styles.chips} aria-label={isSv ? "Börser" : "Exchanges"}>
            {placed.map(({ entry }) => {
              const quote = quotes.get(entry.code);
              const dir = direction(quote?.changePct ?? null);
              return (
                <li
                  key={entry.code}
                  className={styles.chip}
                  data-direction={dir}
                  style={{
                    left: toPercent(entry.chip.x, VIEW.x, VIEW.width),
                    top: toPercent(entry.chip.y, VIEW.y, VIEW.height)
                  }}
                  title={`${entry.city} · ${entry.indexName}`}
                  onMouseEnter={() => setActive(entry.code)}
                  onMouseLeave={() => setActive((current) => (current === entry.code ? null : current))}
                >
                  <span className={styles.chipCode}>{entry.code}</span>
                  <span className={styles.chipPrice}>
                    {quote?.price ?? (loading ? dash : "—")}
                  </span>
                  <span
                    className={`dsDelta ${dir === "up" ? "dsUp" : dir === "down" ? "dsDown" : "dsFlat"} ${styles.chipDelta}`}
                  >
                    {formatPct(quote?.changePct ?? null)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </article>
  );
}
