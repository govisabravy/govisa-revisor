import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import {
  verifyPassword,
  DUMMY_BCRYPT_HASH
} from "@/lib/auth/password";
import {
  getUserByEmail,
  getUserByEmailIncludingInactive,
  recordLoginEvent,
  updateUser
} from "@/lib/db";
import { ensureSeedAdmin } from "@/lib/auth/seed";
import { checkRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

const LoginSchema = z.object({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(256)
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent") ?? null;

  // rate limit por IP (protege contra brute force distribuído por email)
  const ipLimit = checkRateLimit(`login:ip:${ip}`, {
    limit: 20,
    windowMs: 60_000
  });
  if (!ipLimit.ok) {
    try {
      recordLoginEvent({
        event_type: "rate_limited",
        ip,
        user_agent: userAgent,
        metadata: { scope: "login_ip" }
      });
    } catch {}
    return NextResponse.json(
      { error: "Muitas tentativas. Tente novamente em instantes." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
    );
  }

  try {
    await ensureSeedAdmin();
  } catch (err: any) {
    logEvent({ kind: "auth.seed_error", error: String(err?.message ?? err) });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = LoginSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Email e senha obrigatórios" },
      { status: 400 }
    );
  }
  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;

  // Rate limit adicional por (IP+email) para reduzir impacto de spray attacks
  const emailLimit = checkRateLimit(`login:pair:${ip}:${email}`, {
    limit: 10,
    windowMs: 5 * 60_000
  });
  if (!emailLimit.ok) {
    try {
      recordLoginEvent({
        event_type: "rate_limited",
        email_attempted: email,
        ip,
        user_agent: userAgent,
        metadata: { scope: "login_pair" }
      });
    } catch {}
    return NextResponse.json(
      { error: "Muitas tentativas. Tente novamente em instantes." },
      { status: 429, headers: { "Retry-After": String(emailLimit.retryAfterSeconds) } }
    );
  }

  let user: ReturnType<typeof getUserByEmail> = null;
  try {
    user = getUserByEmail(email);
  } catch (err: any) {
    logEvent({ kind: "auth.db_error", op: "getUserByEmail", error: String(err?.message ?? err) });
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }

  // Sempre chama verifyPassword (mesmo com hash dummy) para igualar o tempo
  // de resposta entre usuário inexistente/inativo e senha errada.
  const hashToCompare = user?.password_hash ?? DUMMY_BCRYPT_HASH;
  const ok = await verifyPassword(password, hashToCompare);

  if (!user || !ok) {
    // Para auditoria forense, distinguir no_user (email nunca cadastrado) de
    // inactive (email existe mas conta foi desativada) sem afetar resposta HTTP
    // nem timing (a consulta extra só roda quando já falhou, após verifyPassword).
    let reason: "no_user" | "inactive" | "bad_password";
    if (!user) {
      const inactive = getUserByEmailIncludingInactive(email);
      reason = inactive ? "inactive" : "no_user";
    } else {
      reason = "bad_password";
    }
    try {
      recordLoginEvent({
        event_type: "login_fail",
        user_id: user?.id ?? null,
        email_attempted: email,
        ip,
        user_agent: userAgent,
        metadata: { reason }
      });
    } catch {}
    return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
  }

  const session = await getSession();
  session.userId = user.id;
  session.role = user.role;
  session.mustChangePassword = !!user.must_change_password;
  session.createdAt = Math.floor(Date.now() / 1000);
  await session.save();

  try {
    updateUser(user.id, { last_login_at: new Date().toISOString() });
  } catch (err: any) {
    logEvent({ kind: "auth.db_error", op: "updateUser.last_login_at", error: String(err?.message ?? err) });
  }

  try {
    recordLoginEvent({
      event_type: "login_ok",
      user_id: user.id,
      email_attempted: email,
      ip,
      user_agent: userAgent
    });
  } catch {}

  return NextResponse.json({
    ok: true,
    must_change_password: !!user.must_change_password,
    role: user.role
  });
}
