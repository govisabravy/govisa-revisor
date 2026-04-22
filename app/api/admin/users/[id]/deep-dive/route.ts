import { NextRequest, NextResponse } from "next/server";
import { getUserDeepDive } from "@/lib/kpis";
import { requireAdmin, isNextResponse } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const url = new URL(req.url);
  const p = (url.searchParams.get("period") ?? "30d") as any;
  const valid = ["24h","7d","30d","mtd","ytd"].includes(p) ? p : "30d";
  const data = getUserDeepDive(ctx.params.id, valid);
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}
