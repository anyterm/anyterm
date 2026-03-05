import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(req: Request) {
  const blocked = await rateLimit(req, "config", 60, 60_000, "ip");
  if (blocked) return blocked;

  return NextResponse.json({
    wsUrl:
      process.env.NEXT_PUBLIC_WS_URL ||
      (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
        /^http/,
        "ws",
      ),
  });
}
