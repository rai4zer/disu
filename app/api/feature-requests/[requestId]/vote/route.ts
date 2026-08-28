import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/app/lib/auth/session";
import { recordEvent } from "@/app/lib/db/events";
import {
  addFeatureRequestVote,
  createAnonymousVoteToken,
  getFeatureRequestById,
  removeFeatureRequestVote
} from "@/app/lib/feature-requests/store";

const ANON_VOTE_COOKIE = "disu_feature_vote";

function votesRequireLogin(): boolean {
  const raw = (process.env.VOTES_REQUIRE_LOGIN ?? "false").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function readOrCreateAnonToken(request: NextRequest): { token: string; created: boolean } {
  const existing = request.cookies.get(ANON_VOTE_COOKIE)?.value?.trim() ?? "";
  if (existing) {
    return { token: existing, created: false };
  }
  return { token: createAnonymousVoteToken(), created: true };
}

export async function POST(
  request: NextRequest,
  context: { params: { requestId: string } }
) {
  const session = await getAuthenticatedSession(request);
  if (votesRequireLogin() && !session) {
    return NextResponse.json({ ok: false, error: "Sign in required for votes." }, { status: 401 });
  }

  const parent = await getFeatureRequestById(context.params.requestId);
  if (!parent) {
    return NextResponse.json({ ok: false, error: "Feature request not found." }, { status: 404 });
  }

  try {
    const anonToken = !session ? readOrCreateAnonToken(request) : null;
    const result = await addFeatureRequestVote({
      featureRequestId: context.params.requestId,
      userId: session?.userId ?? null,
      anonToken: anonToken?.token
    });

    if (session?.userId && result.created) {
      await recordEvent({
        userId: session.userId,
        action: "feature_request_vote",
        status: "success",
        metadata: { featureRequestId: context.params.requestId }
      });
    }

    const response = NextResponse.json({ ok: true, created: result.created }, { status: result.created ? 201 : 200 });

    if (anonToken?.created) {
      response.cookies.set({
        name: ANON_VOTE_COOKIE,
        value: anonToken.token,
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 60 * 60 * 24 * 365
      });
    }

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to cast vote.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: { requestId: string } }
) {
  const session = await getAuthenticatedSession(request);
  if (votesRequireLogin() && !session) {
    return NextResponse.json({ ok: false, error: "Sign in required for votes." }, { status: 401 });
  }

  const parent = await getFeatureRequestById(context.params.requestId);
  if (!parent) {
    return NextResponse.json({ ok: false, error: "Feature request not found." }, { status: 404 });
  }

  const anonToken = !session ? request.cookies.get(ANON_VOTE_COOKIE)?.value ?? null : null;
  await removeFeatureRequestVote({
    featureRequestId: context.params.requestId,
    userId: session?.userId ?? null,
    anonToken
  });

  return NextResponse.json({ ok: true });
}
