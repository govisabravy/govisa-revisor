import { NextRequest, NextResponse } from "next/server";
import { getDashboardKpis } from "@/lib/kpis";
import { requireAdmin, isNextResponse } from "@/lib/auth/guard";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const url = new URL(req.url);
  const p = (url.searchParams.get("period") ?? "30d") as any;
  const userId = url.searchParams.get("user_id") ?? undefined;
  const validPeriods = ["24h", "7d", "30d", "mtd", "ytd"];
  const period = validPeriods.includes(p) ? p : "30d";
  const data = getDashboardKpis(period, userId);
  return NextResponse.json(data);
}
