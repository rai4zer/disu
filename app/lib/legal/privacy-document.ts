/**
 * The privacy policy.
 *
 * The authoritative list of *where* personal data lives is
 * `app/lib/account/personal-data.ts`, and the build fails if a table is missing
 * from it. This document is the plain-language description of the same thing:
 * when you add a table there, come back here and check that a category below
 * still covers it honestly.
 *
 * Written to be read. GDPR does not reward density — Art. 12(1) requires
 * "concise, transparent, intelligible" — and a policy nobody finishes is a
 * policy nobody consented to.
 */

import { CONTROLLER, LEGAL_DOCUMENTS_UPDATED, SUPERVISORY_AUTHORITY } from "./controller.ts";
import { factBlock, processorTable, retentionTable, sourceTable, storageTable, type LegalDocument } from "./document.ts";

export const PRIVACY_DOCUMENT: LegalDocument = {
  slug: "privacy",
  title: { en: "Privacy policy", sv: "Integritetspolicy" },
  summary: {
    en: "What DISU collects, why, who else sees it, and how to get it back or get rid of it.",
    sv: "Vad DISU samlar in, varför, vem mer som ser det, och hur du får ut det eller blir av med det."
  },
  sections: [
    {
      id: "short-version",
      heading: { en: "The short version", sv: "Kortversionen" },
      blocks: [
        {
          kind: "list",
          items: [
            {
              en: "We hold your email address and your holdings, because that is what the product is for.",
              sv: "Vi lagrar din e-postadress och dina innehav, eftersom det är vad produkten är till för."
            },
            {
              en: "We do not sell your data. We do run advertising and analytics — but only if you agree, and only ever about which pages you looked at, never about what you hold.",
              sv: "Vi säljer inte dina data. Vi använder annonsering och analys — men bara om du godkänner det, och alltid bara om vilka sidor du tittat på, aldrig om vad du äger."
            },
            {
              en: "Nothing optional is loaded before you choose, saying no takes as many clicks as saying yes, and you can change your mind from the footer of any page.",
              sv: "Inget valfritt laddas innan du väljer, att säga nej tar lika många klick som att säga ja, och du kan ändra dig från sidfoten på vilken sida som helst."
            },
            {
              en: "Your portfolio is never sent to a language model. Filings are; your holdings are not.",
              sv: "Din portfölj skickas aldrig till en språkmodell. Rapporter skickas; dina innehav gör det inte."
            },
            {
              en: "You can download everything we hold, and delete your account, from inside the product — no email required, no waiting.",
              sv: "Du kan ladda ner allt vi lagrar, och radera ditt konto, inifrån produkten — ingen e-post krävs, ingen väntetid."
            },
            {
              en: "We never see your bank login. Your broker connection is authenticated at your bank, through a regulated provider.",
              sv: "Vi ser aldrig din bankinloggning. Din bankkoppling autentiseras hos din bank, via en reglerad leverantör."
            }
          ]
        }
      ]
    },
    {
      id: "controller",
      heading: { en: "Who is responsible", sv: "Vem är ansvarig" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "DISU is the data controller for the personal data described here — we decide what is collected and why.",
            sv: "DISU är personuppgiftsansvarig för de personuppgifter som beskrivs här — vi bestämmer vad som samlas in och varför."
          }
        },
        factBlock(CONTROLLER.legalName, { en: "Registered company name", sv: "Registrerat företagsnamn" }),
        factBlock(CONTROLLER.registrationNumber, { en: "Company registration number", sv: "Organisationsnummer" }),
        factBlock(CONTROLLER.address, { en: "Registered address", sv: "Registrerad adress" }),
        factBlock(CONTROLLER.privacyEmail, { en: "Privacy contact address", sv: "Kontaktadress för integritetsfrågor" }),
        {
          kind: "p",
          text: {
            en: `You have the right to complain to a supervisory authority. In Sweden that is ${SUPERVISORY_AUTHORITY.name}, ${SUPERVISORY_AUTHORITY.url}.`,
            sv: `Du har rätt att lämna in klagomål till en tillsynsmyndighet. I Sverige är det ${SUPERVISORY_AUTHORITY.name}, ${SUPERVISORY_AUTHORITY.url}.`
          }
        }
      ]
    },
    {
      id: "what-we-collect",
      heading: { en: "What we collect", sv: "Vad vi samlar in" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "Only what a working portfolio tool needs. There is no third category of data collected "
              + "'for product improvement' that turns out to be everything you clicked. If you agree to "
              + "analytics we also count nine named steps — see below — and that list is the whole of it.",
            sv: "Bara vad ett fungerande portföljverktyg behöver. Det finns ingen tredje kategori av data som samlas in "
              + "”för produktutveckling” och som visar sig vara allt du klickat på. Om du godkänner analys räknar vi "
              + "också nio namngivna steg — se nedan — och den listan är allt."
          }
        },
        {
          kind: "list",
          items: [
            {
              en: "Account: your email address, and — if you sign in with Google — the account identifier Google gives us. If you use a password, we store a one-way hash of it and never the password itself.",
              sv: "Konto: din e-postadress och — om du loggar in med Google — den kontoidentifierare Google ger oss. Om du använder ett lösenord lagrar vi en envägshash av det, aldrig lösenordet självt."
            },
            {
              en: "Holdings: the positions you add by hand, and the positions we read from a broker you connect.",
              sv: "Innehav: de positioner du lägger in för hand, och de positioner vi läser från en bank du kopplar."
            },
            {
              en: "Broker connections: which broker you linked, which accounts sit behind it, and an encrypted access token. The token is never shown to you and never included in an export.",
              sv: "Bankkopplingar: vilken bank du kopplade, vilka konton som finns bakom den, och en krypterad åtkomsttoken. Token visas aldrig för dig och ingår aldrig i en export."
            },
            {
              en: "Runs you request: which quant analysis or filing primer you asked for, and what it produced.",
              sv: "Körningar du begär: vilken quant-analys eller rapportprimer du bad om, och vad den producerade."
            },
            {
              en: "Sessions: when your account was signed in to, so you can see it and we can cut off a session that should not be running.",
              sv: "Sessioner: när ditt konto varit inloggat, så att du kan se det och vi kan avsluta en session som inte borde vara aktiv."
            },
            {
              en: "An audit log of your own actions — what you did, not what you read.",
              sv: "En revisionslogg över dina egna handlingar — vad du gjorde, inte vad du läste."
            },
            {
              en: "If — and only if — you agree to analytics: a count of nine named steps, such as arriving on a page, opening the sign-up form, adding a holding. Held by us, not shared with anyone, and deleted after 180 days.",
              sv: "Om — och endast om — du godkänner analys: en räkning av nio namngivna steg, som att komma till en sida, öppna registreringsformuläret, lägga till ett innehav. Lagras av oss, delas inte med någon, och raderas efter 180 dagar."
            },
            {
              en: "Anything you write in public: posts, comments and votes on the feature board.",
              sv: "Allt du skriver offentligt: inlägg, kommentarer och röster på förslagstavlan."
            }
          ]
        }
      ]
    },
    {
      id: "legal-basis",
      heading: { en: "Why we are allowed to hold it", sv: "Varför vi får lagra det" },
      blocks: [
        {
          kind: "list",
          items: [
            {
              en: "Performance of a contract (GDPR Art. 6(1)(b)) — your account, your holdings, your broker connection and the runs you request. Without these there is no service to provide.",
              sv: "Fullgörande av avtal (GDPR art. 6.1 b) — ditt konto, dina innehav, din bankkoppling och de körningar du begär. Utan dessa finns ingen tjänst att leverera."
            },
            {
              en: "Legitimate interests (Art. 6(1)(f)) — keeping the service secure: rate limiting, the session record, and the audit log. The interest is a service that is not trivially broken into; the balance is that these hold as little as possible and expire.",
              sv: "Berättigat intresse (art. 6.1 f) — att hålla tjänsten säker: hastighetsbegränsning, sessionsregistret och revisionsloggen. Intresset är en tjänst som inte enkelt kan brytas in i; avvägningen är att dessa lagrar så lite som möjligt och går ut."
            },
            {
              en: "Consent (Art. 6(1)(a)) — analytics and advertising, and the cookies that make them work. This is the only basis we use for them: we do not claim a legitimate interest in tracking you, because that argument does not survive contact with cross-site advertising. No consent means no tags, and you can withdraw at any time without losing anything.",
              sv: "Samtycke (art. 6.1 a) — analys och annonsering, och de cookies som får dem att fungera. Det är den enda grund vi använder för dem: vi hävdar inget berättigat intresse av att spåra dig, eftersom det argumentet inte håller mot annonsering över flera sajter. Inget samtycke betyder inga taggar, och du kan återkalla när som helst utan att förlora något."
            }
          ]
        }
      ]
    },
    {
      id: "how-long",
      heading: { en: "How long we keep it", sv: "Hur länge vi sparar det" },
      blocks: [retentionTable()]
    },
    {
      id: "sub-processors",
      heading: { en: "Who else handles your data", sv: "Vilka andra hanterar dina data" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "These companies process personal data on our behalf, under contract, and only for what is listed.",
            sv: "Dessa företag behandlar personuppgifter för vår räkning, enligt avtal, och endast för det som listas."
          }
        },
        processorTable(),
        {
          kind: "callout",
          text: {
            en: "Your holdings are never sent to a language model. A filing primer sends a ticker and the text of a public filing, and nothing else — not your portfolio, not your email address, not your account identifier. If we ever wanted to change that, we would have to ask you first, separately and explicitly.",
            sv: "Dina innehav skickas aldrig till en språkmodell. En rapportprimer skickar en ticker och texten i en offentlig rapport, inget annat — inte din portfölj, inte din e-postadress, inte din kontoidentifierare. Om vi någonsin ville ändra det skulle vi behöva fråga dig först, separat och uttryckligen."
          }
        }
      ]
    },
    {
      id: "analytics-and-advertising",
      heading: { en: "Analytics and advertising", sv: "Analys och annonsering" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "If you agree to it, DISU loads measurement and advertising tags from Google, Meta and LinkedIn. "
              + "It is worth being plain about what that means, because it is the part of this policy where your "
              + "data leaves our control.",
            sv: "Om du godkänner det laddar DISU mät- och annonstaggar från Google, Meta och LinkedIn. "
              + "Det är värt att vara tydlig med vad det innebär, eftersom det är den del av denna policy där dina "
              + "data lämnar vår kontroll."
          }
        },
        {
          kind: "list",
          items: [
            {
              en: "What they get: which DISU pages you viewed, roughly where you are, your device and browser, and an identifier that ties those visits together. For the advertising tags, that identifier can be joined to the profile the platform already holds about you — including your Facebook, Instagram or LinkedIn account if you have one.",
              sv: "Vad de får: vilka DISU-sidor du besökt, ungefär var du är, din enhet och webbläsare, och en identifierare som binder besöken samman. För annonstaggarna kan den identifieraren kopplas till den profil plattformen redan har om dig — inklusive ditt Facebook-, Instagram- eller LinkedIn-konto om du har ett."
            },
            {
              en: "What they never get: your holdings, your portfolio value, your broker, your email address, or your DISU account identifier. The tags run on the page and are not given any of it.",
              sv: "Vad de aldrig får: dina innehav, ditt portföljvärde, din bank, din e-postadress eller din DISU-kontoidentifierare. Taggarna körs på sidan och får inget av det."
            },
            {
              en: "When: only after you agree, per category. Refuse and the scripts are never fetched at all — not fetched and held back, not fetched.",
              sv: "När: bara efter att du godkänt, per kategori. Neka och skripten hämtas aldrig alls — inte hämtade och tillbakahållna, utan inte hämtade."
            },
            {
              en: "Where: these are all EU entities that transfer to the United States. Analytics and advertising is the reason your data leaves the EU; nothing about your portfolio does.",
              sv: "Var: dessa är alla EU-enheter som överför till USA. Analys och annonsering är anledningen till att dina data lämnar EU; inget om din portfölj gör det."
            },
            {
              en: "Withdrawing: the Cookie settings link in the footer, on every page. We delete the cookies we set and stop loading the scripts immediately.",
              sv: "Att återkalla: länken Cookie-inställningar i sidfoten, på varje sida. Vi raderar de cookies vi satt och slutar ladda skripten omedelbart."
            }
          ]
        },
        {
          kind: "callout",
          text: {
            en: "The line we hold: advertising platforms may learn that you read about investing. They do not learn "
              + "what you own. Those are different disclosures, and only one of them is on the table.",
            sv: "Gränsen vi håller: annonsplattformar kan få veta att du läst om investeringar. De får inte veta "
              + "vad du äger. Det är olika saker att lämna ut, och bara det ena är aktuellt."
          }
        },
        {
          kind: "p",
          text: {
            en: "Under the same agreement, DISU also counts a few steps itself, without any third party involved. "
              + "This is the measurement that tells us whether people who arrive can actually get started — and it is "
              + "the reason the analytics toggle covers more than Google.",
            sv: "Under samma godkännande räknar DISU också några steg själv, utan att någon tredje part är inblandad. "
              + "Det är den mätning som visar oss om de som kommer hit faktiskt kommer igång — och skälet till att "
              + "analysreglaget omfattar mer än Google."
          }
        },
        {
          kind: "list",
          items: [
            {
              en: "What is counted: nine named steps and nothing else — arriving on a page, opening the sign-up form, creating an account, signing in, adding a holding, starting and finishing a broker connection, running a primer, running a quant analysis.",
              sv: "Vad som räknas: nio namngivna steg och inget annat — att komma till en sida, öppna registreringsformuläret, skapa ett konto, logga in, lägga till ett innehav, starta och slutföra en bankkoppling, köra en primer, köra en quant-analys."
            },
            {
              en: "What is stored with each: the step's name, the time, the route you were on with any identifiers stripped out (/portfolio/:id, never the id), and for some steps one short label such as \"manual\" or \"google\". No ticker, no amount, no free text — the shape is fixed in code and anything else is discarded before it is written.",
              sv: "Vad som lagras med varje: stegets namn, tidpunkten, vilken sida du var på med identifierare borttagna (/portfolio/:id, aldrig id-numret), och för vissa steg en kort etikett som ”manual” eller ”google”. Ingen ticker, inget belopp, ingen fritext — formen är låst i koden och allt annat kastas innan det skrivs."
            },
            {
              en: "How the steps are linked: before you have an account, by a random value that lives in your browser tab and disappears when you close it. It is never sent to anyone else and cannot follow you to your next visit.",
              sv: "Hur stegen binds samman: innan du har ett konto, av ett slumpvärde som lever i din webbläsarflik och försvinner när du stänger den. Det skickas aldrig till någon annan och kan inte följa dig till nästa besök."
            },
            {
              en: "Who sees it: us. It stays in our own database, in the EU, and is deleted after 180 days — or immediately, along with everything else, if you delete your account.",
              sv: "Vem som ser det: vi. Det stannar i vår egen databas, i EU, och raderas efter 180 dagar — eller omedelbart, tillsammans med allt annat, om du raderar ditt konto."
            },
            {
              en: "If you refuse: nothing is counted and nothing is stored in your browser. Not counted-and-discarded — the request is never made.",
              sv: "Om du nekar: inget räknas och inget lagras i din webbläsare. Inte räknat-och-kastat — förfrågan görs aldrig."
            }
          ]
        }
      ]
    },
    {
      id: "sources",
      heading: { en: "Where the market data comes from", sv: "Var marknadsdatan kommer från" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "We also fetch public data from the sources below. They are listed separately because they are not "
              + "processing your personal data: our server asks them about a symbol, and the request says nothing about who is asking.",
            sv: "Vi hämtar även offentliga data från källorna nedan. De listas separat eftersom de inte "
              + "behandlar dina personuppgifter: vår server frågar dem om en symbol, och förfrågan säger inget om vem som frågar."
          }
        },
        sourceTable()
      ]
    },
    {
      id: "transfers",
      heading: { en: "Data outside the EU", sv: "Data utanför EU" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "Some of the companies above are based in the United States. Where personal data reaches them, the "
              + "transfer relies on the EU–US Data Privacy Framework or on Standard Contractual Clauses, depending on the provider.",
            sv: "Några av företagen ovan är baserade i USA. Där personuppgifter når dem vilar överföringen på "
              + "EU–US Data Privacy Framework eller på standardavtalsklausuler, beroende på leverantör."
          }
        },
        {
          kind: "p",
          text: {
            en: "The market-data and news sources receive no personal data at all, so no transfer mechanism is needed for them.",
            sv: "Marknadsdata- och nyhetskällorna tar inte emot några personuppgifter alls, så ingen överföringsmekanism behövs för dem."
          }
        }
      ]
    },
    {
      id: "your-rights",
      heading: { en: "Your rights, and how to use them today", sv: "Dina rättigheter, och hur du använder dem idag" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "Two of these are built into the product, so you do not have to ask anyone:",
            sv: "Två av dessa är inbyggda i produkten, så du behöver inte fråga någon:"
          }
        },
        {
          kind: "list",
          items: [
            {
              en: "Access and portability (Art. 15, Art. 20) — download a machine-readable copy of everything we hold about you, from your account settings. Credentials are withheld: a password hash and an encrypted broker token are keys to your account, not facts about you. The metadata around them is included, so nothing is hidden.",
              sv: "Tillgång och dataportabilitet (art. 15, art. 20) — ladda ner en maskinläsbar kopia av allt vi lagrar om dig, från dina kontoinställningar. Autentiseringsuppgifter undanhålls: en lösenordshash och en krypterad banktoken är nycklar till ditt konto, inte fakta om dig. Metadatan runt dem ingår, så inget döljs."
            },
            {
              en: "Erasure (Art. 17) — delete your account from your account settings. It cascades: every table that holds your data is walked, and the result is verified afterwards. We ask for your password again first, because a borrowed laptop should not be able to destroy your account.",
              sv: "Radering (art. 17) — radera ditt konto från dina kontoinställningar. Det går hela vägen: varje tabell som lagrar dina data gås igenom, och resultatet verifieras efteråt. Vi ber om ditt lösenord igen först, eftersom en lånad laptop inte ska kunna förstöra ditt konto."
            }
          ]
        },
        {
          kind: "p",
          text: {
            en: "One thing survives erasure, on purpose: posts and comments you left on the public feature board stay, "
              + "with your name removed. Other people are reading and replying in those threads, and deleting your side of "
              + "a conversation rewrites theirs. Your votes carry no content, so they are deleted outright.",
            sv: "En sak överlever radering, med avsikt: inlägg och kommentarer du lämnat på den öppna förslagstavlan blir kvar, "
              + "men utan ditt namn. Andra läser och svarar i de trådarna, och att radera din del av ett samtal skriver om deras. "
              + "Dina röster bär inget innehåll, så de raderas helt."
          }
        },
        {
          kind: "p",
          text: {
            en: "Withdrawing consent (Art. 7(3)) is the third thing built in: the Cookie settings link in the footer "
              + "of every page turns analytics and advertising back off, in one click, for as long as you like. "
              + "Nothing about the product changes when you do.",
            sv: "Att återkalla samtycke (art. 7.3) är den tredje saken som är inbyggd: länken Cookie-inställningar i "
              + "sidfoten på varje sida stänger av analys och annonsering igen, med ett klick, så länge du vill. "
              + "Inget i produkten förändras när du gör det."
          }
        },
        {
          kind: "p",
          text: {
            en: "You also have the right to rectification (Art. 16), to restrict or object to processing (Art. 18, Art. 21), "
              + "and to withdraw consent at any time where we rely on it. Write to the privacy address above and you will hear back within one month.",
            sv: "Du har också rätt till rättelse (art. 16), att begränsa eller invända mot behandling (art. 18, art. 21), "
              + "och att återkalla samtycke när som helst där vi vilar på det. Skriv till integritetsadressen ovan och du får svar inom en månad."
          }
        }
      ]
    },
    {
      id: "cookies",
      heading: { en: "Cookies and browser storage", sv: "Cookies och webbläsarlagring" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "The essential cookies keep you signed in and protect forms; they are used either way, because the "
              + "service does not work without them. Everything else — preferences, analytics, advertising — is off "
              + "until you turn it on, and is listed below so you can see exactly what each answer covers.",
            sv: "De nödvändiga cookies håller dig inloggad och skyddar formulär; de används oavsett, eftersom "
              + "tjänsten inte fungerar utan dem. Allt annat — inställningar, analys, annonsering — är avstängt "
              + "tills du slår på det, och listas nedan så att du kan se exakt vad varje svar omfattar."
          }
        },
        storageTable()
      ]
    },
    {
      id: "security",
      heading: { en: "How it is protected", sv: "Hur det skyddas" },
      blocks: [
        {
          kind: "list",
          items: [
            {
              en: "Broker access tokens are encrypted at rest and are never returned to the browser.",
              sv: "Åtkomsttoken för bank krypteras i vila och skickas aldrig tillbaka till webbläsaren."
            },
            {
              en: "Every request for your data is filtered by your account identifier, and there is an automated test for every such route that proves one account cannot read another's.",
              sv: "Varje förfrågan om dina data filtreras på din kontoidentifierare, och det finns ett automatiskt test för varje sådan väg som bevisar att ett konto inte kan läsa ett annats."
            },
            {
              en: "Sign-in and password-reset attempts are rate limited, per address and per account.",
              sv: "Inloggnings- och återställningsförsök hastighetsbegränsas, per adress och per konto."
            },
            {
              en: "Sessions can be revoked on the server, so signing out actually ends the session rather than just clearing your cookie.",
              sv: "Sessioner kan återkallas på servern, så att logga ut faktiskt avslutar sessionen i stället för att bara rensa din cookie."
            }
          ]
        },
        {
          kind: "p",
          text: {
            en: "If we ever discover a breach that puts you at risk, you will be told — and the supervisory authority within 72 hours, as required.",
            sv: "Om vi någonsin upptäcker en incident som utsätter dig för risk kommer du att informeras — och tillsynsmyndigheten inom 72 timmar, som krävs."
          }
        }
      ]
    },
    {
      id: "children",
      heading: { en: "Age", sv: "Ålder" },
      blocks: [
        {
          kind: "p",
          text: {
            en: "DISU is not intended for anyone under 18, and we do not knowingly create accounts for children.",
            sv: "DISU är inte avsett för någon under 18 år, och vi skapar inte medvetet konton för barn."
          }
        }
      ]
    },
    {
      id: "changes",
      heading: { en: "Changes to this policy", sv: "Ändringar i denna policy" },
      blocks: [
        {
          kind: "p",
          text: {
            en: `This policy was last updated on ${LEGAL_DOCUMENTS_UPDATED}. If we change something that affects you `
              + "materially, we will tell you in the product before it takes effect, not after.",
            sv: `Denna policy uppdaterades senast ${LEGAL_DOCUMENTS_UPDATED}. Om vi ändrar något som påverkar dig `
              + "väsentligt berättar vi det i produkten innan det börjar gälla, inte efteråt."
          }
        }
      ]
    }
  ]
};
