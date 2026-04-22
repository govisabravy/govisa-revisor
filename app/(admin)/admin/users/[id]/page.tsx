"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Award, AlertTriangle, Clock, DollarSign, TrendingUp, User } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Metric } from "@/components/ui/Metric";
import { AreaChart } from "@/components/ui/AreaChart";
import { BarChart } from "@/components/ui/BarChart";
import { DonutChart } from "@/components/ui/DonutChart";
import { BarList } from "@/components/ui/BarList";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { PercentileBadge } from "@/components/ui/PercentileBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";

const PERIODS = [
  { v: "24h", l: "24h" },
  { v: "7d", l: "7 dias" },
  { v: "30d", l: "30 dias" },
  { v: "mtd", l: "Mês atual" },
  { v: "ytd", l: "Ano atual" }
];

const fmtUSD = (v: number) => `$${(v ?? 0).toFixed(2)}`;
const fmtSec = (ms: number) => `${Math.round((ms ?? 0) / 1000)}s`;
const fmtPct = (v: number) => `${(v ?? 0).toFixed(1)}%`;

function initials(name: string | null, email: string): string {
  if (name) return name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

export default function UserDeepDive() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState(searchParams.get("period") ?? "30d");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    fetch(`/api/admin/users/${params.id}/deep-dive?period=${period}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [params.id, period]);

  if (loading && !data) return <div className="p-12 text-center text-slate-500">Carregando...</div>;
  if (err) return <div className="p-12 text-center text-rose-600">Erro: {err}</div>;
  if (!data) return null;

  const u = data.user;
  const c = data.cards;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <Link href="/admin" className="text-slate-500 hover:text-slate-900">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="w-12 h-12 rounded-full bg-govisa-navy text-white flex items-center justify-center font-bold">
              {initials(u.name, u.email)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900 truncate">{u.name ?? u.email}</h1>
                <span className={`text-xs px-2 py-0.5 rounded font-semibold ${u.role === "admin" ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>
                  {u.role}
                </span>
              </div>
              <div className="text-sm text-slate-500 truncate">{u.email}</div>
            </div>
          </div>
          <select value={period} onChange={(e) => setPeriod(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm">
            {PERIODS.map(p => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
        </div>

        <Card>
          <div className="flex items-center gap-3 mb-2">
            <Award className="w-5 h-5 text-amber-500" />
            <div className="font-semibold text-slate-900">Ranking no time</div>
            <div className="text-xs text-slate-500">#{data.team_ranking.overall} de {data.team_ranking.total} colaboradores</div>
          </div>
          <ProgressBar value={data.team_ranking.total - data.team_ranking.overall + 1} max={data.team_ranking.total} label="Posição geral" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            {[
              { l: "Volume", v: data.team_ranking.by_dimension.volume },
              { l: "Qualidade", v: data.team_ranking.by_dimension.quality },
              { l: "Eficiência", v: data.team_ranking.by_dimension.efficiency },
              { l: "Confiabilidade", v: data.team_ranking.by_dimension.reliability }
            ].map(d => (
              <div key={d.l} className="bg-slate-50 rounded-lg p-2 text-center">
                <div className="text-xs text-slate-500">{d.l}</div>
                <div className="font-bold text-slate-900">#{d.v}</div>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCardWithDelta label="Revisões" value={c.reviews.value} delta={c.reviews.delta_pct} icon={<TrendingUp className="w-4 h-4" />} />
          <MetricCardWithDelta label="Méd. findings" value={c.avg_findings.value} delta={c.avg_findings.delta_pct} icon={<AlertTriangle className="w-4 h-4" />} footer={`Time p50: ${c.avg_findings.team_p50.toFixed(1)}`} />
          <MetricCardWithDelta label="% críticos" value={fmtPct(c.critical_pct.value)} delta={c.critical_pct.delta_pct} invertDelta icon={<AlertTriangle className="w-4 h-4" />} footer={`Time p50: ${fmtPct(c.critical_pct.team_p50)}`} />
          <MetricCardWithDelta label="Tempo médio" value={fmtSec(c.avg_elapsed_ms.value)} delta={c.avg_elapsed_ms.delta_pct} invertDelta icon={<Clock className="w-4 h-4" />} footer={`Time p50: ${fmtSec(c.avg_elapsed_ms.team_p50)}`} />
          <MetricCardWithDelta label="Custo total" value={fmtUSD(c.total_cost.value)} delta={c.total_cost.delta_pct} icon={<DollarSign className="w-4 h-4" />} />
          <MetricCardWithDelta label="Taxa de erros" value={fmtPct(c.error_rate.value * 100)} delta={c.error_rate.delta_pct} invertDelta icon={<AlertTriangle className="w-4 h-4" />} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Revisões por dia</div>
            <AreaChart data={data.reviews_per_day} index="date" categories={["count"]} colors={["blue"]} />
          </Card>
          <Card>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Findings médios por revisão</div>
            <AreaChart data={data.findings_per_review_trend} index="date" categories={["avg_findings"]} colors={["amber"]} />
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Severidade</div>
            <DonutChart data={data.severity_breakdown} />
          </Card>
          <Card>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Tier</div>
            <DonutChart data={data.tier_breakdown} />
          </Card>
          <Card>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Case type</div>
            <DonutChart data={data.case_type_breakdown} />
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Draft vs Final</div>
            <BarList data={[
              { name: "Draft (pré-cliente)", value: data.draft_vs_final.draft },
              { name: "Final (pré-protocolo)", value: data.draft_vs_final.final }
            ]} />
          </Card>
          <Card>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Erros técnicos por operação</div>
            <BarList data={data.top_errors.map((e: any) => ({ name: e.operation, value: e.count }))} color="#f43f5e" />
          </Card>
        </div>

        <Card>
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Revisões recentes</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3 text-left font-semibold">Data</th>
                  <th className="py-2 px-3 text-left font-semibold">Cliente</th>
                  <th className="py-2 px-3 text-left font-semibold">Arquivo</th>
                  <th className="py-2 px-3 text-left font-semibold">Tipo</th>
                  <th className="py-2 px-3 text-right font-semibold">Findings</th>
                  <th className="py-2 px-3 text-right font-semibold">Críticos</th>
                  <th className="py-2 px-3 text-right font-semibold">Tempo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recent_reviews.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2 px-3 text-xs text-slate-500">{new Date(r.created_at).toLocaleString("pt-BR")}</td>
                    <td className="py-2 px-3 font-medium text-slate-900 truncate max-w-[200px]">{r.client_name ?? "—"}</td>
                    <td className="py-2 px-3 text-xs text-slate-500 truncate max-w-[250px]">{r.file_name}</td>
                    <td className="py-2 px-3 text-xs">
                      {r.case_type && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded">{r.case_type === "t_visa" ? "T" : r.case_type === "vawa" ? "VAWA" : "U"}</span>}
                    </td>
                    <td className="py-2 px-3 text-right">{r.total_findings}</td>
                    <td className={`py-2 px-3 text-right ${r.critical_count > 0 ? "text-rose-700 font-semibold" : ""}`}>{r.critical_count}</td>
                    <td className="py-2 px-3 text-right">{fmtSec(r.elapsed_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.recent_reviews.length === 0 && <div className="text-center text-slate-400 py-8">Sem revisões no período</div>}
          </div>
        </Card>
      </div>
    </main>
  );
}

function MetricCardWithDelta({ label, value, delta, invertDelta, icon, footer }: { label: string; value: string | number; delta: number; invertDelta?: boolean; icon?: React.ReactNode; footer?: string }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        {icon && <div className="text-slate-400">{icon}</div>}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
      <div className="mt-2 flex items-center gap-2">
        <DeltaBadge value={delta} invertColor={invertDelta} />
      </div>
      {footer && <div className="text-[10px] text-slate-400 mt-1">{footer}</div>}
    </div>
  );
}
