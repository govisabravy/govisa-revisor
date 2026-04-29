import { NextRequest, NextResponse } from "next/server";
import { getReview, listFindingFeedback } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { enrichFindingsWithHash } from "@/lib/findings";

export const runtime = "nodejs";

export async function GET(_: NextRequest, ctx: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const r = getReview(ctx.params.id);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (user.role !== "admin" && (r.meta as any).user_id !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Enriquecer findings com _hash (passthrough — não muda schema oficial)
  const reportEnriched = r.report
    ? {
        ...r.report,
        findings: Array.isArray(r.report.findings)
          ? enrichFindingsWithHash(r.report.findings)
          : []
      }
    : r.report;

  const feedback = listFindingFeedback(ctx.params.id);

  return NextResponse.json({
    ...r,
    report: reportEnriched,
    feedback
  });
}
