import { NextRequest, NextResponse } from "next/server";
import { listReviews } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const url = new URL(req.url);
  const allParam = url.searchParams.get("all") === "1";
  const userIdParam = url.searchParams.get("user_id");

  let filterUserId: string | null = user.id;
  if (user.role === "admin" && allParam) filterUserId = null;
  if (user.role === "admin" && userIdParam) filterUserId = userIdParam;

  const rows = listReviews({ userId: filterUserId, limit: 200 });
  return NextResponse.json({ items: rows });
}
