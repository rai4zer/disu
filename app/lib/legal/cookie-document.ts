/**
 * The cookie notice, in full.
 *
 * This document used to explain why DISU needed no consent wall. It no longer
 * can: analytics and cross-site advertising were added, so the honest version of
 * this page explains what the choice is, what each answer means, and how to
 * change it. `noticeIsSufficient()` returning false is what makes that
 * mandatory, and it is asserted in `tests/consent.test.ts` — this page cannot
 * quietly revert to claiming there is nothing to consent to.
 */

import { LEGAL_DOCUMENTS_UPDATED } from "./controller.ts";
import { noticeIsSufficient } from "./cookies.ts";
import { CONSENT_MAX_AGE_DAYS } from "./consent.ts";
import { storageTable, type LegalDocument } from "./document.ts";

export const COOKIE_DOCUMENT: LegalDocument = {
  slug: "cookies",
  title: { en: "Cookies", sv: "Cookies" },
  summary: {
    en: "What DISU stores in your browser, what you get to decide, and how to change your mind.",
    sv: "Vad DISU lagrar i din webbläsare, vad du får bestämma, och hur du ändrar dig."
  },
  sections: [
    {
      id: "your-choice",
      heading: { en: "Your choice", sv: "Ditt val" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "Some cookies are needed for DISU to work at all — they keep you signed in and stop other sites "
              + "submitting forms as you. Those are used either way, because without them there is no service to use.",
            sv: "Vissa cookies behövs för att DISU ska fungera alls — de håller dig inloggad och hindrar andra sajter "
              + "från att skicka formulär som dig. De används oavsett, eftersom det utan dem inte finns någon tjänst att använda."
          }
        },
        {
          kind: "callout",
          text: {
            en: "Everything else is your decision, and the honest answer is that it is off until you say otherwise. "
              + "We would like to use analytics, to see which pages people get stuck on, and advertising cookies, "
              + "which let Google, Meta and LinkedIn know you were here so we can measure campaigns and show you "
              + "DISU adverts elsewhere. You can say no to either or both, no part of the product is withheld if "
              + "you do, and saying no takes exactly as many clicks as saying yes.",
            sv: "Allt annat är ditt beslut, och det ärliga svaret är att det är avstängt tills du säger något annat. "
              + "Vi vill gärna använda analys, för att se vilka sidor människor fastnar på, och annonscookies, "
              + "som låter Google, Meta och LinkedIn veta att du varit här så att vi kan mäta kampanjer och visa dig "
              + "DISU-annonser på andra ställen. Du kan säga nej till en av dem eller båda, ingen del av produkten "
              + "hålls tillbaka om du gör det, och att säga nej tar exakt lika många klick som att säga ja."
          }
        },
        {
          kind: "p",
          text: {
            en: "Nothing in those two categories is loaded before you agree. The scripts are not fetched, not "
              + "evaluated, and set nothing — this is not a case of loading them and asking them politely to wait.",
            sv: "Inget i de två kategorierna laddas innan du godkänner. Skripten hämtas inte, körs inte, och sätter "
              + "ingenting — det handlar inte om att ladda dem och sedan artigt be dem vänta."
          }
        }
      ]
    },
    {
      id: "changing-your-mind",
      heading: { en: "Changing your mind", sv: "Att ändra sig" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "Use the **Cookie settings** link in the footer of any page. It opens the same choices you were "
              + "first shown, with whatever you picked last time. Withdrawing is a single click and takes effect "
              + "immediately.",
            sv: "Använd länken **Cookie-inställningar** i sidfoten på vilken sida som helst. Den öppnar samma val du "
              + "först fick se, med det du valde senast. Att återkalla är ett klick och gäller omedelbart."
          }
        },
        {
          kind: "p",
          text: {
            en: "When you switch something off we delete the cookies we set ourselves, and stop loading the scripts "
              + "at once. A few cookies are set by Meta and LinkedIn on their own domains, which we have no way to "
              + "reach from here — those you can clear in your browser settings, and we would rather say so than "
              + "imply a clean sweep.",
            sv: "När du stänger av något raderar vi de cookies vi själva satt, och slutar ladda skripten direkt. "
              + "Några cookies sätts av Meta och LinkedIn på deras egna domäner, som vi inte kan nå härifrån — dem "
              + "kan du rensa i din webbläsares inställningar, och vi säger det hellre än att antyda en total rensning."
          }
        },
        {
          kind: "p",
          text: {
            en: `We also ask again after ${CONSENT_MAX_AGE_DAYS} days rather than treating one answer as permanent. `
              + "If you said no, we remember the no for that whole period — you will not be asked again on the next page.",
            sv: `Vi frågar också igen efter ${CONSENT_MAX_AGE_DAYS} dagar i stället för att behandla ett svar som permanent. `
              + "Om du sa nej kommer vi ihåg nejet hela perioden — du blir inte tillfrågad igen på nästa sida."
          }
        }
      ]
    },
    {
      id: "full-list",
      heading: { en: "Everything we store", sv: "Allt vi lagrar" },
      blocks: [storageTable()]
    },
    {
      id: "your-control",
      heading: { en: "Clearing it entirely", sv: "Rensa bort allt" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "You can delete all of it from your browser settings at any time. Nothing breaks permanently — you "
              + "will be signed out, your theme and language go back to their defaults, and we will ask about the "
              + "optional cookies again.",
            sv: "Du kan ta bort allt från dina webbläsarinställningar när som helst. Inget går sönder permanent — du "
              + "loggas ut, tema och språk återgår till sina standardvärden, och vi frågar om de valfria cookies igen."
          }
        },
        {
          kind: "p",
          text: {
            en: `Last updated ${LEGAL_DOCUMENTS_UPDATED}.`,
            sv: `Senast uppdaterad ${LEGAL_DOCUMENTS_UPDATED}.`
          }
        }
      ]
    }
  ]
};

export { noticeIsSufficient };
