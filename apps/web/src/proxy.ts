import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const TUNNEL_REFERER_RE = /\/tunnel\/([^/]+)\/(\d+)/;

/**
 * Proxy to route secondary requests from tunnel iframes.
 *
 * When the preview iframe loads HTML from /tunnel/sessionId/port/, the page's
 * sub-resources (/@vite/client, /src/main.tsx, etc.) are requested as absolute
 * paths against the origin. This proxy detects them via the Referer header
 * and rewrites to the Hono tunnel handler. The browser's session cookie is
 * forwarded automatically by the Next.js rewrite proxy.
 */
export function proxy(request: NextRequest) {
  const referer = request.headers.get("referer");
  if (!referer) return;

  const match = referer.match(TUNNEL_REFERER_RE);
  if (!match) return;

  const [, sessionId, port] = match;

  // Verify auth cookie exists (it's forwarded by Next.js rewrite automatically)
  const cookieValue = request.cookies.get("better-auth.session_token")?.value;
  if (!cookieValue) return;

  // Rewrite to same-origin /tunnel/ path (next.config.ts rewrite proxies to Hono)
  // The browser's session cookie is forwarded automatically by Next.js rewrite.
  const url = request.nextUrl.clone();
  url.pathname = `/tunnel/${sessionId}/${port}${url.pathname}`;

  return NextResponse.rewrite(url);
}

export const config = {
  // Only run on paths that could be tunnel sub-resources.
  // Exclude Next.js internals, API routes, tunnel paths (handled by rewrite), and static files.
  matcher: [
    "/((?!_next|api|tunnel|ws|favicon\\.ico|s|dashboard|login|signup|invite|settings|org).*)",
  ],
};
