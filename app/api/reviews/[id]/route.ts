import { NextRequest, NextResponse } from "next/server";
import { getReview } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_: NextRequest, ctx: { params: { id: string } }) {
  const r = getReview(ctx.params.id);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(r);
}
