import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";

const WS_SERVER = process.env.WS_SERVER_URL || `http://localhost:${process.env.WS_PORT || 3001}`;

export async function POST(req: Request) {
  const blocked = await rateLimit(req, "daemon", 30, 60_000, "user");
  if (blocked) return blocked;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const res = await fetch(`${WS_SERVER}/api/daemon/spawn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.session.token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to connect to server" }, { status: 502 });
  }
}
