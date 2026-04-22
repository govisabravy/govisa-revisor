"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, AlertTriangle, DollarSign, FileText, User } from "lucide-react";

interface Row {
  id: string;
  created_at: string;
  file_name: string;
  client_name: string | null;
  total_findings: number;
  critical_count: number;
  elapsed_ms: number;
  estimated_cost_usd: number;
  user_id: string | null;
}

interface UserLite { id: string; email: string; name: string | null; }

export default function AllRevisoes() {
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<Map<string, UserLite>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/users").then(r => r.json()),
      fetch("/api/reviews?all=1").then(r => r.json())
    ]).then(([u, r]) => {
      const map = new Map<string, UserLite>();
      for (const x of (u.items ?? [])) map.set(x.id, x);
      setUsers(map);
      setRows(r.items ?? []);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Todas as revisões</h1>
        {loading ? (
          <div className="text-center text-slate-500 py-12">Carregando...</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-slate-500 py-12">Nenhuma revisão.</div>
        ) : (
          <div className="space-y-2">
            {rows.map(r => {
              const u = r.user_id ? users.get(r.user_id) : null;
              return (
                <Link key={r.id} href={`/admin/revisoes/${r.id}`}
                  className="block bg-white rounded-xl p-4 border border-slate-200 hover:border-govisa-navy">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-slate-500" />
                        <span className="font-semibold text-slate-900 truncate">{r.client_name ?? r.file_name}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-3">
                        <span className="flex items-center gap-1"><User className="w-3 h-3" /> {u?.email ?? "—"}</span>
                        <span>{new Date(r.created_at).toLocaleString("pt-BR")}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-600">
                      <div className="flex items-center gap-1"><AlertTriangle className={`w-3 h-3 ${r.critical_count > 0 ? "text-red-600" : ""}`} /> <span className="font-semibold">{r.total_findings}</span></div>
                      <div className="flex items-center gap-1"><Clock className="w-3 h-3" /> {Math.round(r.elapsed_ms/1000)}s</div>
                      <div className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> ${(r.estimated_cost_usd ?? 0).toFixed(3)}</div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
