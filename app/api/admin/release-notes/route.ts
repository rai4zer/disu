import { NextRequest, NextResponse } from "next/server";
import { isAdminUser } from "@/app/lib/admin/access";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { recordEvent } from "@/app/lib/db/events";
import {
  createReleaseNote,
  listAllReleaseNotes,
  type ReleaseNoteLocale,
  type ReleaseNoteTranslation,
  type ReleaseNoteStatus
} from "@/app/lib/release-notes/store";
import { buildLocalizedReleaseNoteTranslations } from "@/app/lib/release-notes/translate";

function parseStatus(input: unknown): ReleaseNoteStatus {
  return input === "published" ? "published" : "draft";
}

function parseTranslations(input: unknown): Array<{ locale: ReleaseNoteLocale; title: string; bodyMarkdown: string }> {
  if (!Array.isArray(input)) {
    throw new Error("translations must be an array.");
  }

  return input.map((row) => {
    const item = typeof row === "object" && row !== null ? (row as Record<string, unknown>) : {};
    const locale = item.locale === "sv" ? "sv" : "en";
    const title = typeof item.title === "string" ? item.title : "";
    const bodyMarkdown = typeof item.bodyMarkdown === "string" ? item.bodyMarkdown : "";
    return { locale, title, bodyMarkdown };
  });
}

async function resolveTranslations(body: Record<string, unknown>): Promise<ReleaseNoteTranslation[]> {
  if (Array.isArray(body.translations)) {
    return parseTranslations(body.translations);
  }

  const sourceLocale = body.sourceLocale;
  const title = typeof body.title === "string" ? body.title : "";
  const bodyMarkdown = typeof body.bodyMarkdown === "string" ? body.bodyMarkdown : "";
  return buildLocalizedReleaseNoteTranslations({ sourceLocale, title, bodyMarkdown });
}

export async function GET(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session || !(await isAdminUser(session.userId))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const releaseNotes = await listAllReleaseNotes();
  return NextResponse.json({ ok: true, releaseNotes });
}

export async function POST(request: NextRequest) {
  const session = await getAuthenticatedSession(request);
  if (!session || !(await isAdminUser(session.userId))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const slug = typeof body.slug === "string" ? body.slug : "";

  try {
    const releaseNote = await createReleaseNote({
      slug,
      status: parseStatus(body.status),
      createdBy: session.userId,
      translations: await resolveTranslations(body)
    });

    await recordEvent({
      userId: session.userId,
      action: "release_note_create",
      status: "success",
      metadata: { releaseNoteId: releaseNote.id, slug: releaseNote.slug, releaseNoteStatus: releaseNote.status }
    });

    if (releaseNote.status === "published") {
      await recordEvent({
        userId: session.userId,
        action: "release_note_publish",
        status: "success",
        metadata: { releaseNoteId: releaseNote.id, slug: releaseNote.slug }
      });
    }

    return NextResponse.json({ ok: true, releaseNote }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create release note.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
