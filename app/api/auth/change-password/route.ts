import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSession } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { recordLoginEvent, updateUser } from "@/lib/db";
import { checkRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

const ChangePasswordSchema = z.object({
  current: z.string().min(1).max(256),
  next: z.string().min(8).max(256)
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent") ?? null;

  const rl = checkRateLimit(`change-password:${user.id}`, {
    limit: 10,
    windowMs: 5 * 60_000
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Muitas tentativas. Tente novamente em instantes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = ChangePasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Senha nova precisa ter ao menos 8 caracteres" },
      { status: 400 }
    );
  }
  const { current, next } = parsed.data;

  if (current === next) {
    return NextResponse.json(
      { error: "A nova senha precisa ser diferente da atual" },
      { status: 400 }
    );
  }

  const ok = await verifyPassword(current, user.password_hash);
  if (!ok) return NextResponse.json({ error: "Senha atual incorreta" }, { status: 401 });

  try {
    const hash = await hashPassword(next);
    updateUser(user.id, { password_hash: hash, must_change_password: 0 });
  } catch (err: any) {
    logEvent({ kind: "auth.db_error", op: "change_password", error: String(err?.message ?? err) });
    return NextResponse.json({ error: "Erro ao salvar senha" }, { status: 500 });
  }

  const session = await getSession();
  session.mustChangePassword = false;
  await session.save();

  try {
    recordLoginEvent({
      event_type: "password_change",
      user_id: user.id,
      email_attempted: user.email,
      ip,
      user_agent: userAgent
    });
  } catch {}

  return NextResponse.json({ ok: true, role: user.role });
}
