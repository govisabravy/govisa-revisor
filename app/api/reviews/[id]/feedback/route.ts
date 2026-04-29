import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getReview,
  upsertFindingFeedback,
  listFindingFeedback
} from "@/lib/db";
import { FeedbackErrorTypeValues } from "@/lib/schemas/forms";

export const runtime = "nodejs";

const PostBody = z.object({
  finding_hash: z.string().min(10),
  rule_id: z.string().min(1),
  subject_id: z.string().nullable().optional(),
  verdict: z.enum(["correct", "incorrect"]),
  error_type: z
    .enum(FeedbackErrorTypeValues as [string, ...string[]])
    .nullable()
    .optional(),
  note: z.string().max(2000).nullable().optional()
});

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const review = getReview(ctx.params.id);
  if (!review) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (user.role !== "admin" && (review.meta as any).user_id !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  upsertFindingFeedback({
    review_id: ctx.params.id,
    user_id: user.id,
    finding_hash: parsed.data.finding_hash,
    rule_id: parsed.data.rule_id,
    subject_id: parsed.data.subject_id ?? null,
    verdict: parsed.data.verdict,
    error_type: parsed.data.error_type ?? null,
    note: parsed.data.note ?? null
  });

  return NextResponse.json({ ok: true });
}

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const review = getReview(ctx.params.id);
  if (!review) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (user.role !== "admin" && (review.meta as any).user_id !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const items = listFindingFeedback(ctx.params.id);
  return NextResponse.json({ items });
}
