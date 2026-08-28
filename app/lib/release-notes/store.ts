import { randomUUID } from "node:crypto";
import { eq, supabaseRequest } from "@/app/lib/db/supabase";

export type ReleaseNoteStatus = "draft" | "published";
export type ReleaseNoteLocale = "en" | "sv";

export type ReleaseNoteTranslation = {
  locale: ReleaseNoteLocale;
  title: string;
  bodyMarkdown: string;
};

export type ReleaseNote = {
  id: string;
  slug: string;
  status: ReleaseNoteStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  translations: ReleaseNoteTranslation[];
};

type ReleaseNoteRow = {
  id: string;
  slug: string;
  status: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type ReleaseNoteTranslationRow = {
  id: string;
  release_note_id: string;
  locale: string;
  title: string;
  body_markdown: string;
  created_at: string;
  updated_at: string;
};

function toLocale(value: string): ReleaseNoteLocale {
  return value === "sv" ? "sv" : "en";
}

function normalizeTranslation(input: ReleaseNoteTranslation): ReleaseNoteTranslation {
  const title = input.title.trim();
  const bodyMarkdown = input.bodyMarkdown.trim();
  if (!title) {
    throw new Error(`Missing title for locale ${input.locale}.`);
  }
  if (!bodyMarkdown) {
    throw new Error(`Missing bodyMarkdown for locale ${input.locale}.`);
  }
  return {
    locale: input.locale,
    title,
    bodyMarkdown
  };
}

function toReleaseNote(row: ReleaseNoteRow, translations: ReleaseNoteTranslationRow[]): ReleaseNote {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status === "published" ? "published" : "draft",
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    translations: translations
      .filter((item) => item.release_note_id === row.id)
      .map((item) => ({
        locale: toLocale(item.locale),
        title: item.title,
        bodyMarkdown: item.body_markdown
      }))
      .sort((a, b) => a.locale.localeCompare(b.locale))
  };
}

export async function listPublishedReleaseNotes(locale: ReleaseNoteLocale): Promise<Array<ReleaseNoteTranslation & { id: string; slug: string; publishedAt: string | null }>> {
  const rows = await supabaseRequest<ReleaseNoteRow[]>("release_notes", {
    query: {
      status: eq("published"),
      select: "id,slug,status,published_at,created_at,updated_at",
      order: "published_at.desc"
    }
  });

  if (rows.length === 0) return [];

  const translationRows = await supabaseRequest<ReleaseNoteTranslationRow[]>("release_note_translations", {
    query: {
      locale: eq(locale),
      select: "id,release_note_id,locale,title,body_markdown,created_at,updated_at"
    }
  });

  const translationByReleaseId = new Map<string, ReleaseNoteTranslationRow>();
  for (const translation of translationRows) {
    translationByReleaseId.set(translation.release_note_id, translation);
  }

  return rows
    .map((row) => {
      const translation = translationByReleaseId.get(row.id);
      if (!translation) return null;
      return {
        id: row.id,
        slug: row.slug,
        locale,
        title: translation.title,
        bodyMarkdown: translation.body_markdown,
        publishedAt: row.published_at
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

export async function listAllReleaseNotes(): Promise<ReleaseNote[]> {
  const rows = await supabaseRequest<ReleaseNoteRow[]>("release_notes", {
    query: {
      select: "id,slug,status,published_at,created_at,updated_at",
      order: "created_at.desc"
    }
  });

  if (rows.length === 0) {
    return [];
  }

  const ids = rows.map((row) => row.id);
  const translations = await Promise.all(
    ids.map(async (id) => {
      const items = await supabaseRequest<ReleaseNoteTranslationRow[]>("release_note_translations", {
        query: {
          release_note_id: eq(id),
          select: "id,release_note_id,locale,title,body_markdown,created_at,updated_at",
          order: "locale.asc"
        }
      });
      return items;
    })
  );

  const flatTranslations = translations.flat();
  return rows.map((row) => toReleaseNote(row, flatTranslations));
}

export async function createReleaseNote(input: {
  slug: string;
  status: ReleaseNoteStatus;
  createdBy: string;
  translations: ReleaseNoteTranslation[];
}): Promise<ReleaseNote> {
  const slug = input.slug.trim().toLowerCase();
  if (!slug || !/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    throw new Error("Invalid slug.");
  }
  const translations = dedupeTranslations(input.translations.map(normalizeTranslation));
  const now = new Date().toISOString();
  const id = `rln_${randomUUID().replace(/-/g, "").slice(0, 14)}`;

  const inserted = await supabaseRequest<ReleaseNoteRow[]>("release_notes", {
    method: "POST",
    body: [
      {
        id,
        slug,
        status: input.status,
        published_at: input.status === "published" ? now : null,
        created_by: input.createdBy,
        updated_by: input.createdBy,
        created_at: now,
        updated_at: now
      }
    ]
  });

  await supabaseRequest<ReleaseNoteTranslationRow[]>("release_note_translations", {
    method: "POST",
    body: translations.map((translation) => ({
      id: `rlt_${randomUUID().replace(/-/g, "").slice(0, 14)}`,
      release_note_id: id,
      locale: translation.locale,
      title: translation.title,
      body_markdown: translation.bodyMarkdown,
      created_at: now,
      updated_at: now
    }))
  });

  return getReleaseNoteById(inserted[0].id);
}

export async function updateReleaseNote(input: {
  id: string;
  status?: ReleaseNoteStatus;
  updatedBy: string;
  translations?: ReleaseNoteTranslation[];
}): Promise<ReleaseNote> {
  const now = new Date().toISOString();
  const existingRows = await supabaseRequest<ReleaseNoteRow[]>("release_notes", {
    query: {
      id: eq(input.id),
      select: "id,slug,status,published_at,created_at,updated_at",
      limit: "1"
    }
  });
  const existing = existingRows[0];
  if (!existing) {
    throw new Error("Release note not found.");
  }

  const patch: Record<string, unknown> = {
    updated_by: input.updatedBy,
    updated_at: now
  };

  if (input.status) {
    patch.status = input.status;
    patch.published_at = input.status === "published" ? now : null;
  } else if (existing.status === "published") {
    // Published notes are auto-republished when edited.
    patch.published_at = now;
  }

  await supabaseRequest<ReleaseNoteRow[]>("release_notes", {
    method: "PATCH",
    query: {
      id: eq(input.id),
      select: "id,slug,status,published_at,created_at,updated_at"
    },
    body: patch
  });

  if (input.translations && input.translations.length > 0) {
    const translations = dedupeTranslations(input.translations.map(normalizeTranslation));
    for (const translation of translations) {
      const existing = await supabaseRequest<ReleaseNoteTranslationRow[]>("release_note_translations", {
        query: {
          release_note_id: eq(input.id),
          locale: eq(translation.locale),
          select: "id,release_note_id,locale,title,body_markdown,created_at,updated_at",
          limit: "1"
        }
      });

      if (existing[0]) {
        await supabaseRequest<ReleaseNoteTranslationRow[]>("release_note_translations", {
          method: "PATCH",
          query: {
            id: eq(existing[0].id),
            select: "id,release_note_id,locale,title,body_markdown,created_at,updated_at"
          },
          body: {
            title: translation.title,
            body_markdown: translation.bodyMarkdown,
            updated_at: now
          }
        });
      } else {
        await supabaseRequest<ReleaseNoteTranslationRow[]>("release_note_translations", {
          method: "POST",
          body: [
            {
              id: `rlt_${randomUUID().replace(/-/g, "").slice(0, 14)}`,
              release_note_id: input.id,
              locale: translation.locale,
              title: translation.title,
              body_markdown: translation.bodyMarkdown,
              created_at: now,
              updated_at: now
            }
          ]
        });
      }
    }
  }

  return getReleaseNoteById(input.id);
}

export async function getReleaseNoteById(id: string): Promise<ReleaseNote> {
  const rows = await supabaseRequest<ReleaseNoteRow[]>("release_notes", {
    query: {
      id: eq(id),
      select: "id,slug,status,published_at,created_at,updated_at",
      limit: "1"
    }
  });

  if (!rows[0]) {
    throw new Error("Release note not found.");
  }

  const translations = await supabaseRequest<ReleaseNoteTranslationRow[]>("release_note_translations", {
    query: {
      release_note_id: eq(id),
      select: "id,release_note_id,locale,title,body_markdown,created_at,updated_at",
      order: "locale.asc"
    }
  });

  return toReleaseNote(rows[0], translations);
}

function dedupeTranslations(items: ReleaseNoteTranslation[]): ReleaseNoteTranslation[] {
  const byLocale = new Map<ReleaseNoteLocale, ReleaseNoteTranslation>();
  for (const item of items) {
    byLocale.set(item.locale, item);
  }
  if (!byLocale.get("en") || !byLocale.get("sv")) {
    throw new Error("Both en and sv translations are required.");
  }
  return [byLocale.get("en")!, byLocale.get("sv")!];
}
