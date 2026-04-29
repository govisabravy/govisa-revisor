import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    must_change_password: !!user.must_change_password
  });
}
