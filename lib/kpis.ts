import { getDatabase } from "./db";
import { subHours, subDays, startOfMonth, startOfYear, format, eachDayOfInterval } from "date-fns";

export type Period = "24h" | "7d" | "30d" | "mtd" | "ytd";

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

type Dimension = "volume" | "quality" | "efficiency" | "reliability" | "overall";

export interface UserScore {
  user_id: string;
  email: string;
  name: string | null;
  rank: number;
  volume: { reviews: number; pages: number; trend_pct: number; sparkline: number[] };
  quality: { avg_findings: number; critical_pct: number; tier1_per_review: number; zero_findings_count: number };
  efficiency: { avg_elapsed_ms: number; p50_elapsed_ms: number; p95_elapsed_ms: number; total_cost_usd: number; avg_cost_per_review: number };
  reliability: { error_rate: number; retry_rate: number; total_errors: number };
  last_activity: string | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[i];
}

function previousPeriodRange(period: Period): { prevStart: Date; prevEnd: Date } {
  const curStart = periodStart(period);
  const now = new Date();
  const ms = now.getTime() - curStart.getTime();
  return { prevStart: new Date(curStart.getTime() - ms), prevEnd: curStart };
}

export function getUserRanking(period: Period = "30d", dimension: Dimension = "overall"): UserScore[] {
  const d = getDatabase();
  const since = periodStart(period).toISOString();
  const { prevStart, prevEnd } = previousPeriodRange(period);
  const users = d.prepare(`SELECT id, email, name, last_login_at FROM users WHERE active = 1`).all() as any[];
  const sparklineDays = 14;
  const sparklineStart = subDays(new Date(), sparklineDays);

  const results: UserScore[] = users.map((u) => {
    // Volume período atual
    const volRow = d.prepare(`SELECT COUNT(*) as reviews, COALESCE(SUM(num_pages),0) as pages, MAX(created_at) as last_act FROM reviews WHERE user_id = ? AND created_at >= ?`).get(u.id, since) as any;
    const volPrev = d.prepare(`SELECT COUNT(*) as reviews FROM reviews WHERE user_id = ? AND created_at >= ? AND created_at < ?`).get(u.id, prevStart.toISOString(), prevEnd.toISOString()) as any;
    const trend_pct = volPrev.reviews > 0 ? ((volRow.reviews - volPrev.reviews) / volPrev.reviews) * 100 : (volRow.reviews > 0 ? 100 : 0);

    // Sparkline 14d
    const sparkRows = d.prepare(`SELECT substr(created_at,1,10) as date, COUNT(*) as c FROM reviews WHERE user_id = ? AND created_at >= ? GROUP BY substr(created_at,1,10)`).all(u.id, sparklineStart.toISOString()) as any[];
    const sparkMap = new Map(sparkRows.map(r => [r.date, r.c]));
    const sparkline = eachDayOfInterval({ start: sparklineStart, end: new Date() }).map(day => sparkMap.get(format(day, "yyyy-MM-dd")) ?? 0);

    // Qualidade
    const qRow = d.prepare(`SELECT COALESCE(AVG(total_findings),0) as avg_findings,
      COALESCE(SUM(CASE WHEN critical_count > 0 THEN 1.0 ELSE 0.0 END) * 100.0 / NULLIF(COUNT(*),0), 0) as critical_pct,
      COALESCE(AVG(tier1_count),0) as tier1_per_review,
      COALESCE(SUM(CASE WHEN total_findings = 0 THEN 1 ELSE 0 END),0) as zero_findings_count
      FROM reviews WHERE user_id = ? AND created_at >= ?`).get(u.id, since) as any;

    // Eficiência
    const elapsed = (d.prepare(`SELECT elapsed_ms FROM reviews WHERE user_id = ? AND created_at >= ? ORDER BY elapsed_ms`).all(u.id, since) as any[]).map(r => r.elapsed_ms ?? 0);
    const costRow = d.prepare(`SELECT COALESCE(SUM(estimated_cost_usd),0) as total, COALESCE(AVG(estimated_cost_usd),0) as avg FROM reviews WHERE user_id = ? AND created_at >= ?`).get(u.id, since) as any;
    const avg_elapsed_ms = elapsed.length ? elapsed.reduce((s,x)=>s+x,0)/elapsed.length : 0;

    // Confiabilidade (JOIN usage_events)
    const relRow = d.prepare(`SELECT COUNT(*) as total_ops,
      COALESCE(SUM(CASE WHEN e.ok = 0 THEN 1 ELSE 0 END),0) as errors,
      COALESCE(SUM(CASE WHEN e.attempts > 1 THEN 1 ELSE 0 END),0) as retries
      FROM usage_events e JOIN reviews r ON r.id = e.review_id WHERE r.user_id = ? AND r.created_at >= ?`).get(u.id, since) as any;
    const error_rate = relRow.total_ops > 0 ? relRow.errors / relRow.total_ops : 0;
    const retry_rate = relRow.total_ops > 0 ? relRow.retries / relRow.total_ops : 0;

    return {
      user_id: u.id, email: u.email, name: u.name, rank: 0,
      volume: { reviews: volRow.reviews, pages: volRow.pages, trend_pct: Number(trend_pct.toFixed(1)), sparkline },
      quality: {
        avg_findings: Number(qRow.avg_findings.toFixed(1)),
        critical_pct: Number(qRow.critical_pct.toFixed(1)),
        tier1_per_review: Number(qRow.tier1_per_review.toFixed(1)),
        zero_findings_count: qRow.zero_findings_count
      },
      efficiency: {
        avg_elapsed_ms: Math.round(avg_elapsed_ms),
        p50_elapsed_ms: Math.round(percentile(elapsed, 0.5)),
        p95_elapsed_ms: Math.round(percentile(elapsed, 0.95)),
        total_cost_usd: Number(costRow.total.toFixed(3)),
        avg_cost_per_review: Number(costRow.avg.toFixed(3))
      },
      reliability: {
        error_rate: Number(error_rate.toFixed(3)),
        retry_rate: Number(retry_rate.toFixed(3)),
        total_errors: relRow.errors
      },
      last_activity: volRow.last_act ?? u.last_login_at
    };
  });

  // Rank by dimension
  const scoreFn = (s: UserScore): number => {
    if (dimension === "volume") return s.volume.reviews;
    if (dimension === "quality") return -s.quality.critical_pct; // menos crítico = melhor
    if (dimension === "efficiency") return -s.efficiency.avg_elapsed_ms; // mais rápido = melhor
    if (dimension === "reliability") return -s.reliability.error_rate; // menos erro = melhor
    // overall = normalizado soma de cada dim
    return s.volume.reviews - s.quality.critical_pct - s.efficiency.avg_elapsed_ms/10000 - s.reliability.error_rate*100;
  };
  results.sort((a, b) => scoreFn(b) - scoreFn(a));
  results.forEach((r, i) => r.rank = i + 1);
  return results;
}

export interface TeamBenchmark {
  reviews: { p25: number; p50: number; p75: number; p90: number };
  avg_findings: { p25: number; p50: number; p75: number; p90: number };
  critical_pct: { p25: number; p50: number; p75: number; p90: number };
  avg_elapsed_ms: { p25: number; p50: number; p75: number; p90: number };
  error_rate: { p25: number; p50: number; p75: number; p90: number };
}

export function getTeamBenchmark(period: Period = "30d"): TeamBenchmark {
  const ranking = getUserRanking(period, "overall");
  const nonZero = ranking.filter(r => r.volume.reviews > 0);
  const pc = (arr: number[]) => {
    const sorted = arr.slice().sort((a, b) => a - b);
    return { p25: percentile(sorted, 0.25), p50: percentile(sorted, 0.5), p75: percentile(sorted, 0.75), p90: percentile(sorted, 0.9) };
  };
  return {
    reviews: pc(nonZero.map(r => r.volume.reviews)),
    avg_findings: pc(nonZero.map(r => r.quality.avg_findings)),
    critical_pct: pc(nonZero.map(r => r.quality.critical_pct)),
    avg_elapsed_ms: pc(nonZero.map(r => r.efficiency.avg_elapsed_ms)),
    error_rate: pc(nonZero.map(r => r.reliability.error_rate))
  };
}

export interface UserDeepDive {
  user: { id: string; email: string; name: string | null; role: string; created_at: string; last_login_at: string | null };
  period: { from: string; to: string; previous_from: string; previous_to: string };
  cards: {
    reviews: { value: number; delta_pct: number };
    avg_findings: { value: number; delta_pct: number; team_p50: number; team_p75: number };
    critical_pct: { value: number; delta_pct: number; team_p50: number };
    avg_elapsed_ms: { value: number; delta_pct: number; team_p50: number };
    total_cost: { value: number; delta_pct: number };
    error_rate: { value: number; delta_pct: number; team_avg: number };
  };
  reviews_per_day: Array<{ date: string; count: number; cost_usd: number }>;
  findings_per_review_trend: Array<{ date: string; avg_findings: number }>;
  severity_breakdown: Array<{ name: string; value: number }>;
  tier_breakdown: Array<{ name: string; value: number }>;
  case_type_breakdown: Array<{ name: string; value: number }>;
  draft_vs_final: { draft: number; final: number };
  top_errors: Array<{ operation: string; count: number; sample_error: string | null }>;
  recent_reviews: Array<{ id: string; created_at: string; client_name: string | null; file_name: string; total_findings: number; critical_count: number; elapsed_ms: number; case_type: string | null }>;
  team_ranking: { overall: number; total: number; by_dimension: { volume: number; quality: number; efficiency: number; reliability: number } };
}

export function getUserDeepDive(userId: string, period: Period = "30d"): UserDeepDive | null {
  const d = getDatabase();
  const user = d.prepare(`SELECT id, email, name, role, created_at, last_login_at FROM users WHERE id = ?`).get(userId) as any;
  if (!user) return null;

  const curStart = periodStart(period);
  const { prevStart, prevEnd } = previousPeriodRange(period);
  const since = curStart.toISOString();
  const now = new Date();

  const delta = (cur: number, prev: number) => prev > 0 ? ((cur - prev) / prev) * 100 : (cur > 0 ? 100 : 0);

  const cur = d.prepare(`SELECT COUNT(*) as c, COALESCE(AVG(total_findings),0) as af,
    COALESCE(SUM(CASE WHEN critical_count > 0 THEN 1.0 ELSE 0.0 END)*100.0/NULLIF(COUNT(*),0),0) as cp,
    COALESCE(AVG(elapsed_ms),0) as ae, COALESCE(SUM(estimated_cost_usd),0) as tc
    FROM reviews WHERE user_id = ? AND created_at >= ?`).get(userId, since) as any;
  const prev = d.prepare(`SELECT COUNT(*) as c, COALESCE(AVG(total_findings),0) as af,
    COALESCE(SUM(CASE WHEN critical_count > 0 THEN 1.0 ELSE 0.0 END)*100.0/NULLIF(COUNT(*),0),0) as cp,
    COALESCE(AVG(elapsed_ms),0) as ae, COALESCE(SUM(estimated_cost_usd),0) as tc
    FROM reviews WHERE user_id = ? AND created_at >= ? AND created_at < ?`).get(userId, prevStart.toISOString(), prevEnd.toISOString()) as any;

  const relCur = d.prepare(`SELECT COUNT(*) as t, SUM(CASE WHEN e.ok=0 THEN 1 ELSE 0 END) as err FROM usage_events e JOIN reviews r ON r.id=e.review_id WHERE r.user_id=? AND r.created_at>=?`).get(userId, since) as any;
  const relPrev = d.prepare(`SELECT COUNT(*) as t, SUM(CASE WHEN e.ok=0 THEN 1 ELSE 0 END) as err FROM usage_events e JOIN reviews r ON r.id=e.review_id WHERE r.user_id=? AND r.created_at>=? AND r.created_at<?`).get(userId, prevStart.toISOString(), prevEnd.toISOString()) as any;

  const curErrorRate = relCur.t > 0 ? (relCur.err ?? 0) / relCur.t : 0;
  const prevErrorRate = relPrev.t > 0 ? (relPrev.err ?? 0) / relPrev.t : 0;

  const bench = getTeamBenchmark(period);
  const ranking = getUserRanking(period, "overall");
  const rankingVol = getUserRanking(period, "volume");
  const rankingQual = getUserRanking(period, "quality");
  const rankingEff = getUserRanking(period, "efficiency");
  const rankingRel = getUserRanking(period, "reliability");
  const findIdx = (arr: UserScore[]) => (arr.findIndex(r => r.user_id === userId) + 1) || 0;

  const perDayRaw = d.prepare(`SELECT substr(created_at,1,10) as date, COUNT(*) as c, COALESCE(SUM(estimated_cost_usd),0) as cost FROM reviews WHERE user_id=? AND created_at>=? GROUP BY substr(created_at,1,10)`).all(userId, since) as any[];
  const byDate = new Map(perDayRaw.map(r => [r.date, r]));
  const reviews_per_day = eachDayOfInterval({ start: curStart, end: now }).map(day => {
    const key = format(day, "yyyy-MM-dd");
    const row = byDate.get(key);
    return { date: format(day, "dd/MM"), count: row?.c ?? 0, cost_usd: Number((row?.cost ?? 0).toFixed(4)) };
  });

  const findingsTrendRaw = d.prepare(`SELECT substr(created_at,1,10) as date, AVG(total_findings) as af FROM reviews WHERE user_id=? AND created_at>=? GROUP BY substr(created_at,1,10)`).all(userId, since) as any[];
  const trendMap = new Map(findingsTrendRaw.map(r => [r.date, r.af]));
  const findings_per_review_trend = eachDayOfInterval({ start: curStart, end: now }).map(day => {
    const key = format(day, "yyyy-MM-dd");
    return { date: format(day, "dd/MM"), avg_findings: Number((trendMap.get(key) ?? 0).toFixed(1)) };
  });

  const sev = d.prepare(`SELECT SUM(critical_count) as c, SUM(high_count) as h, SUM(medium_count) as m, SUM(low_count) as l FROM reviews WHERE user_id=? AND created_at>=?`).get(userId, since) as any;
  const tier = d.prepare(`SELECT SUM(tier1_count) as t1, SUM(tier2_count) as t2, SUM(tier3_count) as t3 FROM reviews WHERE user_id=? AND created_at>=?`).get(userId, since) as any;

  const caseTypeRows = d.prepare(`SELECT COALESCE(case_type,'n/a') as ct, COUNT(*) as c FROM reviews WHERE user_id=? AND created_at>=? GROUP BY case_type`).all(userId, since) as any[];

  const draftCount = (d.prepare(`SELECT COUNT(*) as c FROM reviews WHERE user_id=? AND created_at>=? AND report_json LIKE '%Assinaturas (modo draft)%'`).get(userId, since) as any).c;
  const totalCount = cur.c;

  const errorsRows = d.prepare(`SELECT e.operation, COUNT(*) as c, MAX(e.error) as sample_error FROM usage_events e JOIN reviews r ON r.id=e.review_id WHERE r.user_id=? AND r.created_at>=? AND e.ok=0 GROUP BY e.operation ORDER BY c DESC LIMIT 10`).all(userId, since) as any[];

  const recent = d.prepare(`SELECT id, created_at, client_name, file_name, total_findings, critical_count, elapsed_ms, case_type FROM reviews WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).all(userId) as any[];

  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role, created_at: user.created_at, last_login_at: user.last_login_at },
    period: { from: curStart.toISOString(), to: now.toISOString(), previous_from: prevStart.toISOString(), previous_to: prevEnd.toISOString() },
    cards: {
      reviews: { value: cur.c, delta_pct: Number(delta(cur.c, prev.c).toFixed(1)) },
      avg_findings: { value: Number(cur.af.toFixed(1)), delta_pct: Number(delta(cur.af, prev.af).toFixed(1)), team_p50: bench.avg_findings.p50, team_p75: bench.avg_findings.p75 },
      critical_pct: { value: Number(cur.cp.toFixed(1)), delta_pct: Number(delta(cur.cp, prev.cp).toFixed(1)), team_p50: bench.critical_pct.p50 },
      avg_elapsed_ms: { value: Math.round(cur.ae), delta_pct: Number(delta(cur.ae, prev.ae).toFixed(1)), team_p50: bench.avg_elapsed_ms.p50 },
      total_cost: { value: Number(cur.tc.toFixed(2)), delta_pct: Number(delta(cur.tc, prev.tc).toFixed(1)) },
      error_rate: { value: Number(curErrorRate.toFixed(3)), delta_pct: Number(delta(curErrorRate, prevErrorRate).toFixed(1)), team_avg: bench.error_rate.p50 }
    },
    reviews_per_day,
    findings_per_review_trend,
    severity_breakdown: [
      { name: "Crítica", value: sev.c ?? 0 },
      { name: "Alta", value: sev.h ?? 0 },
      { name: "Média", value: sev.m ?? 0 },
      { name: "Baixa", value: sev.l ?? 0 }
    ],
    tier_breakdown: [
      { name: "Filing", value: tier.t1 ?? 0 },
      { name: "Substantivo", value: tier.t2 ?? 0 },
      { name: "Estratégico", value: tier.t3 ?? 0 }
    ],
    case_type_breakdown: caseTypeRows.map(r => ({ name: r.ct === "t_visa" ? "T-visa" : r.ct === "vawa" ? "VAWA" : r.ct === "u_visa" ? "U-visa" : r.ct, value: r.c })),
    draft_vs_final: { draft: draftCount, final: Math.max(0, totalCount - draftCount) },
    top_errors: errorsRows.map(e => ({ operation: e.operation, count: e.c, sample_error: e.sample_error ?? null })),
    recent_reviews: recent.map(r => ({ id: r.id, created_at: r.created_at, client_name: r.client_name, file_name: r.file_name, total_findings: r.total_findings, critical_count: r.critical_count, elapsed_ms: r.elapsed_ms, case_type: r.case_type })),
    team_ranking: {
      overall: findIdx(ranking),
      total: ranking.length,
      by_dimension: {
        volume: findIdx(rankingVol),
        quality: findIdx(rankingQual),
        efficiency: findIdx(rankingEff),
        reliability: findIdx(rankingRel)
      }
    }
  };
}
