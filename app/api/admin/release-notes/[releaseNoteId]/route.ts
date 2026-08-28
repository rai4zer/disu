import { NextRequest, NextResponse } from "next/server";
import { isAdminUser } from "@/app/lib/admin/access";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { recordEvent } from "@/app/lib/db/events";
import {
  type ReleaseNoteLocale,
  type ReleaseNoteStatus,
  type ReleaseNoteTranslation,
  updateReleaseNote
} from "@/app/lib/release-notes/store";
import { buildLocalizedReleaseNoteTranslations } from "@/app/lib/release-notes/translate";

function parseStatus(input: unknown): ReleaseNoteStatus | undefined {
  if (input === undefined) return undefined;
  return input === "published" ? "published" : "draft";
}

function parseTranslations(input: unknown): Array<{ locale: ReleaseNoteLocale; title: string; bodyMarkdown: string }> | undefined {
  if (input === undefined) return undefined;
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

async function resolveTranslations(body: Record<string, unknown>): Promise<ReleaseNoteTranslation[] | undefined> {
  if (body.translations !== undefined) {
    return parseTranslations(body.translations);
  }

  const hasSingleSourceFields =
    body.sourceLocale !== undefined || body.title !== undefined || body.bodyMarkdown !== undefined;
  if (!hasSingleSourceFields) {
    return undefined;
  }

  const title = typeof body.title === "string" ? body.title : "";
  const bodyMarkdown = typeof body.bodyMarkdown === "string" ? body.bodyMarkdown : "";
  return buildLocalizedReleaseNoteTranslations({
    sourceLocale: body.sourceLocale,
    title,
    bodyMarkdown
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: { releaseNoteId: string } }
) {
  const session = await getAuthenticatedSession(request);
  if (!session || !(await isAdminUser(session.userId))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const releaseNote = await updateReleaseNote({
      id: context.params.releaseNoteId,
      status: parseStatus(body.status),
      updatedBy: session.userId,
      translations: await resolveTranslations(body)
    });

    await recordEvent({
      userId: session.userId,
      action: "release_note_edit",
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

    return NextResponse.json({ ok: true, releaseNote });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update release note.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
