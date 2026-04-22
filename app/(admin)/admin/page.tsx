"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Metric } from "@/components/ui/Metric";
import { AreaChart } from "@/components/ui/AreaChart";
import { BarChart } from "@/components/ui/BarChart";
import { DonutChart } from "@/components/ui/DonutChart";
import { BarList } from "@/components/ui/BarList";
import { Sparkline } from "@/components/ui/Sparkline";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { PercentileBadge } from "@/components/ui/PercentileBadge";
import { Activity, Users, DollarSign, Clock, AlertTriangle, TrendingUp, ExternalLink } from "lucide-react";

const PERIODS = [
  { v: "24h", l: "24h" },
  { v: "7d", l: "7 dias" },
  { v: "30d", l: "30 dias" },
  { v: "mtd", l: "Mês atual" },
  { v: "ytd", l: "Ano atual" }
];

const fmtUSD = (v: number) => `$${(v ?? 0).toFixed(2)}`;
const fmtSec = (ms: number) => `${Math.round((ms ?? 0) / 1000)}s`;
const fmtPct = (v: number) => `${(v ?? 0) > 1 ? (v ?? 0).toFixed(0) : Math.round((v ?? 0) * 100)}%`;

type SortKey = "rank" | "reviews" | "avg_findings" | "critical_pct" | "avg_elapsed_ms" | "total_cost" | "error_rate";

export default function AdminDashboard() {
  const [period, setPeriod] = useState("30d");
  const [data, setData] = useState<any>(null);
  const [ranking, setRanking] = useState<any[]>([]);
  const [benchmark, setBenchmark] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    setLoading(true);
    setErr(null);
    Promise.all([
      fetch(`/api/admin/kpis?period=${period}`).then(r => { if (!r.ok) throw new Error("kpis"); return r.json(); }),
      fetch(`/api/admin/users/ranking?period=${period}&dimension=overall`).then(r => { if (!r.ok) throw new Error("ranking"); return r.json(); }),
      fetch(`/api/admin/team-benchmark?period=${period}`).then(r => { if (!r.ok) throw new Error("bench"); return r.json(); })
    ])
      .then(([k, rk, b]) => {
        setData(k);
        setRanking(rk.items ?? []);
        setBenchmark(b);
      })
      .catch(e => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [period]);

  const sortedRanking = [...ranking].sort((a, b) => {
    const getV = (u: any) => {
      switch (sortKey) {
        case "rank": return u.rank;
        case "reviews": return u.volume.reviews;
        case "avg_findings": return u.quality.avg_findings;
        case "critical_pct": return u.quality.critical_pct;
        case "avg_elapsed_ms": return u.efficiency.avg_elapsed_ms;
        case "total_cost": return u.efficiency.total_cost_usd;
        case "error_rate": return u.reliability.error_rate;
      }
    };
    const va = getV(a), vb = getV(b);
    return sortDir === "asc" ? va - vb : vb - va;
  });

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "rank" ? "asc" : "desc"); }
  }

  function rowClass(rank: number, total: number): string {
    const top10 = Math.max(1, Math.ceil(total * 0.1));
    const bottom10 = total - top10 + 1;
    if (rank <= top10) return "bg-emerald-50/40";
    if (rank >= bottom10 && total > 3) return "bg-rose-50/40";
    return "";
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-sm text-slate-500">Performance da equipe</p>
          </div>
          <select value={period} onChange={(e) => setPeriod(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm">
            {PERIODS.map(p => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
        </div>

        {err && <Card className="text-rose-700 bg-rose-50 border-rose-300">{err}</Card>}
        {loading && !data ? (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({length: 6}).map((_, i) => <div key={i} className="h-24 rounded-2xl bg-white border border-slate-200 animate-pulse" />)}
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <Metric label="Revisões hoje" value={data.cards.reviews_today} icon={<Activity className="w-4 h-4" />} />
              <Metric label="Revisões 7d" value={data.cards.reviews_week} icon={<TrendingUp className="w-4 h-4" />} />
              <Metric label="Usuários ativos 7d" value={data.cards.active_users_7d} icon={<Users className="w-4 h-4" />} />
              <Metric label="Custo 30d" value={fmtUSD(data.cards.total_cost_30d)} icon={<DollarSign className="w-4 h-4" />} />
              <Metric label="Tempo médio" value={fmtSec(data.cards.avg_elapsed_ms)} icon={<Clock className="w-4 h-4" />} />
              <Metric label="% críticos" value={fmtPct(data.cards.critical_rate)} icon={<AlertTriangle className="w-4 h-4" />} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Revisões por dia</div>
                <AreaChart data={data.reviews_per_day} index="date" categories={["count"]} colors={["blue"]} />
              </Card>
              <Card>
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Custo por dia (USD)</div>
                <AreaChart data={data.reviews_per_day} index="date" categories={["cost_usd"]} colors={["emerald"]} valueFormatter={fmtUSD} />
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card>
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Severidade</div>
                <DonutChart data={data.findings_by_severity} />
              </Card>
              <Card>
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Tier</div>
                <DonutChart data={data.findings_by_tier} />
              </Card>
              <Card>
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Draft vs Final</div>
                <BarList data={[
                  { name: "Draft (pré-cliente)", value: data.draft_vs_final.draft },
                  { name: "Final (pré-protocolo)", value: data.draft_vs_final.final }
                ]} />
              </Card>
            </div>

            <Card>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-lg font-bold text-slate-900">Ranking de colaboradores</div>
                  <div className="text-xs text-slate-500">Clique em qualquer colaborador para ver o deep dive</div>
                </div>
                <div className="text-xs text-slate-500">
                  <span className="inline-block w-3 h-3 bg-emerald-50 border border-emerald-200 rounded-sm mr-1 align-middle" />Top 10%
                  <span className="inline-block w-3 h-3 bg-rose-50 border border-rose-200 rounded-sm ml-3 mr-1 align-middle" />Bottom 10%
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <tr>
                      <SortableTh active={sortKey === "rank"} dir={sortDir} onClick={() => toggleSort("rank")}>#</SortableTh>
                      <th className="py-2 px-3 text-left font-semibold">Colaborador</th>
                      <SortableTh active={sortKey === "reviews"} dir={sortDir} onClick={() => toggleSort("reviews")} align="right">Volume</SortableTh>
                      <th className="py-2 px-3 text-left font-semibold">Tendência 14d</th>
                      <SortableTh active={sortKey === "avg_findings"} dir={sortDir} onClick={() => toggleSort("avg_findings")} align="right">Méd findings</SortableTh>
                      <SortableTh active={sortKey === "critical_pct"} dir={sortDir} onClick={() => toggleSort("critical_pct")} align="right">% críticos</SortableTh>
                      <SortableTh active={sortKey === "avg_elapsed_ms"} dir={sortDir} onClick={() => toggleSort("avg_elapsed_ms")} align="right">Tempo médio</SortableTh>
                      <SortableTh active={sortKey === "total_cost"} dir={sortDir} onClick={() => toggleSort("total_cost")} align="right">Custo</SortableTh>
                      <SortableTh active={sortKey === "error_rate"} dir={sortDir} onClick={() => toggleSort("error_rate")} align="right">Erros</SortableTh>
                      <th className="py-2 px-3 text-left font-semibold">Última atividade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sortedRanking.map((u: any) => (
                      <tr key={u.user_id} className={`hover:bg-slate-50 ${rowClass(u.rank, ranking.length)}`}>
                        <td className="py-2 px-3 font-bold text-slate-900">{u.rank}</td>
                        <td className="py-2 px-3">
                          <Link href={`/admin/users/${u.user_id}?period=${period}`} className="flex items-center gap-1 text-slate-900 hover:text-govisa-navy font-medium">
                            {u.email}
                            <ExternalLink className="w-3 h-3 text-slate-400" />
                          </Link>
                          {u.name && <div className="text-xs text-slate-500">{u.name}</div>}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="font-semibold">{u.volume.reviews}</span>
                            <DeltaBadge value={u.volume.trend_pct} />
                          </div>
                          <div className="text-[10px] text-slate-400">{u.volume.pages} pgs</div>
                        </td>
                        <td className="py-2 px-3">
                          <Sparkline data={u.volume.sparkline} color="#3b82f6" />
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="font-semibold">{u.quality.avg_findings}</span>
                            {benchmark && <PercentileBadge value={u.quality.avg_findings} benchmark={benchmark.avg_findings} />}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className={u.quality.critical_pct >= 50 ? "text-rose-700 font-semibold" : ""}>{u.quality.critical_pct.toFixed(1)}%</span>
                            {benchmark && <PercentileBadge value={u.quality.critical_pct} benchmark={benchmark.critical_pct} invertColor />}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span>{fmtSec(u.efficiency.avg_elapsed_ms)}</span>
                            {benchmark && <PercentileBadge value={u.efficiency.avg_elapsed_ms} benchmark={benchmark.avg_elapsed_ms} invertColor />}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right">{fmtUSD(u.efficiency.total_cost_usd)}</td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className={u.reliability.error_rate > 0.05 ? "text-rose-700 font-semibold" : ""}>{(u.reliability.error_rate * 100).toFixed(1)}%</span>
                          </div>
                          {u.reliability.total_errors > 0 && <div className="text-[10px] text-slate-400">{u.reliability.total_errors} erros</div>}
                        </td>
                        <td className="py-2 px-3 text-xs text-slate-500">{u.last_activity ? new Date(u.last_activity).toLocaleString("pt-BR") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {ranking.length === 0 && <div className="text-center text-slate-400 py-8">Nenhum colaborador ativo</div>}
              </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Tempo médio por operação</div>
                <BarChart
                  data={data.top_operations_time}
                  index="operation"
                  categories={["avg_ms"]}
                  colors={["indigo"]}
                  layout="vertical"
                  valueFormatter={(v) => `${Math.round(v)}ms`}
                  height={Math.max(240, (data.top_operations_time?.length ?? 0) * 28)}
                />
              </Card>
              <Card>
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Erros por operação</div>
                <BarList data={data.recent_errors.map((e: any) => ({ name: e.operation, value: e.count }))} color="#f43f5e" />
              </Card>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}

function SortableTh({ children, active, dir, onClick, align = "left" }: { children: React.ReactNode; active: boolean; dir: "asc" | "desc"; onClick: () => void; align?: "left" | "right" }) {
  return (
    <th className={`py-2 px-3 font-semibold cursor-pointer select-none ${align === "right" ? "text-right" : "text-left"} ${active ? "text-govisa-navy" : ""}`} onClick={onClick}>
      <span className="inline-flex items-center gap-1">
        {children}
        {active && <span className="text-[9px]">{dir === "asc" ? "▲" : "▼"}</span>}
      </span>
    </th>
  );
}
