import path from "node:path";
import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/app/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const fileName = request.nextUrl.searchParams.get("file");
  const asDownload = request.nextUrl.searchParams.get("download") === "1";
  if (!fileName) {
    return NextResponse.json({ ok: false, error: "Missing file query parameter." }, { status: 400 });
  }

  // Only allow direct filenames within python/primers, e.g. AAPL_10-K_2025-09-28.pdf
  if (!/^[A-Za-z0-9._-]+\.pdf$/.test(fileName)) {
    return NextResponse.json({ ok: false, error: "Invalid file name." }, { status: 400 });
  }

  const primersDir = path.join(process.cwd(), "python", "primers");
  const target = path.join(primersDir, fileName);
  const normalized = path.resolve(target);
  const normalizedBase = path.resolve(primersDir);

  if (!normalized.startsWith(normalizedBase + path.sep)) {
    return NextResponse.json({ ok: false, error: "Invalid file path." }, { status: 400 });
  }

  try {
    const buffer = await readFile(normalized);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${asDownload ? "attachment" : "inline"}; filename=\"${fileName}\"`,
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return NextResponse.json({ ok: false, error: "PDF not found." }, { status: 404 });
  }
}
