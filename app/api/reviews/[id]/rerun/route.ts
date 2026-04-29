import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { reviewProcess } from "@/lib/reviewer";
import { getReview, saveReview, saveUsageEvents } from "@/lib/db";
import { estimateCostUSD } from "@/lib/pricing";
import { logEvent } from "@/lib/logger";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  isStorageEnabled,
  downloadReviewPdf,
  uploadReviewPdf,
  buildReviewPdfKey
} from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 500;

export async function POST(_: NextRequest, ctx: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Apenas admins podem rerodar revisões." }, { status: 403 });
  }

  const sourceId = ctx.params.id;
  const source = getReview(sourceId);
  if (!source) return NextResponse.json({ error: "Revisão não encontrada." }, { status: 404 });
  if (!isStorageEnabled()) {
    return NextResponse.json(
      { error: "Storage S3 não configurado no servidor." },
      { status: 503 }
    );
  }
  const objectKey = (source.meta as any).pdf_object_key as string | null;
  if (!objectKey) {
    return NextResponse.json(
      {
        error:
          "Esta revisão não tem PDF arquivado (criada antes da persistência S3). Reupload necessário."
      },
      { status: 409 }
    );
  }

  let buffer: Buffer;
  let originalFileName: string | null;
  try {
    const out = await downloadReviewPdf(objectKey);
    buffer = out.buffer;
    originalFileName = out.originalFileName;
  } catch (err) {
    return NextResponse.json(
      { error: `Falha ao baixar PDF do storage: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const fileName = originalFileName ?? (source.meta as any).file_name ?? "rerun.pdf";
  const mode: "draft" | "final" = "draft";
  const caseTypeRaw = ((source.meta as any).case_type ?? "t_visa") as string;
  const caseType: "t_visa" | "vawa" | "u_visa" =
    caseTypeRaw === "vawa" ? "vawa" : caseTypeRaw === "u_visa" ? "u_visa" : "t_visa";

  const newReviewId = uuid();
  const startedAt = new Date().toISOString();

  logEvent({
    level: "info",
    msg: "review.rerun.start",
    review_id: newReviewId,
    source_review_id: sourceId,
    user_id: user.id
  });

  const result = await reviewProcess({ buffer, mode, caseType });

  let pdfObjectKey: string | null = null;
  try {
    await uploadReviewPdf(newReviewId, buffer, fileName);
    pdfObjectKey = buildReviewPdfKey(newReviewId);
  } catch (err) {
    logEvent({
      level: "warn",
      msg: "review.pdf_upload_failed",
      review_id: newReviewId,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  const usageTotals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0
  };
  let model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
  for (const e of result.usage_events) {
    usageTotals.input_tokens += e.input_tokens;
    usageTotals.output_tokens += e.output_tokens;
    usageTotals.cache_creation_input_tokens += e.cache_creation_input_tokens;
    usageTotals.cache_read_input_tokens += e.cache_read_input_tokens;
    if (e.model) model = e.model;
  }
  const costUsd = estimateCostUSD(model, usageTotals);

  saveReview({
    id: newReviewId,
    created_at: startedAt,
    file_name: fileName,
    file_size: buffer.byteLength,
    num_pages: result.debug.num_pages,
    client_name: result.report.client_name ?? null,
    forms_detected: result.report.forms_detected,
    total_findings: result.report.summary.total,
    critical_count: result.report.summary.critical,
    high_count: result.report.summary.high,
    medium_count: result.report.summary.medium,
    low_count: result.report.summary.low,
    tier1_count: result.report.summary.by_tier.tier1_filing,
    tier2_count: result.report.summary.by_tier.tier2_substantivo,
    tier3_count: result.report.summary.by_tier.tier3_estrategico,
    elapsed_ms: result.debug.elapsed_ms,
    total_input_tokens: usageTotals.input_tokens,
    total_output_tokens: usageTotals.output_tokens,
    total_cache_creation_tokens: usageTotals.cache_creation_input_tokens,
    total_cache_read_tokens: usageTotals.cache_read_input_tokens,
    estimated_cost_usd: costUsd,
    report_json: JSON.stringify(result.report),
    debug_json: JSON.stringify(result.debug),
    user_id: user.id,
    case_type: caseType,
    pdf_object_key: pdfObjectKey
  });

  saveUsageEvents(
    result.usage_events.map((e) => ({
      review_id: newReviewId,
      operation: e.operation,
      model: e.model,
      input_tokens: e.input_tokens,
      output_tokens: e.output_tokens,
      cache_creation_input_tokens: e.cache_creation_input_tokens,
      cache_read_input_tokens: e.cache_read_input_tokens,
      duration_ms: e.duration_ms,
      attempts: e.attempts,
      had_pdf: e.had_pdf,
      ok: e.ok,
      error: e.error
    }))
  );

  logEvent({
    level: "info",
    msg: "review.rerun.done",
    review_id: newReviewId,
    source_review_id: sourceId,
    file_name: fileName,
    total_findings: result.report.summary.total,
    elapsed_ms: result.debug.elapsed_ms,
    estimated_cost_usd: costUsd
  });

  return NextResponse.json({
    review_id: newReviewId,
    source_review_id: sourceId,
    summary: result.report.summary,
    telemetry: { model, usage: usageTotals, estimated_cost_usd: costUsd }
  });
}
