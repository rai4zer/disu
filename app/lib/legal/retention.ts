/**
 * How long each kind of data is kept, and what makes it go away.
 *
 * GDPR Art. 13(2)(a) requires the retention period, or the criteria used to set
 * it, to be stated. Several of these are environment variables, so the honest
 * answer is "the default, unless this deployment changed it" — the defaults are
 * named next to the variable so the statement stays checkable.
 */

export type RetentionRule = {
  subject: { en: string; sv: string };
  period: { en: string; sv: string };
  /** What actually enforces it. */
  mechanism: string;
};

export const RETENTION_RULES: RetentionRule[] = [
  {
    subject: { en: "Your account and holdings", sv: "Ditt konto och dina innehav" },
    period: {
      en: "Until you delete your account. There is no automatic expiry — the data is the product, and deleting it on a timer would be deleting your portfolio.",
      sv: "Tills du raderar ditt konto. Det finns ingen automatisk utgång — datan är produkten, och att radera den på en timer vore att radera din portfölj."
    },
    mechanism: "app/api/account/delete/route.ts"
  },
  {
    subject: { en: "Quant and primer runs, and their outputs", sv: "Quant- och primer-körningar, och deras resultat" },
    period: {
      en: "30 days by default, then pruned automatically. Deployments can shorten or extend this (JOB_RETENTION_DAYS, JOB_ARTIFACT_RETENTION_DAYS).",
      sv: "30 dagar som standard, sedan rensas de automatiskt. Miljöer kan korta eller förlänga detta (JOB_RETENTION_DAYS, JOB_ARTIFACT_RETENTION_DAYS)."
    },
    mechanism: "app/lib/jobs/processor.ts"
  },
  {
    subject: { en: "Sign-in sessions", sv: "Inloggningssessioner" },
    period: {
      en: "7 days, and immediately on sign-out or a password reset — revocation happens on the server, not just in your browser.",
      sv: "7 dagar, och omedelbart vid utloggning eller lösenordsåterställning — återkallandet sker på servern, inte bara i din webbläsare."
    },
    mechanism: "app/lib/auth/session.ts, app/lib/auth/sessions.ts"
  },
  {
    subject: { en: "Password reset links", sv: "Länkar för lösenordsåterställning" },
    period: { en: "1 hour, and single-use.", sv: "1 timme, och kan bara användas en gång." },
    mechanism: "app/lib/auth/reset.ts"
  },
  {
    subject: { en: "Broker connection tokens", sv: "Token för bankkoppling" },
    period: {
      en: "Until the connection expires or you disconnect the broker. Stored encrypted, never exported, never shown.",
      sv: "Tills kopplingen går ut eller du kopplar bort banken. Lagras krypterat, exporteras aldrig, visas aldrig."
    },
    mechanism: "app/lib/brokers/tokenVault.ts"
  },
  {
    subject: { en: "The audit log of your own actions", sv: "Revisionsloggen över dina egna handlingar" },
    period: {
      en: "For as long as your account exists, then deleted with it. It records what you did, not what you looked at.",
      sv: "Så länge ditt konto finns, sedan raderas den med kontot. Den registrerar vad du gjorde, inte vad du tittade på."
    },
    mechanism: "app/lib/db/events.ts"
  },
  {
    subject: { en: "Funnel measurement, if you agreed to analytics", sv: "Trattmätning, om du godkänt analys" },
    period: {
      en: "180 days by default, then deleted automatically, and immediately with your account if you delete it. Deployments can shorten or extend this (ANALYTICS_RETENTION_DAYS). Nothing is recorded at all unless you agree to analytics.",
      sv: "180 dagar som standard, sedan raderas de automatiskt, och omedelbart med ditt konto om du raderar det. Miljöer kan korta eller förlänga detta (ANALYTICS_RETENTION_DAYS). Inget registreras alls om du inte godkänner analys."
    },
    mechanism: "app/lib/analytics/funnel-store.ts"
  },
  {
    subject: { en: "Posts and comments on the public feature board", sv: "Inlägg och kommentarer på den öppna förslagstavlan" },
    period: {
      en: "Kept after you delete your account, with your name removed. Other people are reading and replying in those threads, so the authorship link is cut rather than the thread rewritten.",
      sv: "Sparas efter att du raderat ditt konto, men utan ditt namn. Andra läser och svarar i de trådarna, så kopplingen till dig kapas i stället för att tråden skrivs om."
    },
    mechanism: "app/lib/account/personal-data.ts (erasure policy: anonymise)"
  }
];
