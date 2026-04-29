import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getReview,
  insertMissingFindingReport,
  listMissingFindingReports
} from "@/lib/db";

export const runtime = "nodejs";

const PostBody = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(4000),
  suggested_severity: z
    .enum(["critica", "alta", "media", "baixa"])
    .nullable()
    .optional(),
  suggested_rule_id: z.string().max(120).nullable().optional(),
  subject_id: z.string().max(64).nullable().optional(),
  form: z.string().max(64).nullable().optional()
});

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

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

  const id = insertMissingFindingReport({
    review_id: ctx.params.id,
    user_id: user.id,
    title: parsed.data.title,
    description: parsed.data.description,
    suggested_severity: parsed.data.suggested_severity ?? null,
    suggested_rule_id: parsed.data.suggested_rule_id ?? null,
    subject_id: parsed.data.subject_id ?? null,
    form: parsed.data.form ?? null
  });

  return NextResponse.json({ ok: true, id });
}

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const review = getReview(ctx.params.id);
  if (!review) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (user.role !== "admin" && (review.meta as any).user_id !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const items = listMissingFindingReports(ctx.params.id);
  return NextResponse.json({ items });
}
