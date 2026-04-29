import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteUser,
  getUserById,
  getUserByEmailIncludingInactive,
  recordAdminAudit,
  updateUser
} from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { requireAdmin, isNextResponse } from "@/lib/auth/guard";
import { getClientIp } from "@/lib/auth/rate-limit";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";

const PatchSchema = z.object({
  email: z.string().email().max(254).optional(),
  name: z.union([z.string().max(200), z.null()]).optional(),
  role: z.enum(["admin", "user"]).optional(),
  active: z.union([z.literal(0), z.literal(1)]).optional(),
  reset_password: z.string().min(8).max(256).optional()
});

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const actor = guard;

  const user = getUserById(ctx.params.id);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const raw = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }
  const body = parsed.data;

  const ip = getClientIp(req);
  const ua = req.headers.get("user-agent") ?? null;

  const patch: Parameters<typeof updateUser>[1] = {};
  const auditEvents: Array<Parameters<typeof recordAdminAudit>[0]> = [];

  if (body.email !== undefined) {
    const normalized = body.email.trim().toLowerCase();
    if (normalized !== user.email) {
      const conflict = getUserByEmailIncludingInactive(normalized);
      if (conflict && conflict.id !== user.id) {
        return NextResponse.json(
          { error: "Email já cadastrado em outra conta" },
          { status: 409 }
        );
      }
      patch.email = normalized;
      auditEvents.push({
        action: "user_email_changed",
        actor_user_id: actor.id,
        target_user_id: user.id,
        metadata: { from: user.email, to: normalized },
        ip,
        user_agent: ua
      });
    }
  }

  if (body.name !== undefined && body.name !== user.name) {
    patch.name = body.name === null ? null : body.name.trim() || null;
    auditEvents.push({
      action: "user_name_changed",
      actor_user_id: actor.id,
      target_user_id: user.id,
      metadata: { from: user.name, to: patch.name },
      ip,
      user_agent: ua
    });
  }

  if (body.role && body.role !== user.role) {
    patch.role = body.role;
    auditEvents.push({
      action: "user_role_changed",
      actor_user_id: actor.id,
      target_user_id: user.id,
      metadata: { from: user.role, to: body.role },
      ip,
      user_agent: ua
    });
  }

  if (body.active !== undefined && body.active !== user.active) {
    patch.active = body.active;
    auditEvents.push({
      action: body.active === 1 ? "user_activated" : "user_deactivated",
      actor_user_id: actor.id,
      target_user_id: user.id,
      ip,
      user_agent: ua
    });
  }

  if (body.reset_password) {
    try {
      patch.password_hash = await hashPassword(body.reset_password);
      patch.must_change_password = 1;
      auditEvents.push({
        action: "password_reset_by_admin",
        actor_user_id: actor.id,
        target_user_id: user.id,
        ip,
        user_agent: ua
      });
    } catch (err: any) {
      logEvent({
        kind: "admin.db_error",
        op: "hash_password",
        error: String(err?.message ?? err)
      });
      return NextResponse.json({ error: "Erro ao gerar hash da senha" }, { status: 500 });
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, noop: true });
  }

  try {
    updateUser(ctx.params.id, patch);
    for (const ev of auditEvents) {
      try {
        recordAdminAudit(ev);
      } catch {}
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    logEvent({ kind: "admin.db_error", op: "update_user", error: msg });
    if (msg.toLowerCase().includes("unique") && msg.toLowerCase().includes("email")) {
      return NextResponse.json(
        { error: "Email já cadastrado em outra conta" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Erro ao atualizar usuário" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const actor = guard;

  const user = getUserById(ctx.params.id);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    deleteUser(ctx.params.id);
    recordAdminAudit({
      action: "user_deactivated",
      actor_user_id: actor.id,
      target_user_id: user.id,
      metadata: { via: "DELETE" },
      ip: getClientIp(req),
      user_agent: req.headers.get("user-agent") ?? null
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    logEvent({
      kind: "admin.db_error",
      op: "delete_user",
      error: String(err?.message ?? err)
    });
    return NextResponse.json({ error: "Erro ao desativar usuário" }, { status: 500 });
  }
}
