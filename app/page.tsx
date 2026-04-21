"use client";

import { useState } from "react";
import UploadDropzone from "@/components/UploadDropzone";
import ReviewReportView from "@/components/ReviewReport";
import type { ReviewReport } from "@/lib/schemas/forms";
import Link from "next/link";
import { Loader2, FileText, RefreshCw, History } from "lucide-react";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mode, setMode] = useState<"draft" | "final">("draft");

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    setReport(null);
    setFileName(file.name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
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
      <header className="bg-govisa-navy text-white py-5 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6" />
            <h1 className="text-xl font-bold">Go Visa — Revisor de Processos</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/historico"
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm"
            >
              <History className="w-4 h-4" />
              Histórico
            </Link>
            {report ? (
              <button
                onClick={reset}
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm"
              >
                <RefreshCw className="w-4 h-4" />
                Nova revisão
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {!report && !loading && (
          <>
            <div className="bg-white rounded-2xl p-5 border border-slate-200">
              <div className="text-sm font-semibold text-slate-800 mb-3">
                Estágio do processo
              </div>
              <div className="flex gap-3">
                <label className={`flex-1 flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition ${mode === "draft" ? "border-govisa-navy bg-blue-50" : "border-slate-200"}`}>
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
                <label className={`flex-1 flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition ${mode === "final" ? "border-govisa-navy bg-blue-50" : "border-slate-200"}`}>
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
            {error && (
              <div className="bg-red-50 border border-red-300 rounded-xl p-4 text-red-800 text-sm">
                {error}
              </div>
            )}
            <div className="bg-white rounded-2xl p-6 border border-slate-200 text-sm text-slate-700 space-y-2">
              <h3 className="font-semibold text-slate-900">O que esta ferramenta revisa</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>Formulários USCIS: I-914, I-914A, I-914B, I-192, I-765, G-28</li>
                <li>Concordância entre a história do cliente e os formulários</li>
                <li>Endereço da Go Visa (Physical e Safe Mailing Address)</li>
                <li>Campos críticos vazios (nome, data de nascimento, passaporte)</li>
                <li>Divergências entre formulários (mesmo campo com valor diferente)</li>
              </ul>
            </div>
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
