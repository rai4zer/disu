"use client";

/**
 * Loads third-party tags — and only ever after both conditions hold: the
 * visitor consented to the category, and this deployment configured the id.
 *
 * The tags are not loaded-then-suppressed. Nothing is injected at all until
 * consent, because a Google or Meta script that has been evaluated has already
 * been contacted, already seen the IP address, and in some configurations
 * already written a cookie — "loaded but told not to track" is a weaker promise
 * than "not loaded", and only one of them is easy to verify.
 *
 * (Google's Consent Mode is the alternative: load early with everything denied
 * and signal changes afterwards. It gives better modelled conversions and is
 * defensible, but it means the script runs before anyone said yes. If that trade
 * is ever wanted, make it deliberately and update the privacy policy with it —
 * do not let it arrive as a side effect of a tag-manager setting.)
 *
 * On withdrawal the scripts stop being rendered and the cookies we can reach are
 * deleted by ConsentProvider. Already-evaluated JavaScript cannot be recalled
 * from a live page, so a withdrawal also does a one-time reload to guarantee the
 * next paint is clean.
 */

import { useEffect, useRef } from "react";
import Script from "next/script";
import { useConsent } from "./consent-provider";
import { TAGS, tagId } from "@/app/lib/legal/tags.ts";

/**
 * `process.env.NEXT_PUBLIC_*` is inlined at build time, so it has to be read
 * through explicit property accesses — a dynamic `process.env[name]` lookup
 * resolves to undefined in the browser and every tag would silently never load.
 * `tests/consent.test.ts` asserts every tag in the register appears here.
 */
const TAG_IDS: Record<string, string | undefined> = {
  NEXT_PUBLIC_GA4_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID,
  NEXT_PUBLIC_GOOGLE_ADS_ID: process.env.NEXT_PUBLIC_GOOGLE_ADS_ID,
  NEXT_PUBLIC_META_PIXEL_ID: process.env.NEXT_PUBLIC_META_PIXEL_ID,
  NEXT_PUBLIC_LINKEDIN_PARTNER_ID: process.env.NEXT_PUBLIC_LINKEDIN_PARTNER_ID
};

export default function ConsentTags() {
  const { allows, ready, record } = useConsent();
  const previouslyAllowed = useRef<Set<string> | null>(null);

  const active = TAGS.filter((tag) => allows(tag.category) && tagId(tag, TAG_IDS) !== null);
  const activeIds = new Set(active.map((tag) => tag.id));

  useEffect(() => {
    if (!ready) {
      return;
    }
    const previous = previouslyAllowed.current;
    previouslyAllowed.current = activeIds;
    if (!previous) {
      return;
    }
    // Something that was running is no longer permitted. The script is already
    // in memory, so the only honest way to stop it is a fresh document.
    const revoked = [...previous].some((id) => !activeIds.has(id));
    if (revoked) {
      window.location.reload();
    }
    // Keyed on the recorded decision, not on the derived set, so this runs once
    // per actual change of mind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, record?.decidedAt]);

  if (!ready || active.length === 0) {
    return null;
  }

  const ga4 = active.find((tag) => tag.id === "ga4");
  const googleAds = active.find((tag) => tag.id === "google-ads");
  const meta = active.find((tag) => tag.id === "meta-pixel");
  const linkedin = active.find((tag) => tag.id === "linkedin-insight");

  const ga4Id = ga4 ? tagId(ga4, TAG_IDS) : null;
  const adsId = googleAds ? tagId(googleAds, TAG_IDS) : null;
  const metaId = meta ? tagId(meta, TAG_IDS) : null;
  const linkedinId = linkedin ? tagId(linkedin, TAG_IDS) : null;
  const gtagId = ga4Id ?? adsId;

  return (
    <>
      {gtagId ? (
        <>
          <Script
            id="gtag-src"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gtagId)}`}
          />
          <Script id="gtag-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());`
              + (ga4Id ? `gtag('config','${ga4Id}');` : "")
              + (adsId ? `gtag('config','${adsId}');` : "")}
          </Script>
        </>
      ) : null}

      {metaId ? (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaId}');fbq('track','PageView');`}
        </Script>
      ) : null}

      {linkedinId ? (
        <Script id="linkedin-insight" strategy="afterInteractive">
          {`window._linkedin_partner_id='${linkedinId}';window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push('${linkedinId}');(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}var s=document.getElementsByTagName('script')[0];var b=document.createElement('script');b.type='text/javascript';b.async=true;b.src='https://snap.licdn.com/li.lms-analytics/insight.min.js';s.parentNode.insertBefore(b,s)})(window.lintrk);`}
        </Script>
      ) : null}
    </>
  );
}
