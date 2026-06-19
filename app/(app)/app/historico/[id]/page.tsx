"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import ReviewReportView from "@/components/ReviewReport";
import { ArrowLeft, Clock, DollarSign, Hash, RefreshCw, FileDown } from "lucide-react";

export default function HistoricoDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rerunOpen, setRerunOpen] = useState(false);
  const [rerunBusy, setRerunBusy] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/reviews/${params.id}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (u?.id) setCurrentUserId(u.id);
        if (u?.role) setCurrentUserRole(u.role);
      })
      .catch(() => {});
  }, [params.id]);

  async function handleRerun() {
    setRerunBusy(true);
    setRerunError(null);
    try {
      const res = await fetch(`/api/reviews/${params.id}/rerun`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRerunError(body?.error ?? `Falha ao rerodar (HTTP ${res.status}).`);
        setRerunBusy(false);
        return;
      }
      const newId = body?.review_id;
      if (newId) {
        router.push(`/app/historico/${newId}`);
      } else {
        setRerunError("Resposta inesperada do servidor.");
        setRerunBusy(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isNetworkError =
        msg === "Load failed" ||
        msg === "Failed to fetch" ||
        msg.includes("NetworkError") ||
        msg.includes("timeout");
      setRerunError(
        isNetworkError
          ? "Falha na conexão com o servidor. A reexecução pode ter iniciado no backend. Verifique o histórico em alguns minutos."
          : msg
      );
      setRerunBusy(false);
    }
  }

  if (loading) return <div className="p-12 text-center text-slate-500">Carregando...</div>;
  if (!data || data.error) return <div className="p-12 text-center text-red-600">Revisão não encontrada.</div>;

  const meta = data.meta;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{meta.client_name ?? meta.file_name}</h1>
          <div className="flex items-center gap-2">
            {currentUserRole === "admin" && meta.pdf_object_key ? (
              <button
                type="button"
                onClick={() => setRerunOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white border border-blue-600 rounded-lg text-sm hover:bg-blue-700"
              >
                <RefreshCw className="w-4 h-4" />
                Rerodar revisão
              </button>
            ) : null}
            <a
              href={`/api/reviews/${params.id}/pdf`}
              download
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm hover:bg-slate-50"
            >
              <FileDown className="w-4 h-4" />
              Baixar PDF
            </a>
            <Link
              href="/app/historico"
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm hover:bg-slate-50"
            >
              <ArrowLeft className="w-4 h-4" />
              Voltar
            </Link>
          </div>
        </div>

        {rerunOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => !rerunBusy && setRerunOpen(false)}
          >
            <div
              className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-semibold">Rerodar esta revisão?</h2>
              <p className="text-sm text-slate-600">
                O sistema vai reprocessar o PDF original com a versão atual do código. Esse processo costuma levar entre 8 e 15 minutos
                e gera um novo registro no histórico, sem afetar este review atual.
              </p>
              {rerunError ? <div className="text-sm text-red-600">{rerunError}</div> : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={rerunBusy}
                  onClick={() => setRerunOpen(false)}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={rerunBusy}
                  onClick={handleRerun}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {rerunBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {rerunBusy ? "Rerodando..." : "Confirmar"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
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

        <ReviewReportView
          report={data.report}
          reviewId={params.id}
          currentUserId={currentUserId ?? undefined}
        />

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
