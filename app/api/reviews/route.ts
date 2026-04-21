import { NextResponse } from "next/server";
import { listReviews } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const rows = listReviews(100);
  return NextResponse.json({ items: rows });
}
