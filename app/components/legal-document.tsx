"use client";

/**
 * Renders a LegalDocument. One component for all three pages, so the privacy
 * policy and the terms cannot drift into looking like different products.
 *
 * A `pending` block is rendered as a visible gap, not skipped. If a fact is not
 * established yet the reader should see that a fact is missing — quietly
 * omitting it is how a policy ends up looking complete when it is not
 * (app/lib/legal/controller.ts).
 */

import type { Block, LegalDocument } from "@/app/lib/legal/document.ts";
import { pick } from "@/app/lib/legal/document.ts";
import { useLanguage } from "@/app/i18n/language";
import styles from "./legal-document.module.css";

function BlockView({ block, language }: { block: Block; language: "en" | "sv" }) {
  if (block.kind === "p") {
    return <p className={styles.paragraph}>{pick(block.text, language)}</p>;
  }

  if (block.kind === "callout") {
    return (
      <p className={styles.callout} role="note">
        {pick(block.text, language)}
      </p>
    );
  }

  if (block.kind === "list") {
    return (
      <ul className={styles.list}>
        {block.items.map((item, index) => (
          <li key={index}>{pick(item, language)}</li>
        ))}
      </ul>
    );
  }

  if (block.kind === "table") {
    return (
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {block.columns.map((column, index) => (
                <th key={index} scope="col">
                  {pick(column, language)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{pick(cell, language)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const isSv = language === "sv";
  return (
    <p className={styles.pending}>
      <strong>{pick(block.label, language)}:</strong>{" "}
      {isSv
        ? "ännu inte fastställt. Företaget är inte registrerat än, och vi hittar inte på en uppgift här."
        : "not established yet. The company is not registered, and we will not invent a detail here."}
    </p>
  );
}

export default function LegalDocumentView({ document: doc }: { document: LegalDocument }) {
  const { language } = useLanguage();

  return (
    <article className={styles.document}>
      {doc.sections.map((section) => (
        <section key={section.id} id={section.id} className={`${styles.section} appSection`}>
          <h2 className={styles.heading}>{pick(section.heading, language)}</h2>
          {section.blocks.map((block, index) => (
            <BlockView key={index} block={block} language={language} />
          ))}
        </section>
      ))}
    </article>
  );
}
