import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { reviewProcess } from "@/lib/reviewer";
import { saveReview, saveUsageEvents } from "@/lib/db";
import { estimateCostUSD } from "@/lib/pricing";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const reviewId = uuid();
  const startedAt = new Date().toISOString();

  logEvent({ level: "info", msg: "review.start", review_id: reviewId });

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Envie o PDF no campo 'file'." }, { status: 400 });
    }
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const modeRaw = String(formData.get("mode") ?? "draft").toLowerCase();
    const mode: "draft" | "final" = modeRaw === "final" ? "final" : "draft";

    const result = await reviewProcess({ buffer, mode });

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
      id: reviewId,
      created_at: startedAt,
      file_name: file.name,
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
      debug_json: JSON.stringify(result.debug)
    });

    saveUsageEvents(
      result.usage_events.map((e) => ({
        review_id: reviewId,
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
      msg: "review.done",
      review_id: reviewId,
      file_name: file.name,
      client_name: result.report.client_name,
      total_findings: result.report.summary.total,
      elapsed_ms: result.debug.elapsed_ms,
      input_tokens: usageTotals.input_tokens,
      output_tokens: usageTotals.output_tokens,
      estimated_cost_usd: costUsd
    });

    return NextResponse.json({
      review_id: reviewId,
      ...result,
      telemetry: {
        model,
        usage: usageTotals,
        estimated_cost_usd: costUsd
      }
    });
  } catch (err: any) {
    logEvent({
      level: "error",
      msg: "review.failed",
      review_id: reviewId,
      error: err?.message ?? String(err)
    });
    return NextResponse.json(
      { review_id: reviewId, error: err?.message ?? "Erro ao processar PDF" },
      { status: 500 }
    );
  }
}
