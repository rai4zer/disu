"use client";

/**
 * The order ticket beside the chart.
 *
 * **A scaffold in front of a scaffold.** `app/lib/trading/` already holds the
 * domain model and the order state machine, and `docs/trading-platform.md` §6
 * says plainly that none of it is reachable from a route — §5 is a long gate
 * that has not been passed. So this is the ticket's shape, argued while it is
 * cheap, with a submit that is disabled rather than a live one that lies. The
 * paragraph that used to spell that out under the button is gone: it explained
 * the state of the plumbing, every visit, to a reader who had not asked, and
 * the foot of the ticket is worth more to the two analysis tools that sit there
 * now.
 *
 * Two things it takes from the domain rather than inventing:
 *
 * - **Limit only.** `OrderKind` is `"limit"` and nothing else, deliberately: a
 *   retail market order on a thin Nordic small cap is how someone discovers
 *   slippage with their own money. A "Market" option here would promise an
 *   order type the model refuses to represent.
 * - **`TimeInForce` is `day | gtc`**, the same two the model carries.
 *
 * The one number not typed by the reader is the last traded price, fetched from
 * `/api/tickers/history` — the same observed quote the chart draws. Missing, it
 * stays `—` and the estimate is withheld rather than zeroed
 * (docs/synthetic-data-policy.md).
 *
 * The price arrows step by the instrument's minimum increment rather than by a
 * flat 0.01, and snap a typed price onto the ladder — see `tick-size.ts`, which
 * owns that rule and says what it assumes. The tick is shown under the field so
 * the step is never a surprise.
 */

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSignedIn } from "@/app/components/session-context";
import {
  snapPrice,
  stepPrice,
  tickDecimals,
  tickRegimeForSymbol,
  tickSize
} from "@/app/lib/trading/tick-size";
import type { OrderSide, TimeInForce } from "@/app/lib/trading/types";
import styles from "./trade-panel.module.css";
import { NUMBER_LOCALE } from "@/app/lib/format/number";

const SIDE_LABELS: Record<OrderSide, { en: string; sv: string }> = {
  buy: { en: "Buy", sv: "Köp" },
  sell: { en: "Sell", sv: "Sälj" }
};

const VALIDITY_LABELS: Record<TimeInForce, { en: string; sv: string }> = {
  day: { en: "Day order", sv: "Dagorder" },
  gtc: { en: "Until cancelled", sv: "Tills återkallad" }
};

/** Accepts the Swedish decimal comma as well as the point. */
function decimal(input: string): number | null {
  const parsed = Number(input.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function money(value: number, currency: string | null): string {
  const text = value.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${text} ${currency}` : text;
}

/**
 * Render a stepped price back into the field. `decimal` still accepts a typed
 * Swedish comma, but what we write is always the American mark, so the field
 * matches the prices quoted beside it.
 */
function writeBack(value: number, tick: number): string {
  return value.toFixed(tickDecimals(tick));
}

/** The up/down pair that sits inside a field. */
function Stepper({
  onStep,
  labelUp,
  labelDown
}: {
  onStep: (direction: 1 | -1) => void;
  labelUp: string;
  labelDown: string;
}) {
  return (
    <span className={styles.stepper}>
      <button type="button" className={styles.step} onClick={() => onStep(1)} aria-label={labelUp}>
        <svg viewBox="0 0 10 6" aria-hidden="true" focusable="false">
          <path d="M1 5L5 1l4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button type="button" className={styles.step} onClick={() => onStep(-1)} aria-label={labelDown}>
        <svg viewBox="0 0 10 6" aria-hidden="true" focusable="false">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </span>
  );
}

export default function TradePanel({
  symbol,
  currency,
  sv,
  footer
}: {
  symbol: string;
  currency: string | null;
  sv: boolean;
  /** The analysis tools, which close the ticket rather than open a card below it. */
  footer?: ReactNode;
}) {
  const signedIn = useSignedIn();

  const [side, setSide] = useState<OrderSide>("buy");
  const [validity, setValidity] = useState<TimeInForce>("day");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [last, setLast] = useState<number | null>(null);

  // The last traded price. `range=1d` is the cheapest window that still carries
  // `meta.regularMarketPrice`; the route requires a session, which is why this
  // only runs for a signed-in reader.
  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch(`/api/tickers/history?symbol=${encodeURIComponent(symbol)}&range=1d`, {
          signal: controller.signal,
          cache: "no-store"
        });
        const json = (await response.json()) as { ok?: boolean; meta?: { price?: number | null } };
        setLast(response.ok && json.ok === true && typeof json.meta?.price === "number" ? json.meta.price : null);
      } catch {
        // An unreadable quote leaves the field at "—". It is never filled in.
        if (!controller.signal.aborted) setLast(null);
      }
    };

    void load();
    return () => controller.abort();
  }, [signedIn, symbol]);

  const qty = decimal(quantity);
  const limit = decimal(limitPrice);
  const estimate = useMemo(() => (qty !== null && limit !== null ? qty * limit : null), [qty, limit]);

  const regime = useMemo(() => tickRegimeForSymbol(symbol), [symbol]);

  // The increment is read at the price in the field, because the ladder is a
  // function of price: the same instrument steps by a different amount at 9 and
  // at 900. Falls back to the last traded price so the hint has something to
  // say before anything is typed.
  const basis = limit ?? last;
  const tick = basis !== null ? tickSize(basis, regime) : null;

  const stepLimit = (direction: 1 | -1) => {
    // An empty field seeds from the last price rather than stepping from
    // nothing — but snapped, so the first value the arrow offers is one the
    // venue would accept.
    if (limit === null) {
      if (last === null) return;
      const seeded = snapPrice(last, regime);
      if (seeded !== null) setLimitPrice(writeBack(seeded, tick ?? seeded));
      return;
    }
    const next = stepPrice(limit, direction, regime);
    if (next !== null) setLimitPrice(writeBack(next, tick ?? next));
  };

  // Whole shares, and never below one: an order for zero is not an order.
  // Fractional quantities are a partner capability we do not have (types.ts).
  const stepQuantity = (direction: 1 | -1) => {
    const current = qty === null ? 0 : Math.floor(qty);
    setQuantity(String(Math.max(1, current + direction)));
  };

  if (!signedIn) {
    return (
      <aside className={styles.panel} aria-labelledby="trade-heading">
        <h2 className={styles.heading} id="trade-heading">
          {sv ? "Handla" : "Trade"}
        </h2>
        <p className={styles.gateText}>
          {sv
            ? "Logga in för att skissa en order för detta instrument."
            : "Sign in to draft an order for this instrument."}
        </p>
        <Link href="/auth/login?mode=register" className={styles.gateCta}>
          {sv ? "Skapa konto" : "Create account"}
        </Link>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </aside>
    );
  }

  return (
    <aside className={styles.panel} aria-labelledby="trade-heading">
      <div className={styles.head}>
        <h2 className={styles.heading} id="trade-heading">
          {sv ? "Handla" : "Trade"}
        </h2>
        <span className={styles.symbol}>{symbol}</span>
      </div>

      <div className={styles.sides} role="group" aria-label={sv ? "Köp eller sälj" : "Buy or sell"}>
        {(["buy", "sell"] as OrderSide[]).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={side === option}
            className={
              side === option
                ? `${styles.side} ${option === "buy" ? styles.sideBuy : styles.sideSell}`
                : styles.side
            }
            onClick={() => setSide(option)}
          >
            {sv ? SIDE_LABELS[option].sv : SIDE_LABELS[option].en}
          </button>
        ))}
      </div>

      {/* Nothing to submit to yet, so the default action is prevented rather
          than left to reload the page. */}
      <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
        <label className={styles.field}>
          <span>{sv ? "Antal andelar" : "Number of shares"}</span>
          <span className={styles.control}>
            <input
              className={styles.input}
              inputMode="numeric"
              placeholder="0"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
            <Stepper
              onStep={stepQuantity}
              labelUp={sv ? "En andel mer" : "One share more"}
              labelDown={sv ? "En andel mindre" : "One share fewer"}
            />
          </span>
        </label>

        <label className={styles.field}>
          <span>{sv ? "Limitkurs" : "Limit price"}</span>
          <span className={styles.control}>
            <input
              className={styles.input}
              inputMode="decimal"
              placeholder={last !== null ? last.toFixed(2) : "0.00"}
              value={limitPrice}
              onChange={(event) => setLimitPrice(event.target.value)}
            />
            <Stepper
              onStep={stepLimit}
              labelUp={sv ? "Ett steg upp" : "One tick up"}
              labelDown={sv ? "Ett steg ned" : "One tick down"}
            />
          </span>
          {/* Says what the arrow will do before it is pressed, and quietly
              admits when there is no price to derive an increment from. */}
          <span className={styles.hint}>
            {tick !== null
              ? `${sv ? "Kurssteg" : "Tick"} ${tick.toFixed(tickDecimals(tick))}${currency ? ` ${currency}` : ""}`
              : sv
                ? "Kurssteg okänt utan kurs"
                : "No price, so no increment"}
          </span>
        </label>

        <label className={styles.field}>
          <span>{sv ? "Giltighet" : "Validity"}</span>
          <select
            className={styles.input}
            value={validity}
            onChange={(event) => setValidity(event.target.value as TimeInForce)}
          >
            {(["day", "gtc"] as TimeInForce[]).map((option) => (
              <option key={option} value={option}>
                {sv ? VALIDITY_LABELS[option].sv : VALIDITY_LABELS[option].en}
              </option>
            ))}
          </select>
        </label>

        <dl className={styles.readout}>
          <div>
            <dt>{sv ? "Senast betalt" : "Last price"}</dt>
            <dd>{last !== null ? money(last, currency) : "—"}</dd>
          </div>
          <div>
            <dt>{sv ? "Uppskattat belopp" : "Estimated amount"}</dt>
            {/* Withheld while the inputs are incomplete: a 0.00 here would read
                as a priced order rather than as an empty form. */}
            <dd>{estimate !== null ? money(estimate, currency) : "—"}</dd>
          </div>
        </dl>

        <button type="submit" className={styles.submit} disabled>
          {sv ? SIDE_LABELS[side].sv : SIDE_LABELS[side].en} {symbol}
        </button>
      </form>

      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </aside>
  );
}
