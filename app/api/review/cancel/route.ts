import { NextRequest, NextResponse } from "next/server";
import { cancelByToken } from "@/lib/reviewer/cancel-registry";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Cancela uma review em andamento (fix 10/06 — caso Anderson).
 * O front envia o mesmo `cancel_token` que mandou no upload da review.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let token: string | null = null;
  try {
    const body = await req.json();
    token = typeof body?.token === "string" ? body.token : null;
  } catch {
    // body inválido tratado abaixo
  }
  if (!token) {
    return NextResponse.json({ error: "Envie o campo 'token'." }, { status: 400 });
  }

  const cancelled = cancelByToken(token);
  logEvent({
    level: "info",
    msg: "review.cancel_requested",
    user_id: user.id,
    cancel_token: token,
    had_active_review: cancelled
  });

  return NextResponse.json({ cancelled });
}
