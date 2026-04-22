"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, AlertTriangle, DollarSign, FileText } from "lucide-react";

interface Row {
  id: string;
  created_at: string;
  file_name: string;
  client_name: string | null;
  total_findings: number;
  critical_count: number;
  high_count: number;
  elapsed_ms: number;
  estimated_cost_usd: number;
}

export default function HistoricoPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/reviews")
      .then((r) => r.json())
      .then((d) => setRows(d.items ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Histórico de Revisões</h1>
        {loading ? (
          <div className="text-center text-slate-500 py-12">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-slate-500 py-12">Nenhuma revisão ainda.</div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <Link
                key={r.id}
                href={`/app/historico/${r.id}`}
                className="block bg-white rounded-2xl p-5 border border-slate-200 hover:border-govisa-navy transition"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="w-4 h-4 text-slate-500 flex-shrink-0" />
                      <span className="font-semibold text-slate-900 truncate">
                        {r.client_name ?? r.file_name}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 truncate">{r.file_name}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </div>
                  </div>
                  <div className="flex items-center gap-6 ml-4">
                    <Stat
                      icon={<AlertTriangle className="w-4 h-4" />}
                      label="Achados"
                      value={String(r.total_findings)}
                      sub={`${r.critical_count} crítico(s)`}
                      color={r.critical_count > 0 ? "text-red-700" : "text-slate-700"}
                    />
                    <Stat
                      icon={<Clock className="w-4 h-4" />}
                      label="Tempo"
                      value={`${Math.round(r.elapsed_ms / 1000)}s`}
                    />
                    <Stat
                      icon={<DollarSign className="w-4 h-4" />}
                      label="Custo"
                      value={`$${(r.estimated_cost_usd ?? 0).toFixed(3)}`}
                    />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  color = "text-slate-700"
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="text-right">
      <div className="flex items-center gap-1 text-xs text-slate-500 justify-end">
        {icon}
        {label}
      </div>
      <div className={`font-bold ${color}`}>{value}</div>
      {sub ? <div className="text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}
