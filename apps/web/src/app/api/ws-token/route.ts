import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Returns the raw session token for WebSocket authentication.
 * The browser needs this because the session cookie is httpOnly
 * and can't be read by JavaScript, but the WS server (which may
 * run on a different port in dev) needs a token for auth.
 */
export async function GET(req: Request) {
  const blocked = await rateLimit(req, "ws-token", 30, 60_000, "user");
  if (blocked) return blocked;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ token: session.session.token });
}
