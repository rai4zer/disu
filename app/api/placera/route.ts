/**
 * Sentiment for one company, on demand.
 *
 * The pipeline itself lives in `app/lib/placera/sentiment-pipeline.ts`; what is
 * left here is the part that is actually a route's job — parameters, status
 * codes and cache headers.
 *
 * This is the only thing that runs the pipeline, and it only runs on request.
 * Nothing pre-computes sentiment in the background: each analysis is dozens of
 * calls into Placera's forum, and sweeping a watchlist trips their rate limiter
 * hard enough to break the searches real users are making.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  loadPlaceraSentiment,
  PlaceraCompanyNotFoundError
} from "@/app/lib/placera/sentiment-pipeline";

export async function GET(request: NextRequest) {
  const companyIdInput = request.nextUrl.searchParams.get("companyId")?.trim();
  const companyQuery = request.nextUrl.searchParams.get("companyQuery")?.trim();

  if (!companyIdInput && !companyQuery) {
    return NextResponse.json(
      { error: "Missing required query parameter: companyId or companyQuery" },
      { status: 400 }
    );
  }

  try {
    const payload = await loadPlaceraSentiment({
      companyId: companyIdInput,
      companyQuery
    });

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=60"
      }
    });
  } catch (error) {
    if (error instanceof PlaceraCompanyNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    const isAbort = error instanceof Error && error.name === "AbortError";

    return NextResponse.json(
      {
        error: isAbort ? "Placera request timed out" : "Unexpected error while fetching Placera data"
      },
      { status: isAbort ? 504 : 500 }
    );
  }
}
