import { NextRequest, NextResponse } from "next/server";
import { getReview } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { renderReportPdf, reportPdfFileName } from "@/lib/reviewer/report-pdf";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const r = getReview(ctx.params.id);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (user.role !== "admin" && (r.meta as any).user_id !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const buffer = await renderReportPdf(r.report, r.meta);
    const filename = reportPdfFileName(r.report, r.meta);
    const body = new Uint8Array(buffer);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Falha ao gerar PDF", detail: msg },
      { status: 500 }
    );
  }
}
