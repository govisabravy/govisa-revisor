import { NextRequest, NextResponse } from "next/server";
import { getUserRanking } from "@/lib/kpis";
import { requireAdmin, isNextResponse } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const url = new URL(req.url);
  const p = (url.searchParams.get("period") ?? "30d") as any;
  const dim = (url.searchParams.get("dimension") ?? "overall") as any;
  const valid = ["24h","7d","30d","mtd","ytd"].includes(p) ? p : "30d";
  const validDim = ["volume","quality","efficiency","reliability","overall"].includes(dim) ? dim : "overall";
  return NextResponse.json({ items: getUserRanking(valid, validDim) });
}
