import { NextRequest, NextResponse } from "next/server";
import { isAdminUser } from "@/app/lib/admin/access";
import { getAuthenticatedSession } from "@/app/lib/auth/session";

export async function GET(request: NextRequest) {
    const session = await getAuthenticatedSession(request);
  if (!session) {
    return NextResponse.json({ authenticated: false, isAdmin: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    isAdmin: await isAdminUser(session.userId),
    user: {
      id: session.userId,
      email: session.email
    }
  });
}
