import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { getUserByEmail, updateUser } from "@/lib/db";
import { ensureSeedAdmin } from "@/lib/auth/seed";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  await ensureSeedAdmin();
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Email e senha obrigatórios" }, { status: 400 });
  }
  const user = getUserByEmail(email);
  if (!user) {
    return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 });
  }
  const session = await getSession();
  session.userId = user.id;
  session.role = user.role;
  session.mustChangePassword = !!user.must_change_password;
  await session.save();
  updateUser(user.id, { last_login_at: new Date().toISOString() });
  return NextResponse.json({
    ok: true,
    must_change_password: !!user.must_change_password,
    role: user.role
  });
}
