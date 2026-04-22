import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { createUser, getUserByEmail, listUsers } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { requireAdmin, isNextResponse } from "@/lib/auth/guard";

export const runtime = "nodejs";

export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const rows = listUsers().map(({ password_hash, ...rest }) => rest);
  return NextResponse.json({ items: rows });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim() || null;
  const role = body.role === "admin" ? "admin" : "user";
  const tempPassword = String(body.temp_password ?? "");
  if (!email || !tempPassword || tempPassword.length < 8) {
    return NextResponse.json({ error: "Email e senha (≥8) obrigatórios" }, { status: 400 });
  }
  if (getUserByEmail(email)) {
    return NextResponse.json({ error: "Email já cadastrado" }, { status: 409 });
  }
  const hash = await hashPassword(tempPassword);
  const id = uuid();
  createUser({ id, email, password_hash: hash, name, role, must_change_password: true });
  return NextResponse.json({ ok: true, id });
}
