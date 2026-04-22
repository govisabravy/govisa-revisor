"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Metric } from "@/components/ui/Metric";
import { AreaChart } from "@/components/ui/AreaChart";
import { BarChart } from "@/components/ui/BarChart";
import { DonutChart } from "@/components/ui/DonutChart";
import { BarList } from "@/components/ui/BarList";
import { Activity, Users, DollarSign, Clock, AlertTriangle, TrendingUp } from "lucide-react";

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

export default function AdminDashboard() {
  const [period, setPeriod] = useState("30d");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    fetch(`/api/admin/kpis?period=${period}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-sm text-slate-500">Visão geral das revisões da equipe</p>
          </div>
          <select value={period} onChange={(e) => setPeriod(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm">
            {PERIODS.map(p => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
        </div>

        {err && <Card className="text-red-700 bg-red-50 border-red-300">{err}</Card>}
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
                <div className="mb-3"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Revisões por dia</div></div>
                <AreaChart data={data.reviews_per_day} index="date" categories={["count"]} colors={["blue"]} />
              </Card>
              <Card>
                <div className="mb-3"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Custo por dia (USD)</div></div>
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
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Top usuários</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3 text-left font-semibold">Email</th>
                      <th className="py-2 px-3 text-right font-semibold">Revisões</th>
                      <th className="py-2 px-3 text-right font-semibold">Méd. findings</th>
                      <th className="py-2 px-3 text-right font-semibold">% críticos</th>
                      <th className="py-2 px-3 text-right font-semibold">Custo</th>
                      <th className="py-2 px-3 text-right font-semibold">Tempo médio</th>
                      <th className="py-2 px-3 text-left font-semibold">Última atividade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.top_users.map((u: any) => (
                      <tr key={u.user_id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-medium text-slate-900">{u.email}</td>
                        <td className="py-2 px-3 text-right">{u.reviews}</td>
                        <td className="py-2 px-3 text-right">{u.avg_findings}</td>
                        <td className="py-2 px-3 text-right">{u.critical_pct}%</td>
                        <td className="py-2 px-3 text-right">${u.total_cost.toFixed(3)}</td>
                        <td className="py-2 px-3 text-right">{fmtSec(u.avg_elapsed_ms)}</td>
                        <td className="py-2 px-3 text-xs text-slate-500">{u.last_activity ? new Date(u.last_activity).toLocaleString("pt-BR") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
