import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import {
  createUser,
  getUserByEmailIncludingInactive,
  listUsers,
  recordAdminAudit
} from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { requireAdmin, isNextResponse } from "@/lib/auth/guard";
import { getClientIp } from "@/lib/auth/rate-limit";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

const CreateUserSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().max(200).optional().nullable(),
  role: z.enum(["admin", "user"]).default("user"),
  temp_password: z.string().min(8).max(256)
});

export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const rows = listUsers().map(({ password_hash, ...rest }) => rest);
  return NextResponse.json({ items: rows });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const actor = guard;

  const raw = await req.json().catch(() => ({}));
  const parsed = CreateUserSchema.safeParse({
    ...raw,
    email: typeof raw?.email === "string" ? raw.email.trim().toLowerCase() : raw?.email,
    name: typeof raw?.name === "string" ? raw.name.trim() || null : raw?.name ?? null
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos. Email e senha (≥8) obrigatórios." },
      { status: 400 }
    );
  }
  const { email, name, role, temp_password } = parsed.data;

  const existing = getUserByEmailIncludingInactive(email);
  if (existing) {
    return NextResponse.json(
      {
        error: existing.active
          ? "Email já cadastrado"
          : "Email já cadastrado em conta desativada — reative-a em vez de criar uma nova"
      },
      { status: 409 }
    );
  }

  try {
    const hash = await hashPassword(temp_password);
    const id = uuid();
    createUser({
      id,
      email,
      password_hash: hash,
      name: name ?? null,
      role,
      must_change_password: true
    });
    recordAdminAudit({
      action: "user_created",
      actor_user_id: actor.id,
      target_user_id: id,
      metadata: { email, role, name },
      ip: getClientIp(req),
      user_agent: req.headers.get("user-agent") ?? null
    });
    return NextResponse.json({ ok: true, id });
  } catch (err: any) {
    logEvent({
      kind: "admin.db_error",
      op: "create_user",
      error: String(err?.message ?? err)
    });
    return NextResponse.json({ error: "Erro ao criar usuário" }, { status: 500 });
  }
}
