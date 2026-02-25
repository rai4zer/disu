import type { AppLanguage } from "@/app/i18n/language";

export const uiCopy = {
  en: {
    nav: {
      dashboard: "Dashboard",
      portfolio: "Portfolio",
      sentiment: "Sentiment",
      quant: "Quant",
      primers: "Primers",
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
      switchToLight: "Switch to light mode",
      switchToDark: "Switch to dark mode"
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
      switchToLight: "Byt till ljust läge",
      switchToDark: "Byt till mörkt läge"
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
