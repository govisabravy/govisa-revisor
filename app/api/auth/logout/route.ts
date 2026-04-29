import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { recordLoginEvent } from "@/lib/db";
import { getClientIp } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getSession();
  const userId = session.userId ?? null;
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent") ?? null;
  session.destroy();
  try {
    recordLoginEvent({
      event_type: "logout",
      user_id: userId,
      ip,
      user_agent: userAgent
    });
  } catch {}
  return NextResponse.json({ ok: true });
}
