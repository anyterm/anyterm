import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { rateLimit } from "@/lib/rate-limit";

const { POST: authPost, GET: authGet } = toNextJsHandler(auth);

export async function POST(req: Request) {
  const blocked = await rateLimit(req, "auth", 60, 60_000, "ip");
  if (blocked) return blocked;
  return authPost(req);
}

export async function GET(req: Request) {
  const blocked = await rateLimit(req, "auth", 60, 60_000, "ip");
  if (blocked) return blocked;
  return authGet(req);
}
