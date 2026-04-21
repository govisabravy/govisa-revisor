"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReviewReportView from "@/components/ReviewReport";
import { ArrowLeft, Clock, DollarSign, Hash } from "lucide-react";

export default function HistoricoDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/reviews/${params.id}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="p-12 text-center text-slate-500">Carregando...</div>;
  if (!data || data.error) return <div className="p-12 text-center text-red-600">Revisão não encontrada.</div>;

  const meta = data.meta;

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-govisa-navy text-white py-5 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">{meta.client_name ?? meta.file_name}</h1>
          <Link
            href="/historico"
            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </Link>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-2xl p-5 border border-slate-200">
          <div className="grid grid-cols-4 gap-4 text-sm">
            <MetaItem icon={<Hash className="w-4 h-4" />} label="Review ID" value={meta.id.slice(0, 8)} />
            <MetaItem
              icon={<Clock className="w-4 h-4" />}
              label="Processado em"
              value={`${Math.round(meta.elapsed_ms / 1000)}s`}
              sub={new Date(meta.created_at).toLocaleString("pt-BR")}
            />
            <MetaItem
              icon={<DollarSign className="w-4 h-4" />}
              label="Custo"
              value={`$${Number(meta.estimated_cost_usd ?? 0).toFixed(3)}`}
              sub={`${meta.total_input_tokens.toLocaleString()} in / ${meta.total_output_tokens.toLocaleString()} out`}
            />
            <MetaItem
              icon={<Hash className="w-4 h-4" />}
              label="Páginas"
              value={String(meta.num_pages)}
              sub={`${meta.forms_detected.length} forms`}
            />
          </div>
        </div>

        <ReviewReportView report={data.report} />

        <details className="bg-white rounded-2xl p-5 border border-slate-200">
          <summary className="font-semibold cursor-pointer">Telemetria por operação</summary>
          <div className="mt-4 space-y-2 text-xs">
            {(meta.usage_events ?? []).map((e: any, i: number) => (
              <div key={i} className="flex justify-between border-b border-slate-100 py-2">
                <span className="font-mono">{e.operation}</span>
                <span className="text-slate-500">
                  {e.input_tokens} in / {e.output_tokens} out · {Math.round(e.duration_ms)}ms · {e.attempts}x
                  {!e.ok ? " · FAIL" : ""}
                </span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </main>
  );
}

function MetaItem({
  icon,
  label,
  value,
  sub
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <div className="font-bold text-slate-900">{value}</div>
      {sub ? <div className="text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}
