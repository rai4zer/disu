"use client";

/**
 * Global instrument search: the magnifying glass in the top bar.
 *
 * This is the way in to `/instrument/[symbol]`. Before it existed those pages
 * were reachable only by typing a URL or finding a name in the movers card,
 * which made most of the catalogue unreachable in practice.
 *
 * Works signed out, because the pages it leads to are public (ROADMAP §4.6) and
 * gating the door would gate the room.
 *
 * Results come from `/api/tickers/search`, which layers Yahoo's search over the
 * curated local list. It never invents a match: an empty result says so rather
 * than offering the closest string, because a suggested ticker is a claim that
 * the instrument exists.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/app/i18n/language";
import styles from "./instrument-search.module.css";

type Suggestion = { symbol: string; name: string; currency?: string; label?: string };

export default function InstrumentSearch() {
  const router = useRouter();
  const { language } = useLanguage();
  const sv = language === "sv";

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setItems([]);
    setActive(0);
  }, []);

  const go = useCallback(
    (symbol: string) => {
      close();
      router.push(`/instrument/${encodeURIComponent(symbol)}`);
    },
    [close, router]
  );

  // Focus on open. Without this the panel appears and the keyboard is still
  // pointed at the button behind it.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Escape closes; click outside closes. Both are expected of a popover and
  // neither is free.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open, close]);

  // Debounced lookup. Every keystroke reaching the network would put an
  // upstream call behind each letter, and Yahoo's rate limiter is the
  // documented failure mode here (docs/market-live-feed.md).
  useEffect(() => {
    const term = query.trim();
    if (!open || term.length < 1) {
      setItems([]);
      setLoading(false);
      return;
    }

    let alive = true;
    const controller = new AbortController();
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/tickers/search?q=${encodeURIComponent(term)}&limit=8`, {
          signal: controller.signal,
          cache: "no-store"
        });
        const body = (await response.json()) as { ok?: boolean; suggestions?: Suggestion[] };
        if (!alive) return;
        setItems(Array.isArray(body.suggestions) ? body.suggestions : []);
        setActive(0);
      } catch {
        // An aborted or failed lookup shows no results rather than stale ones
        // for a query the reader has already changed.
        if (alive) setItems([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 220);

    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open]);

  const label = sv ? "Sök instrument" : "Search instruments";

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.glass}>
          <circle cx="11" cy="11" r="7" />
          <path d="M16.5 16.5 21 21" />
        </svg>
      </button>

      {open ? (
        <div className={styles.panel} role="dialog" aria-label={label}>
          <input
            ref={inputRef}
            type="search"
            className={styles.input}
            value={query}
            placeholder={sv ? "Sök aktie, index, råvara…" : "Search shares, indices, commodities…"}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) => Math.min(i + 1, items.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                // A highlighted suggestion wins; otherwise the raw text is
                // treated as a symbol, so someone who knows the ticker does not
                // have to wait for a list to agree with them.
                const chosen = items[active]?.symbol ?? query.trim().toUpperCase();
                if (chosen) go(chosen);
              }
            }}
            aria-autocomplete="list"
            aria-controls="instrument-search-results"
          />

          <ul className={styles.results} id="instrument-search-results" role="listbox">
            {items.map((item, index) => (
              <li key={item.symbol}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={index === active ? `${styles.result} ${styles.resultActive}` : styles.result}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(item.symbol)}
                >
                  <span className={styles.resultSymbol}>{item.symbol}</span>
                  <span className={styles.resultName}>{item.name}</span>
                  {item.currency ? <span className={styles.resultMeta}>{item.currency}</span> : null}
                </button>
              </li>
            ))}
          </ul>

          {/* Three states, said plainly. "No matches" is a real answer and is
              not the same as "still looking" — conflating them is how a slow
              lookup reads as a missing instrument. */}
          {loading ? <p className={styles.hint}>{sv ? "Söker…" : "Searching…"}</p> : null}
          {!loading && query.trim() && items.length === 0 ? (
            <p className={styles.hint}>
              {sv ? "Inga träffar. Tryck Enter för att öppna " : "No matches. Press Enter to open "}
              <strong>{query.trim().toUpperCase()}</strong>
            </p>
          ) : null}
          {!query.trim() ? (
            <p className={styles.hint}>{sv ? "T.ex. AAPL, VOLV-B.ST, ^OMX, BTC-USD" : "e.g. AAPL, VOLV-B.ST, ^OMX, BTC-USD"}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
