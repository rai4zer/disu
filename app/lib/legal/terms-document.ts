/**
 * Terms of service.
 *
 * Two clauses in here are not boilerplate and must not be softened, because the
 * whole regulatory position of the product pre-M6 rests on them (ROADMAP §2.2,
 * §7.2): DISU gives **information, not investment advice**, and DISU **never
 * holds money or executes an order**. `tests/legal-documents.test.ts` asserts
 * both are present.
 *
 * The tone is deliberate. A document that hedges every sentence into
 * unreadability protects nobody: a user who cannot understand what they agreed
 * to has not meaningfully agreed to it.
 */

import { CONTROLLER, LEGAL_DOCUMENTS_UPDATED } from "./controller.ts";
import { factBlock, type LegalDocument } from "./document.ts";

export const TERMS_DOCUMENT: LegalDocument = {
  slug: "terms",
  title: { en: "Terms of service", sv: "Användarvillkor" },
  summary: {
    en: "What DISU does, what it deliberately does not do, and what we each owe the other.",
    sv: "Vad DISU gör, vad det medvetet inte gör, och vad vi är skyldiga varandra."
  },
  sections: [
    {
      id: "what-this-is",
      heading: { en: "What DISU is", sv: "Vad DISU är" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "DISU is a tool for understanding investments you already have. It shows you what you own, what it is "
              + "worth, what the mood around it is, and what a company's own filings say — in plain language.",
            sv: "DISU är ett verktyg för att förstå investeringar du redan har. Det visar vad du äger, vad det är "
              + "värt, vilken stämning som råder omkring det, och vad ett företags egna rapporter säger — på vanligt språk."
          }
        },
        {
          kind: "p",
          text: {
            en: "By using DISU you agree to these terms. If you do not, do not create an account.",
            sv: "Genom att använda DISU godkänner du dessa villkor. Om du inte gör det, skapa inget konto."
          }
        },
        factBlock(CONTROLLER.legalName, { en: "The company behind DISU", sv: "Företaget bakom DISU" })
      ]
    },
    {
      id: "not-advice",
      heading: { en: "This is not investment advice", sv: "Detta är inte investeringsrådgivning" },
      blocks: [
        {
          kind: "callout",
          text: {
            en: "Nothing in DISU is investment advice, a personal recommendation, or a solicitation to buy or sell "
              + "anything. We do not know your circumstances, your goals, or your risk tolerance, and we do not "
              + "attempt to. Every number, summary, score and signal in the product is information for you to "
              + "think with — not a suggestion about what to do.",
            sv: "Inget i DISU är investeringsrådgivning, en personlig rekommendation eller en uppmaning att köpa eller "
              + "sälja något. Vi känner inte din situation, dina mål eller din risktolerans, och vi försöker inte "
              + "göra det. Varje tal, sammanfattning, poäng och signal i produkten är information att tänka med — "
              + "inte ett förslag om vad du ska göra."
          }
        },
        {
          kind: "p",
          text: {
            en: "Investment decisions are yours alone, and you bear their outcome. Investments can fall as well as "
              + "rise, past performance says nothing reliable about the future, and you can lose money. If you want "
              + "advice about your own situation, speak to a licensed adviser.",
            sv: "Investeringsbeslut är dina egna, och du bär deras utfall. Investeringar kan både falla och stiga, "
              + "historisk avkastning säger inget tillförlitligt om framtiden, och du kan förlora pengar. Om du vill "
              + "ha rådgivning om din egen situation, tala med en licensierad rådgivare."
          }
        }
      ]
    },
    {
      id: "no-money",
      heading: { en: "We do not hold your money or trade for you", sv: "Vi håller inte dina pengar och handlar inte för dig" },
      blocks: [
        {
          kind: "callout",
          text: {
            en: "DISU does not hold client money or assets, does not execute orders, and cannot move anything in your "
              + "accounts. It is a read-only view. Your money stays with your bank or broker, and buying and selling "
              + "happens there — never here.",
            sv: "DISU håller inte kundmedel eller tillgångar, utför inga order, och kan inte flytta något på dina "
              + "konton. Det är en läsvy. Dina pengar stannar hos din bank eller depotbank, och köp och försäljning "
              + "sker där — aldrig här."
          }
        },
        {
          kind: "p",
          text: {
            en: "When you connect a broker, the connection is made through a regulated account-information provider, "
              + "you authenticate at your own bank, and the access we receive is read-only. You can disconnect it at "
              + "any time.",
            sv: "När du kopplar en bank sker kopplingen via en reglerad leverantör av kontoinformation, du "
              + "autentiserar dig hos din egen bank, och den åtkomst vi får är läsbehörighet. Du kan koppla bort den "
              + "när som helst."
          }
        }
      ]
    },
    {
      id: "accuracy",
      heading: { en: "What we can and cannot promise about the data", sv: "Vad vi kan och inte kan lova om datan" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "We work hard to show you real numbers or nothing at all. Where a value is a placeholder or comes "
              + "from a fallback rather than a live source, the product says so rather than dressing it up as an "
              + "observation. That is a rule we hold ourselves to and test for.",
            sv: "Vi arbetar hårt för att visa dig riktiga tal eller inget alls. Där ett värde är en platshållare eller "
              + "kommer från en reservkälla i stället för en live-källa säger produkten det, i stället för att klä ut "
              + "det till en observation. Det är en regel vi håller oss till och testar."
          }
        },
        {
          kind: "list",
          items: [
            {
              en: "Prices and index levels are delayed, not real-time, and come from third parties. Do not use them to time a trade.",
              sv: "Kurser och indexnivåer är fördröjda, inte i realtid, och kommer från tredje part. Använd dem inte för att tajma en affär."
            },
            {
              en: "Filing summaries are generated by a language model from public filings. They can be wrong or incomplete. The filing itself is the authority, and we link to it.",
              sv: "Rapportsammanfattningar genereras av en språkmodell utifrån offentliga rapporter. De kan vara felaktiga eller ofullständiga. Rapporten själv är det som gäller, och vi länkar till den."
            },
            {
              en: "Sentiment reflects what people posted in public forums. It measures mood, not truth, and it is not a forecast.",
              sv: "Sentiment speglar vad folk skrivit i offentliga forum. Det mäter stämning, inte sanning, och det är ingen prognos."
            },
            {
              en: "Quant output is a calculation on historical data. It describes what happened, not what will.",
              sv: "Quant-resultat är en beräkning på historiska data. Det beskriver vad som hänt, inte vad som kommer att hända."
            },
            {
              en: "Holdings read from your broker can lag, or be reported by your broker in a way we map imperfectly. Your broker's own statement is the record.",
              sv: "Innehav som läses från din bank kan släpa efter, eller rapporteras av din bank på ett sätt vi mappar ofullständigt. Din banks eget utdrag är det som gäller."
            }
          ]
        },
        {
          kind: "p",
          text: {
            en: "The service is provided as it is. We do not warrant that it will be uninterrupted, error-free, or "
              + "that any figure in it is accurate at the moment you read it.",
            sv: "Tjänsten tillhandahålls i befintligt skick. Vi garanterar inte att den är oavbruten, felfri, eller "
              + "att någon siffra i den är korrekt i det ögonblick du läser den."
          }
        }
      ]
    },
    {
      id: "your-account",
      heading: { en: "Your account", sv: "Ditt konto" },
      blocks: [
        {
          kind: "list",
          items: [
            {
              en: "You must be at least 18 and give a real email address you control.",
              sv: "Du måste vara minst 18 år och ange en verklig e-postadress som du kontrollerar."
            },
            {
              en: "One account per person. Keep your sign-in to yourself; you are responsible for what happens under your account.",
              sv: "Ett konto per person. Håll din inloggning för dig själv; du ansvarar för vad som händer under ditt konto."
            },
            {
              en: "Tell us promptly if you think someone else has got in, and we will end the sessions on that account.",
              sv: "Berätta för oss snabbt om du tror att någon annan har kommit in, och vi avslutar sessionerna på det kontot."
            },
            {
              en: "You can close your account whenever you like, from your account settings. It takes effect immediately.",
              sv: "Du kan stänga ditt konto när du vill, från dina kontoinställningar. Det gäller omedelbart."
            }
          ]
        }
      ]
    },
    {
      id: "acceptable-use",
      heading: { en: "Fair use", sv: "Rimlig användning" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "Use DISU for your own investing. Please do not:",
            sv: "Använd DISU för ditt eget investerande. Vänligen undvik att:"
          }
        },
        {
          kind: "list",
          items: [
            {
              en: "Scrape it, resell its output, or rebuild it as a competing feed — some of the data we show is licensed to us and not to you.",
              sv: "Skrapa den, sälja vidare dess resultat, eller bygga om den till ett konkurrerande flöde — delar av datan vi visar är licensierad till oss, inte till dig."
            },
            {
              en: "Try to reach another user's data, or probe for a way to. If you find one, tell us instead — we would much rather hear from you.",
              sv: "Försöka nå en annan användares data, eller leta efter ett sätt att göra det. Om du hittar ett, berätta för oss i stället — vi vill mycket hellre höra från dig."
            },
            {
              en: "Automate the product at a volume that degrades it for other people.",
              sv: "Automatisera produkten i en volym som försämrar den för andra."
            },
            {
              en: "Post anything on the public feature board that is unlawful, abusive, or someone else's personal data.",
              sv: "Publicera något på den öppna förslagstavlan som är olagligt, kränkande, eller någon annans personuppgifter."
            }
          ]
        }
      ]
    },
    {
      id: "your-content",
      heading: { en: "What you post", sv: "Vad du publicerar" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "Feature requests and comments you post are public, and stay yours. You give us permission to show, "
              + "translate and quote them in the product and in release notes, so we can act on them in the open.",
            sv: "Förslag och kommentarer du publicerar är offentliga och förblir dina. Du ger oss rätt att visa, "
              + "översätta och citera dem i produkten och i versionsnyheter, så att vi kan agera på dem öppet."
          }
        },
        {
          kind: "p",
          text: {
            en: "If you delete your account, those posts stay up with your name removed — other people are replying "
              + "in those threads. We can remove a post that breaks the rules above.",
            sv: "Om du raderar ditt konto blir de inläggen kvar med ditt namn borttaget — andra svarar i de trådarna. "
              + "Vi kan ta bort ett inlägg som bryter mot reglerna ovan."
          }
        }
      ]
    },
    {
      id: "availability",
      heading: { en: "Changes and availability", sv: "Ändringar och tillgänglighet" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "DISU is under active development. Features will change, and some will be removed. We will not remove "
              + "your ability to export your own data.",
            sv: "DISU utvecklas aktivt. Funktioner kommer att ändras, och några tas bort. Vi kommer inte att ta bort "
              + "din möjlighet att exportera dina egna data."
          }
        },
        {
          kind: "p",
          text: {
            en: "We can suspend or close an account that breaks these terms, or that puts other users or the service "
              + "at risk. Where we reasonably can, we will tell you why first.",
            sv: "Vi kan stänga av eller avsluta ett konto som bryter mot dessa villkor, eller som utsätter andra "
              + "användare eller tjänsten för risk. Där vi rimligen kan gör vi det efter att ha berättat varför."
          }
        }
      ]
    },
    {
      id: "liability",
      heading: { en: "Liability", sv: "Ansvar" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "To the extent the law allows, we are not liable for investment losses, for decisions you make using "
              + "DISU, for data a third party gave us wrongly, or for indirect or consequential loss. Nothing here "
              + "limits liability that cannot be limited — including for our own gross negligence or intent, or your "
              + "rights as a consumer under Swedish and EU law.",
            sv: "I den utsträckning lagen tillåter ansvarar vi inte för investeringsförluster, för beslut du fattar "
              + "med hjälp av DISU, för data som en tredje part lämnat oss felaktigt, eller för indirekt förlust eller "
              + "följdskada. Inget här begränsar ansvar som inte får begränsas — inklusive för vår egen grova "
              + "vårdslöshet eller uppsåt, eller dina rättigheter som konsument enligt svensk rätt och EU-rätt."
          }
        }
      ]
    },
    {
      id: "law",
      heading: { en: "Governing law", sv: "Tillämplig lag" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "Swedish law applies, and Swedish courts have jurisdiction. If you are a consumer, this does not take "
              + "away the protection of the law where you live.",
            sv: "Svensk lag gäller, och svenska domstolar är behöriga. Om du är konsument tar detta inte bort skyddet "
              + "i lagen där du bor."
          }
        }
      ]
    },
    {
      id: "changes",
      heading: { en: "Changes to these terms", sv: "Ändringar i dessa villkor" },
      blocks: [
        {
          kind: "p",
          text: {
            en: `Last updated ${LEGAL_DOCUMENTS_UPDATED}. We will tell you in the product before a material change `
              + "takes effect. Continuing to use DISU after that means you accept the new version.",
            sv: `Senast uppdaterad ${LEGAL_DOCUMENTS_UPDATED}. Vi berättar i produkten innan en väsentlig ändring `
              + "börjar gälla. Att fortsätta använda DISU efter det innebär att du godtar den nya versionen."
          }
        },
        factBlock(CONTROLLER.supportEmail, { en: "Contact address for questions about these terms", sv: "Kontaktadress för frågor om dessa villkor" })
      ]
    }
  ]
};
