import { NextRequest, NextResponse } from "next/server";
import { listPublishedReleaseNotes } from "@/app/lib/release-notes/store";

export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("locale") === "sv" ? "sv" : "en";
  const notes = await listPublishedReleaseNotes(locale);
  return NextResponse.json({ ok: true, locale, notes });
}
