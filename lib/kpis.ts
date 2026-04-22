import { getDatabase } from "./db";
import { subHours, subDays, startOfMonth, startOfYear, format, eachDayOfInterval } from "date-fns";

type Period = "24h" | "7d" | "30d" | "mtd" | "ytd";

function periodStart(period: Period): Date {
  const now = new Date();
  switch (period) {
    case "24h": return subHours(now, 24);
    case "7d": return subDays(now, 7);
    case "mtd": return startOfMonth(now);
    case "ytd": return startOfYear(now);
    default: return subDays(now, 30);
  }
}

export interface DashboardKpis {
  cards: {
    reviews_today: number;
    reviews_week: number;
    active_users_7d: number;
    total_cost_30d: number;
    avg_elapsed_ms: number;
    critical_rate: number;
  };
  reviews_per_day: Array<{ date: string; count: number; cost_usd: number }>;
  top_users: Array<{
    user_id: string;
    email: string;
    name: string | null;
    reviews: number;
    avg_findings: number;
    critical_pct: number;
    total_cost: number;
    avg_elapsed_ms: number;
    last_activity: string | null;
  }>;
  findings_by_severity: Array<{ name: string; value: number }>;
  findings_by_tier: Array<{ name: string; value: number }>;
  top_operations_time: Array<{ operation: string; avg_ms: number; p95_ms: number }>;
  token_usage: {
    input: number;
    output: number;
    cache_creation: number;
    cache_read: number;
    total_cost_usd: number;
  };
  recent_errors: Array<{ operation: string; count: number }>;
  zero_findings_count: number;
  draft_vs_final: { draft: number; final: number };
}

export function getDashboardKpis(period: Period = "30d", userId?: string): DashboardKpis {
  const d = getDatabase();
  const since = periodStart(period).toISOString();
  const since30 = subDays(new Date(), 30).toISOString();
  const since7 = subDays(new Date(), 7).toISOString();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const userFilter = userId ? ` AND user_id = '${userId.replace(/'/g, "")}'` : "";

  const baseFilter = `WHERE user_id IS NOT NULL AND created_at >= ?${userFilter}`;

  const cardsRow = d.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) as reviews_today,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) as reviews_week,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN estimated_cost_usd ELSE 0 END), 0) as total_cost_30d,
      COALESCE(AVG(elapsed_ms), 0) as avg_elapsed_ms,
      COALESCE(AVG(CASE WHEN critical_count > 0 THEN 1.0 ELSE 0.0 END), 0) as critical_rate
    FROM reviews
    WHERE user_id IS NOT NULL${userFilter}
  `).get(todayStart.toISOString(), since7, since30) as any;

  const activeUsers = d.prepare(`
    SELECT COUNT(DISTINCT user_id) as c
    FROM reviews WHERE user_id IS NOT NULL AND created_at >= ?
  `).get(since7) as any;

  const perDayRows = d.prepare(`
    SELECT substr(created_at, 1, 10) as date,
           COUNT(*) as count,
           COALESCE(SUM(estimated_cost_usd), 0) as cost_usd
    FROM reviews
    ${baseFilter}
    GROUP BY substr(created_at, 1, 10)
    ORDER BY date ASC
  `).all(since) as any[];

  const daysInterval = eachDayOfInterval({ start: periodStart(period), end: new Date() });
  const byDate = new Map(perDayRows.map(r => [r.date, r]));
  const reviews_per_day = daysInterval.map(d0 => {
    const key = format(d0, "yyyy-MM-dd");
    const r = byDate.get(key);
    return {
      date: format(d0, "dd/MM"),
      count: r?.count ?? 0,
      cost_usd: Number((r?.cost_usd ?? 0).toFixed(4))
    };
  });

  const topUsersRows = d.prepare(`
    SELECT u.id as user_id, u.email, u.name,
           COUNT(r.id) as reviews,
           COALESCE(AVG(r.total_findings), 0) as avg_findings,
           COALESCE(SUM(CASE WHEN r.critical_count > 0 THEN 1.0 ELSE 0.0 END) * 100.0 / NULLIF(COUNT(r.id), 0), 0) as critical_pct,
           COALESCE(SUM(r.estimated_cost_usd), 0) as total_cost,
           COALESCE(AVG(r.elapsed_ms), 0) as avg_elapsed_ms,
           MAX(r.created_at) as last_activity
    FROM users u
    LEFT JOIN reviews r ON r.user_id = u.id AND r.created_at >= ?
    WHERE u.active = 1
    GROUP BY u.id
    ORDER BY reviews DESC
    LIMIT 20
  `).all(since) as any[];

  const sevRow = d.prepare(`
    SELECT COALESCE(SUM(critical_count), 0) as critica,
           COALESCE(SUM(high_count), 0) as alta,
           COALESCE(SUM(medium_count), 0) as media,
           COALESCE(SUM(low_count), 0) as baixa
    FROM reviews
    ${baseFilter}
  `).get(since) as any;

  const tierRow = d.prepare(`
    SELECT COALESCE(SUM(tier1_count), 0) as tier1_filing,
           COALESCE(SUM(tier2_count), 0) as tier2_substantivo,
           COALESCE(SUM(tier3_count), 0) as tier3_estrategico
    FROM reviews
    ${baseFilter}
  `).get(since) as any;

  const opsRows = d.prepare(`
    SELECT operation, duration_ms
    FROM usage_events e
    WHERE e.created_at >= ?
      AND e.review_id IN (SELECT id FROM reviews WHERE user_id IS NOT NULL${userFilter})
  `).all(since) as any[];

  const byOp = new Map<string, number[]>();
  for (const r of opsRows) {
    if (!byOp.has(r.operation)) byOp.set(r.operation, []);
    byOp.get(r.operation)!.push(r.duration_ms ?? 0);
  }
  const top_operations_time = Array.from(byOp.entries())
    .map(([op, arr]) => {
      const sorted = arr.slice().sort((a, b) => a - b);
      const avg = sorted.reduce((s, x) => s + x, 0) / sorted.length;
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
      return { operation: op, avg_ms: Math.round(avg), p95_ms: Math.round(p95) };
    })
    .sort((a, b) => b.avg_ms - a.avg_ms)
    .slice(0, 15);

  const tokenRow = d.prepare(`
    SELECT COALESCE(SUM(total_input_tokens), 0) as input,
           COALESCE(SUM(total_output_tokens), 0) as output,
           COALESCE(SUM(total_cache_creation_tokens), 0) as cache_creation,
           COALESCE(SUM(total_cache_read_tokens), 0) as cache_read,
           COALESCE(SUM(estimated_cost_usd), 0) as total_cost_usd
    FROM reviews
    ${baseFilter}
  `).get(since) as any;

  const errorRows = d.prepare(`
    SELECT operation, COUNT(*) as count
    FROM usage_events
    WHERE ok = 0 AND created_at >= ?
    GROUP BY operation
    ORDER BY count DESC
    LIMIT 10
  `).all(since) as any[];

  const zeroRow = d.prepare(`
    SELECT COUNT(*) as c
    FROM reviews
    ${baseFilter} AND total_findings = 0
  `).get(since) as any;

  const draftRow = d.prepare(`
    SELECT COUNT(*) as c
    FROM reviews
    ${baseFilter} AND report_json LIKE '%Assinaturas (modo draft)%'
  `).get(since) as any;
  const totalRow = d.prepare(`
    SELECT COUNT(*) as c
    FROM reviews
    ${baseFilter}
  `).get(since) as any;

  return {
    cards: {
      reviews_today: cardsRow.reviews_today,
      reviews_week: cardsRow.reviews_week,
      active_users_7d: activeUsers.c ?? 0,
      total_cost_30d: Number((cardsRow.total_cost_30d ?? 0).toFixed(2)),
      avg_elapsed_ms: Math.round(cardsRow.avg_elapsed_ms ?? 0),
      critical_rate: Number((cardsRow.critical_rate ?? 0).toFixed(2))
    },
    reviews_per_day,
    top_users: topUsersRows.map((u) => ({
      user_id: u.user_id,
      email: u.email,
      name: u.name,
      reviews: u.reviews ?? 0,
      avg_findings: Number((u.avg_findings ?? 0).toFixed(1)),
      critical_pct: Number((u.critical_pct ?? 0).toFixed(1)),
      total_cost: Number((u.total_cost ?? 0).toFixed(3)),
      avg_elapsed_ms: Math.round(u.avg_elapsed_ms ?? 0),
      last_activity: u.last_activity ?? null
    })),
    findings_by_severity: [
      { name: "Crítica", value: sevRow.critica ?? 0 },
      { name: "Alta", value: sevRow.alta ?? 0 },
      { name: "Média", value: sevRow.media ?? 0 },
      { name: "Baixa", value: sevRow.baixa ?? 0 }
    ],
    findings_by_tier: [
      { name: "Filing", value: tierRow.tier1_filing ?? 0 },
      { name: "Substantivo", value: tierRow.tier2_substantivo ?? 0 },
      { name: "Estratégico", value: tierRow.tier3_estrategico ?? 0 }
    ],
    top_operations_time,
    token_usage: {
      input: tokenRow.input ?? 0,
      output: tokenRow.output ?? 0,
      cache_creation: tokenRow.cache_creation ?? 0,
      cache_read: tokenRow.cache_read ?? 0,
      total_cost_usd: Number((tokenRow.total_cost_usd ?? 0).toFixed(2))
    },
    recent_errors: errorRows.map(r => ({ operation: r.operation, count: r.count })),
    zero_findings_count: zeroRow.c ?? 0,
    draft_vs_final: {
      draft: draftRow.c ?? 0,
      final: Math.max(0, (totalRow.c ?? 0) - (draftRow.c ?? 0))
    }
  };
}
