import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { authenticateWsConnection } from "./auth-ws.js";
import {
  createPreviewToken,
  PREVIEW_TOKEN_TTL_SECONDS,
} from "./preview-token.js";

export const PREVIEW_COOKIE_NAME = "anyterm_preview_token";

export function createPreviewAuthRoute() {
  const app = new Hono();

  app.post("/preview-auth", async (c) => {
    const user = await authenticateWsConnection(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const previewToken = createPreviewToken(user.id);
    const isSecure = (process.env.BETTER_AUTH_URL || "").startsWith("https://");

    setCookie(c, PREVIEW_COOKIE_NAME, previewToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? "None" : "Lax",
      path: "/tunnel",
      maxAge: PREVIEW_TOKEN_TTL_SECONDS,
    });

    return c.json({ ok: true, expiresIn: PREVIEW_TOKEN_TTL_SECONDS });
  });

  return app;
}
