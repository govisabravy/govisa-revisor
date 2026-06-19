"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReviewReportView from "@/components/ReviewReport";
import { ArrowLeft, Clock, DollarSign, Hash, User, FileDown } from "lucide-react";

export default function AdminRevisaoDetail() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/reviews/${params.id}`)
      .then(r => r.json())
      .then(async (d) => {
        setData(d);
        if (d?.meta?.user_id) {
          const u = await fetch("/api/admin/users").then(r => r.json());
          const found = (u.items ?? []).find((x: any) => x.id === d.meta.user_id);
          setUserInfo(found);
        }
      })
      .finally(() => setLoading(false));
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (u?.id) setCurrentUserId(u.id);
      })
      .catch(() => {});
  }, [params.id]);

  if (loading) return <div className="p-12 text-center text-slate-500">Carregando...</div>;
  if (!data || data.error) return <div className="p-12 text-center text-red-600">Não encontrado.</div>;
  const meta = data.meta;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{meta.client_name ?? meta.file_name}</h1>
            <div className="text-sm text-slate-500 mt-1 flex items-center gap-2"><User className="w-3 h-3" /> {userInfo?.email ?? "—"}</div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/reviews/${params.id}/pdf`}
              download
              className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm hover:bg-slate-50"
            >
              <FileDown className="w-4 h-4" /> Baixar PDF
            </a>
            <Link href="/admin/revisoes" className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm hover:bg-slate-50">
              <ArrowLeft className="w-4 h-4" /> Voltar
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200">
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <div className="flex items-center gap-1 text-xs text-slate-500"><Hash className="w-3 h-3" /> Review ID</div>
              <div className="font-bold">{meta.id.slice(0, 8)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-xs text-slate-500"><Clock className="w-3 h-3" /> Tempo</div>
              <div className="font-bold">{Math.round(meta.elapsed_ms / 1000)}s</div>
              <div className="text-xs text-slate-500">{new Date(meta.created_at).toLocaleString("pt-BR")}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-xs text-slate-500"><DollarSign className="w-3 h-3" /> Custo</div>
              <div className="font-bold">${Number(meta.estimated_cost_usd ?? 0).toFixed(3)}</div>
              <div className="text-xs text-slate-500">{meta.total_input_tokens.toLocaleString()} in / {meta.total_output_tokens.toLocaleString()} out</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-xs text-slate-500"><Hash className="w-3 h-3" /> Páginas</div>
              <div className="font-bold">{meta.num_pages}</div>
              <div className="text-xs text-slate-500">{meta.forms_detected.length} forms</div>
            </div>
          </div>
        </div>

        <ReviewReportView
          report={data.report}
          reviewId={params.id}
          currentUserId={currentUserId ?? undefined}
        />
      </div>
    </main>
  );
}
