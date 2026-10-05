import type { AppLanguage } from "@/app/i18n/language";

export const uiCopy = {
  en: {
    nav: {
      dashboard: "Dashboard",
      portfolio: "Portfolio",
      sentiment: "Sentiment",
      quant: "Quant",
      primers: "Primers",
      profile: "My Profile",
      mainNavigation: "Main navigation"
    },
    market: {
      ariaLabel: "Market overview",
      signIn: "Sign in"
    },
    languageToggle: {
      label: "Switch language",
      shortLabel: "EN"
    },
    themeToggle: {
      label: "Theme",
      hint: "Applies to this browser. Takes effect immediately.",
      system: "System",
      light: "Light",
      dark: "Dark"
    },
    dashboard: {
      title: "Dashboard",
      subtitle: "Essential overview. Fast path into each workflow."
    },
    auth: {
      signIn: "Sign in",
      createAccount: "Create account",
      signInTitle: "Sign in to DISU",
      createTitle: "Create your DISU account",
      waiting: "Please wait..."
    },
    errorBoundary: {
      title: "Something went wrong on this page",
      body: "The page stopped working before it finished loading. The problem has been reported — trying again often clears it.",
      bodyRoot: "The app could not start. The problem has been reported. Reloading usually helps.",
      retry: "Try again",
      home: "Go to start page",
      reference: "Reference:"
    },
    topNav: {
      overview: "Overview",
      marketDesk: "Market desk",
      learnMore: "Learn more",
      help: "Help",
      education: {
        foundations: "Foundations",
        analysis: "Analysis",
        execution: "Execution",
        hub: "Education hub",
        tradingBasics: "Trading basics",
        technicalAnalysis: "Technical analysis",
        riskManagement: "Risk management",
        quantPlaybooks: "Quant playbooks"
      },
      helpMenu: {
        hub: "Help center",
        docs: "Docs",
        faq: "FAQ",
        releaseNotes: "Release notes"
      }
    }
  },
  sv: {
    nav: {
      dashboard: "Översikt",
      portfolio: "Portfölj",
      sentiment: "Sentiment",
      quant: "Quant",
      primers: "Primers",
      profile: "Min profil",
      mainNavigation: "Huvudnavigering"
    },
    market: {
      ariaLabel: "Marknadsöversikt",
      signIn: "Logga in"
    },
    languageToggle: {
      label: "Byt språk",
      shortLabel: "SV"
    },
    themeToggle: {
      label: "Tema",
      hint: "Gäller den här webbläsaren. Ändras direkt.",
      system: "System",
      light: "Ljust",
      dark: "Mörkt"
    },
    dashboard: {
      title: "Översikt",
      subtitle: "Snabb översikt. Rak väg in i varje arbetsflöde."
    },
    auth: {
      signIn: "Logga in",
      createAccount: "Skapa konto",
      signInTitle: "Logga in i DISU",
      createTitle: "Skapa ditt DISU-konto",
      waiting: "Vänta..."
    },
    errorBoundary: {
      title: "Något gick fel på den här sidan",
      body: "Sidan slutade fungera innan den laddats klart. Felet är rapporterat — det brukar hjälpa att försöka igen.",
      bodyRoot: "Appen kunde inte starta. Felet är rapporterat. Ladda om sidan så brukar det lösa sig.",
      retry: "Försök igen",
      home: "Till startsidan",
      reference: "Referens:"
    },
    topNav: {
      overview: "Översikt",
      marketDesk: "Marknadsdesk",
      learnMore: "Lär dig mer",
      help: "Hjälp",
      education: {
        foundations: "Grunder",
        analysis: "Analys",
        execution: "Exekvering",
        hub: "Kunskapsnav",
        tradingBasics: "Tradinggrunder",
        technicalAnalysis: "Teknisk analys",
        riskManagement: "Riskhantering",
        quantPlaybooks: "Quant-playbooks"
      },
      helpMenu: {
        hub: "Hjälpcenter",
        docs: "Dokumentation",
        faq: "Vanliga frågor",
        releaseNotes: "Versionsnyheter"
      }
    }
  }
} as const;

export function getUiCopy(language: AppLanguage) {
  return uiCopy[language];
}
