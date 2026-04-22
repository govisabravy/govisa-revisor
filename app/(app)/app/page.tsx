"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import UploadDropzone from "@/components/UploadDropzone";
import ReviewReportView from "@/components/ReviewReport";
import type { ReviewReport } from "@/lib/schemas/forms";
import { Loader2, RefreshCw, Clock, AlertTriangle } from "lucide-react";
import { FileText, Shield, Gavel } from "lucide-react";

interface Recent {
  id: string;
  created_at: string;
  file_name: string;
  client_name: string;
  total_findings: number;
  critical_count: number;
  elapsed_ms: number;
  estimated_cost_usd: number;
}

export default function NewReview() {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mode, setMode] = useState<"draft" | "final">("draft");
  const [caseType, setCaseType] = useState<"t_visa"|"vawa"|"u_visa">("t_visa");
  const [recent, setRecent] = useState<Recent[]>([]);

  useEffect(() => {
    fetch("/api/reviews")
      .then((r) => r.json())
      .then((data) => setRecent(data.items?.slice(0, 5) ?? []))
      .catch(() => setRecent([]));
  }, []);

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    setReport(null);
    setFileName(file.name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
      fd.append("case_type", caseType);
      const res = await fetch("/api/review", { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setReport(data.report);
    } catch (err: any) {
      setError(err?.message ?? "Erro ao revisar processo.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setReport(null);
    setError(null);
    setFileName(null);
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">Nova revisão</h1>
          {report ? (
            <button
              onClick={reset}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm hover:bg-slate-50"
            >
              <RefreshCw className="w-4 h-4" />
              Nova revisão
            </button>
          ) : null}
        </div>

        {!report && !loading && (
          <>
            <div className="bg-white rounded-2xl p-5 border border-slate-200">
              <div className="text-sm font-semibold text-slate-800 mb-3">Tipo de processo</div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { v: "t_visa", l: "T-visa", desc: "Vítima de tráfico humano", icon: Shield },
                  { v: "vawa", l: "VAWA", desc: "Self-petition por violência doméstica", icon: FileText },
                  { v: "u_visa", l: "U-visa", desc: "Vítima de crime qualificado", icon: Gavel }
                ].map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <label
                      key={opt.v}
                      className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition ${
                        caseType === opt.v ? "border-govisa-navy bg-blue-50" : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="case_type"
                        value={opt.v}
                        checked={caseType === opt.v}
                        onChange={() => setCaseType(opt.v as any)}
                        className="mt-1"
                      />
                      <div>
                        <div className="flex items-center gap-2 font-semibold text-slate-900">
                          <Icon className="w-4 h-4" />
                          {opt.l}
                        </div>
                        <div className="text-xs text-slate-600 mt-1">{opt.desc}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="bg-white rounded-2xl p-5 border border-slate-200">
              <div className="text-sm font-semibold text-slate-800 mb-3">Estágio do processo</div>
              <div className="flex gap-3">
                <label
                  className={`flex-1 flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition ${
                    mode === "draft" ? "border-govisa-navy bg-blue-50" : "border-slate-200"
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value="draft"
                    checked={mode === "draft"}
                    onChange={() => setMode("draft")}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-semibold text-slate-900">Draft (pré-cliente)</div>
                    <div className="text-xs text-slate-600 mt-1">
                      Processo será enviado ao cliente para aprovar e assinar. Ignora ausência de assinaturas.
                    </div>
                  </div>
                </label>
                <label
                  className={`flex-1 flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition ${
                    mode === "final" ? "border-govisa-navy bg-blue-50" : "border-slate-200"
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value="final"
                    checked={mode === "final"}
                    onChange={() => setMode("final")}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-semibold text-slate-900">Final (pré-protocolo)</div>
                    <div className="text-xs text-slate-600 mt-1">
                      Processo pronto para USCIS. Cobra todas as assinaturas obrigatórias.
                    </div>
                  </div>
                </label>
              </div>
            </div>
            <UploadDropzone onFile={handleFile} />
            {recent.length > 0 && (
              <div className="space-y-3">
                <div className="text-sm font-semibold text-slate-800">Suas últimas revisões</div>
                <div className="grid grid-cols-1 gap-3">
                  {recent.map((r) => (
                    <Link
                      key={r.id}
                      href={`/app/historico/${r.id}`}
                      className="bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 hover:shadow-sm transition flex items-center justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-900 truncate">{r.client_name}</div>
                        <div className="text-xs text-slate-500 truncate mt-0.5">{r.file_name}</div>
                        <div className="text-xs text-slate-400 mt-1">
                          {new Date(r.created_at).toLocaleString("pt-BR")}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 ml-4 shrink-0">
                        <div className="flex items-center gap-1 text-sm text-red-700">
                          <AlertTriangle className="w-4 h-4" />
                          <span className="font-semibold">{r.critical_count}</span>
                          <span className="text-slate-400">/{r.total_findings}</span>
                        </div>
                        <div className="flex items-center gap-1 text-sm text-slate-500">
                          <Clock className="w-4 h-4" />
                          <span>{(r.elapsed_ms / 1000).toFixed(1)}s</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-300 rounded-xl p-4 text-red-800 text-sm">
                {error}
              </div>
            )}
          </>
        )}

        {loading && (
          <div className="bg-white rounded-2xl p-12 border border-slate-200 flex flex-col items-center justify-center">
            <Loader2 className="w-10 h-10 text-govisa-navy animate-spin mb-3" />
            <p className="text-slate-700 font-medium">Revisando {fileName}...</p>
            <p className="text-sm text-slate-500 mt-1">Extração + análise com IA. Pode levar 1–2 minutos.</p>
          </div>
        )}

        {report && <ReviewReportView report={report} />}
      </div>
    </main>
  );
}
