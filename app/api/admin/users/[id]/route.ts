import { NextRequest, NextResponse } from "next/server";
import { deleteUser, getUserById, updateUser } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { requireAdmin, isNextResponse } from "@/lib/auth/guard";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const user = getUserById(ctx.params.id);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const patch: any = {};
  if (typeof body.name === "string" || body.name === null) patch.name = body.name;
  if (body.role === "admin" || body.role === "user") patch.role = body.role;
  if (body.active === 0 || body.active === 1) patch.active = body.active;
  if (typeof body.reset_password === "string" && body.reset_password.length >= 8) {
    patch.password_hash = await hashPassword(body.reset_password);
    patch.must_change_password = 1;
  }
  updateUser(ctx.params.id, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, ctx: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  deleteUser(ctx.params.id);
  return NextResponse.json({ ok: true });
}
