import type { ReleaseNoteLocale, ReleaseNoteTranslation } from "@/app/lib/release-notes/store";

type TranslationResponse = {
  title: string;
  bodyMarkdown: string;
};

function getProviderConfig(): { url: string; key: string; model: string } | null {
  const groqKey = (process.env.GROQ_API_KEY ?? "").trim();
  if (groqKey) {
    return {
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: groqKey,
      model: process.env.RELEASE_NOTES_TRANSLATION_MODEL?.trim() || "llama-3.1-8b-instant"
    };
  }

  const openAiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (openAiKey) {
    return {
      url: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "") + "/v1/chat/completions",
      key: openAiKey,
      model: process.env.RELEASE_NOTES_TRANSLATION_MODEL?.trim() || "gpt-4o-mini"
    };
  }

  return null;
}

function normalizeLocale(locale: unknown): ReleaseNoteLocale {
  return locale === "sv" ? "sv" : "en";
}

function targetLocale(source: ReleaseNoteLocale): ReleaseNoteLocale {
  return source === "sv" ? "en" : "sv";
}

async function translateWithProvider(input: {
  sourceLocale: ReleaseNoteLocale;
  title: string;
  bodyMarkdown: string;
}): Promise<TranslationResponse | null> {
  const provider = getProviderConfig();
  if (!provider) {
    return null;
  }

  const target = targetLocale(input.sourceLocale);
  const sourceLabel = input.sourceLocale === "sv" ? "Swedish" : "English";
  const targetLabel = target === "sv" ? "Swedish" : "English";

  const systemPrompt = [
    "You are a precise software release notes translator.",
    "Translate title and markdown body from source language to target language.",
    "Preserve markdown structure and technical terms.",
    "Output valid JSON only with keys: title, bodyMarkdown.",
    "No explanations."
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      sourceLanguage: sourceLabel,
      targetLanguage: targetLabel,
      title: input.title,
      bodyMarkdown: input.bodyMarkdown
    },
    null,
    2
  );

  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    return null;
  }

  const json = (await response.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string } }> }
    | null;
  const content = json?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as { title?: unknown; bodyMarkdown?: unknown };
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const bodyMarkdown = typeof parsed.bodyMarkdown === "string" ? parsed.bodyMarkdown.trim() : "";
    if (!title || !bodyMarkdown) {
      return null;
    }
    return { title, bodyMarkdown };
  } catch {
    return null;
  }
}

export async function buildLocalizedReleaseNoteTranslations(input: {
  sourceLocale: unknown;
  title: string;
  bodyMarkdown: string;
}): Promise<ReleaseNoteTranslation[]> {
  const locale = normalizeLocale(input.sourceLocale);
  const title = input.title.trim();
  const bodyMarkdown = input.bodyMarkdown.trim();

  if (!title) {
    throw new Error("Missing release note title.");
  }
  if (!bodyMarkdown) {
    throw new Error("Missing release note body.");
  }

  const translated = await translateWithProvider({ sourceLocale: locale, title, bodyMarkdown });
  const otherLocale = targetLocale(locale);

  const primary: ReleaseNoteTranslation = {
    locale,
    title,
    bodyMarkdown
  };

  const secondary: ReleaseNoteTranslation = {
    locale: otherLocale,
    title: translated?.title ?? title,
    bodyMarkdown: translated?.bodyMarkdown ?? bodyMarkdown
  };

  return locale === "en" ? [primary, secondary] : [secondary, primary];
}
