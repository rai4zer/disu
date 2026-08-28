/**
 * The third-party tags, what category each belongs to, and what each one drops
 * on the device.
 *
 * Two independent conditions must both hold before a tag loads:
 *
 *  1. the visitor has consented to its category, and
 *  2. this deployment has actually configured its id.
 *
 * Neither implies the other, and requiring both is what makes a half-configured
 * environment safe: a staging box with no Meta pixel id loads no Meta pixel, and
 * a production box with an id still loads nothing until someone says yes.
 *
 * `cookies` is not documentation. It is the list `withdrawTag()` deletes from
 * when someone changes their mind, so an entry missing from it is a cookie that
 * survives a withdrawal — which is the difference between honouring Art. 7(3)
 * and merely claiming to.
 */

import type { ConsentCategory } from "./consent.ts";

export type TagCookie = {
  /** Cookie name, or a prefix when the vendor appends an id (`_ga_G-XXXX`). */
  name: string;
  /** Prefix matches delete every cookie starting with `name`. */
  prefix?: boolean;
  /**
   * Whether we can actually delete it.
   *
   * A cookie the vendor's script set on *our* domain is ours to remove. One set
   * on the vendor's own domain is not reachable from here at all — the honest
   * answer is that withdrawal stops the tag from loading and we tell the user
   * where to clear the rest, rather than pretending we wiped it.
   */
  firstParty: boolean;
};

export type Tag = {
  id: string;
  vendor: string;
  category: Exclude<ConsentCategory, "necessary">;
  /** Environment variable holding the measurement/pixel id. */
  envVar: string;
  purpose: { en: string; sv: string };
  cookies: TagCookie[];
};

export const TAGS: Tag[] = [
  {
    id: "ga4",
    vendor: "Google Analytics 4",
    category: "analytics",
    envVar: "NEXT_PUBLIC_GA4_MEASUREMENT_ID",
    purpose: {
      en: "Measures which pages people use and where they give up, so the product can be improved.",
      sv: "Mäter vilka sidor människor använder och var de ger upp, så att produkten kan förbättras."
    },
    cookies: [
      { name: "_ga", firstParty: true },
      { name: "_ga_", prefix: true, firstParty: true },
      { name: "_gid", firstParty: true }
    ]
  },
  {
    id: "google-ads",
    vendor: "Google Ads",
    category: "marketing",
    envVar: "NEXT_PUBLIC_GOOGLE_ADS_ID",
    purpose: {
      en: "Records which advert brought you here, and lets Google show DISU adverts to you on other sites.",
      sv: "Registrerar vilken annons som förde dig hit, och låter Google visa DISU-annonser för dig på andra sajter."
    },
    cookies: [
      { name: "_gcl_au", firstParty: true },
      { name: "_gcl_aw", firstParty: true }
    ]
  },
  {
    id: "meta-pixel",
    vendor: "Meta (Facebook) Pixel",
    category: "marketing",
    envVar: "NEXT_PUBLIC_META_PIXEL_ID",
    purpose: {
      en: "Tells Meta that you visited DISU, so campaigns can be measured and you can be shown DISU adverts on Facebook and Instagram.",
      sv: "Berättar för Meta att du besökt DISU, så att kampanjer kan mätas och du kan visas DISU-annonser på Facebook och Instagram."
    },
    cookies: [
      { name: "_fbp", firstParty: true },
      { name: "_fbc", firstParty: true }
    ]
  },
  {
    id: "linkedin-insight",
    vendor: "LinkedIn Insight Tag",
    category: "marketing",
    envVar: "NEXT_PUBLIC_LINKEDIN_PARTNER_ID",
    purpose: {
      en: "The same, for LinkedIn campaigns.",
      sv: "Detsamma, för LinkedIn-kampanjer."
    },
    cookies: [
      { name: "li_sugr", firstParty: true },
      { name: "UserMatchHistory", firstParty: false },
      { name: "bcookie", firstParty: false },
      { name: "lidc", firstParty: false }
    ]
  }
];

/** The id for a tag in this environment, or null when it is not configured. */
export function tagId(tag: Tag, env: Record<string, string | undefined>): string | null {
  const value = (env[tag.envVar] ?? "").trim();
  return value.length > 0 ? value : null;
}

/** Categories that any declared tag actually uses. */
export function categoriesInUse(): Set<ConsentCategory> {
  return new Set(TAGS.map((tag) => tag.category));
}
