import { NextResponse } from "next/server";
import { getCurrentUser } from "./current-user";
import type { UserRecord } from "../db";

export async function requireUser(): Promise<UserRecord | NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  return user;
}

export async function requireAdmin(): Promise<UserRecord | NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }
  return user;
}

export function isNextResponse(v: any): v is NextResponse {
  return v instanceof NextResponse;
}
