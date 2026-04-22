import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSession } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { updateUser } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { current, next } = await req.json().catch(() => ({}));
  if (!current || !next || String(next).length < 8) {
    return NextResponse.json(
      { error: "Senha nova precisa ter ao menos 8 caracteres" },
      { status: 400 }
    );
  }
  const ok = await verifyPassword(String(current), user.password_hash);
  if (!ok) return NextResponse.json({ error: "Senha atual incorreta" }, { status: 401 });
  const hash = await hashPassword(String(next));
  updateUser(user.id, { password_hash: hash, must_change_password: 0 });
  const session = await getSession();
  session.mustChangePassword = false;
  await session.save();
  return NextResponse.json({ ok: true });
}
