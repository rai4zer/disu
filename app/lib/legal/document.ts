/**
 * The shape of a legal document, and the helpers that build one from the
 * registers.
 *
 * The prose lives in data rather than in JSX for two reasons. It has to be
 * readable end-to-end by someone reviewing it — a lawyer, or you in six months —
 * without reading around markup. And the parts that are *facts about the system*
 * (cookies, sub-processors, retention) are generated from the registers that the
 * build already checks, so the documents cannot drift away from what the code
 * actually does.
 */

import { STORAGE_ENTRIES, type StorageEntry } from "./cookies.ts";
import { RETENTION_RULES } from "./retention.ts";
import { partiesWithRole } from "./subprocessors.ts";
import { PENDING, isPending, type LegalFact } from "./controller.ts";

export type Language = "en" | "sv";

export type Localised = { en: string; sv: string };

export function pick(text: Localised, language: Language): string {
  return text[language];
}

export type Block =
  | { kind: "p"; text: Localised }
  /** A short, emphasised statement. Used for the clauses that matter most. */
  | { kind: "callout"; text: Localised }
  | { kind: "list"; items: Localised[] }
  | { kind: "table"; columns: Localised[]; rows: Localised[][] }
  /**
   * A fact that is not established yet. Renders as a visible gap with the
   * reason, never as invented text (see controller.ts).
   */
  | { kind: "pending"; label: Localised };

export type Section = {
  /** Stable anchor. Do not renumber these — people link to them. */
  id: string;
  heading: Localised;
  blocks: Block[];
};

export type LegalDocument = {
  slug: string;
  title: Localised;
  /** One sentence, shown under the title. */
  summary: Localised;
  sections: Section[];
};

/** Renders a controller fact, or a visible gap when it is still pending. */
export function factBlock(fact: LegalFact, label: Localised): Block {
  return isPending(fact) ? { kind: "pending", label } : { kind: "p", text: { en: fact, sv: fact } };
}

export function factText(fact: LegalFact, fallback: Localised): Localised {
  return isPending(fact) ? fallback : { en: fact, sv: fact };
}

const CATEGORY_LABEL: Record<StorageEntry["category"], Localised> = {
  essential: { en: "Essential — no consent needed", sv: "Nödvändig — inget samtycke behövs" },
  preference: { en: "Preference — needs consent", sv: "Inställning — kräver samtycke" },
  analytics: { en: "Analytics — needs consent", sv: "Analys — kräver samtycke" },
  marketing: { en: "Advertising — needs consent", sv: "Annonsering — kräver samtycke" }
};

const MEDIUM_LABEL: Record<StorageEntry["medium"], Localised> = {
  cookie: { en: "Cookie", sv: "Cookie" },
  localStorage: { en: "Stored in your browser", sv: "Lagras i din webbläsare" },
  sessionStorage: { en: "Stored until you close the tab", sv: "Lagras tills du stänger fliken" }
};

/** The cookie table, built from the register rather than transcribed from it. */
export function storageTable(): Block {
  return {
    kind: "table",
    columns: [
      { en: "Name", sv: "Namn" },
      { en: "Type", sv: "Typ" },
      { en: "Why", sv: "Varför" },
      { en: "How long", sv: "Hur länge" },
      { en: "Category", sv: "Kategori" }
    ],
    rows: STORAGE_ENTRIES.map((entry) => [
      { en: entry.name, sv: entry.name },
      MEDIUM_LABEL[entry.medium],
      entry.purpose,
      entry.lifetime,
      CATEGORY_LABEL[entry.category]
    ])
  };
}

/** Sub-processors: the parties that handle personal data on our behalf. */
export function processorTable(): Block {
  return {
    kind: "table",
    columns: [
      { en: "Who", sv: "Vem" },
      { en: "What they do", sv: "Vad de gör" },
      { en: "What reaches them", sv: "Vad som når dem" },
      { en: "Where", sv: "Var" }
    ],
    rows: partiesWithRole("processor").map((party) => [
      { en: party.name, sv: party.name },
      party.purpose,
      party.receives,
      factText(party.region, { en: "Not decided yet", sv: "Inte beslutat än" })
    ])
  };
}

/**
 * Data *sources*. Listed separately and deliberately: no personal data is sent
 * to these, so calling them sub-processors would describe the arrangement
 * wrongly and would understate what the sub-processor list actually means.
 */
export function sourceTable(): Block {
  return {
    kind: "table",
    columns: [
      { en: "Who", sv: "Vem" },
      { en: "What we fetch", sv: "Vad vi hämtar" },
      { en: "What we send", sv: "Vad vi skickar" }
    ],
    rows: partiesWithRole("source").map((party) => [
      { en: party.name, sv: party.name },
      party.purpose,
      party.receives
    ])
  };
}

export function retentionTable(): Block {
  return {
    kind: "table",
    columns: [
      { en: "What", sv: "Vad" },
      { en: "How long", sv: "Hur länge" }
    ],
    rows: RETENTION_RULES.map((rule) => [rule.subject, rule.period])
  };
}

export { PENDING };
