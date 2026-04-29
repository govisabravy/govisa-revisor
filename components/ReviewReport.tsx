"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ReviewReport,
  Finding,
  FeedbackErrorType
} from "@/lib/schemas/forms";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  Check,
  X,
  Plus
} from "lucide-react";

const severityConfig: Record<
  Finding["severity"],
  { label: string; bg: string; border: string; icon: any; textColor: string }
> = {
  critica: {
    label: "Crítica",
    bg: "bg-red-50",
    border: "border-red-300",
    icon: AlertTriangle,
    textColor: "text-red-700"
  },
  alta: {
    label: "Alta",
    bg: "bg-orange-50",
    border: "border-orange-300",
    icon: AlertCircle,
    textColor: "text-orange-700"
  },
  media: {
    label: "Média",
    bg: "bg-yellow-50",
    border: "border-yellow-300",
    icon: Info,
    textColor: "text-yellow-700"
  },
  baixa: {
    label: "Baixa",
    bg: "bg-blue-50",
    border: "border-blue-300",
    icon: Info,
    textColor: "text-blue-700"
  }
};

const categoryLabel: Record<Finding["category"], string> = {
  divergencia: "Divergência",
  campo_suspeito: "Campo suspeito",
  campo_vazio: "Campo vazio",
  regra_govisa: "Regra Go Visa",
  elegibilidade: "Elegibilidade",
  credibilidade: "Credibilidade",
  suporte_documental: "Suporte documental",
  assinatura: "Assinatura",
  estrategia: "Estratégia",
  cross_narrative: "Análise sênior"
};

const tierLabel: Record<Finding["tier"], { label: string; desc: string; color: string }> = {
  tier1_filing: {
    label: "Tier 1 — Filing",
    desc: "Bloqueia protocolo ou gera RFE imediato",
    color: "bg-red-100 text-red-800"
  },
  tier2_substantivo: {
    label: "Tier 2 — Substantivo",
    desc: "Afeta mérito e elegibilidade",
    color: "bg-orange-100 text-orange-800"
  },
  tier3_estrategico: {
    label: "Tier 3 — Estratégico",
    desc: "Revisão humana e estratégia",
    color: "bg-blue-100 text-blue-800"
  }
};

const FEEDBACK_LABELS: Record<FeedbackErrorType, string> = {
  falso_positivo: "Não é erro (falso positivo)",
  categoria_errada: "Categoria errada",
  severidade_errada: "Severidade errada",
  explicacao_imprecisa: "Explicação imprecisa",
  recomendacao_errada: "Recomendação errada",
  outro: "Outro"
};

const FEEDBACK_KEYS: FeedbackErrorType[] = [
  "falso_positivo",
  "categoria_errada",
  "severidade_errada",
  "explicacao_imprecisa",
  "recomendacao_errada",
  "outro"
];

type FindingWithHash = Finding & { _hash?: string };

type FeedbackState = {
  verdict: "correct" | "incorrect";
  error_type?: string | null;
  note?: string | null;
};

interface IncorrectModalState {
  open: boolean;
  finding: FindingWithHash | null;
}

export default function ReviewReportView({
  report,
  reviewId,
  currentUserId
}: {
  report: ReviewReport;
  reviewId?: string;
  currentUserId?: string;
}) {
  const tiers: Finding["tier"][] = ["tier1_filing", "tier2_substantivo", "tier3_estrategico"];

  const [activeSubject, setActiveSubject] = useState<string | null>(null);
  const [feedbackMap, setFeedbackMap] = useState<Map<string, FeedbackState>>(
    new Map()
  );
  const [modal, setModal] = useState<IncorrectModalState>({
    open: false,
    finding: null
  });
  const [missingModalOpen, setMissingModalOpen] = useState(false);
  const [missingReports, setMissingReports] = useState<
    Array<{
      id: number;
      title: string;
      description: string;
      suggested_severity: string | null;
      created_at: string;
    }>
  >([]);

  // Hidratar lista de erros não detectados já reportados
  useEffect(() => {
    if (!reviewId) return;
    let cancelled = false;
    fetch(`/api/reviews/${reviewId}/missing-finding`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => {
        if (cancelled) return;
        setMissingReports(data.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  async function submitMissingFinding(payload: {
    title: string;
    description: string;
    suggested_severity?: string;
    subject_id?: string;
    form?: string;
  }) {
    if (!reviewId) return;
    try {
      const res = await fetch(`/api/reviews/${reviewId}/missing-finding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const j = await res.json();
        setMissingReports((prev) => [
          {
            id: j.id,
            title: payload.title,
            description: payload.description,
            suggested_severity: payload.suggested_severity ?? null,
            created_at: new Date().toISOString()
          },
          ...prev
        ]);
        setMissingModalOpen(false);
      }
    } catch {}
  }

  // Hidratar feedbacks existentes do usuário
  useEffect(() => {
    if (!reviewId) return;
    let cancelled = false;
    fetch(`/api/reviews/${reviewId}/feedback`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => {
        if (cancelled) return;
        const next = new Map<string, FeedbackState>();
        for (const item of data.items ?? []) {
          if (currentUserId && item.user_id !== currentUserId) continue;
          next.set(item.finding_hash, {
            verdict: item.verdict,
            error_type: item.error_type ?? null,
            note: item.note ?? null
          });
        }
        setFeedbackMap(next);
      })
      .catch(() => {
        // silencioso — UI degrada para sem feedback
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId, currentUserId]);

  const findings = (report.findings ?? []) as FindingWithHash[];

  const filteredFindings = useMemo(() => {
    if (!activeSubject) return findings;
    return findings.filter((f) => f.subject_id === activeSubject);
  }, [findings, activeSubject]);

  async function postFeedback(input: {
    finding: FindingWithHash;
    verdict: "correct" | "incorrect";
    error_type?: string | null;
    note?: string | null;
  }) {
    if (!reviewId) return;
    const hash = input.finding._hash;
    if (!hash) return;
    const ruleId = input.finding.rule_id ?? `LEGACY:${input.finding.field}`;
    try {
      await fetch(`/api/reviews/${reviewId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          finding_hash: hash,
          rule_id: ruleId,
          subject_id: input.finding.subject_id ?? null,
          verdict: input.verdict,
          error_type: input.error_type ?? null,
          note: input.note ?? null
        })
      });
    } catch {
      // silencioso
    }
  }

  function markCorrect(f: FindingWithHash) {
    if (!f._hash) return;
    setFeedbackMap((prev) => {
      const next = new Map(prev);
      next.set(f._hash!, { verdict: "correct" });
      return next;
    });
    postFeedback({ finding: f, verdict: "correct" });
  }

  function openIncorrect(f: FindingWithHash) {
    if (!f._hash) return;
    setModal({ open: true, finding: f });
  }

  function submitIncorrect(payload: { error_type: FeedbackErrorType; note: string }) {
    const f = modal.finding;
    if (!f || !f._hash) {
      setModal({ open: false, finding: null });
      return;
    }
    setFeedbackMap((prev) => {
      const next = new Map(prev);
      next.set(f._hash!, {
        verdict: "incorrect",
        error_type: payload.error_type,
        note: payload.note
      });
      return next;
    });
    postFeedback({
      finding: f,
      verdict: "incorrect",
      error_type: payload.error_type,
      note: payload.note || null
    });
    setModal({ open: false, finding: null });
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 border border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {report.client_name ?? "Cliente não identificado"}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Forms detectados: {report.forms_detected.join(", ") || "nenhum"}
            </p>
          </div>
          {report.summary.total === 0 ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-300 rounded-full">
              <CheckCircle2 className="w-5 h-5 text-green-700" />
              <span className="text-sm font-semibold text-green-800">Sem achados</span>
            </div>
          ) : null}
        </div>

        {report.subjects && report.subjects.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <span className="text-sm font-semibold text-slate-600">Sujeitos:</span>
            {report.subjects.map((s) => {
              const count = findings.filter((f) => f.subject_id === s.id).length;
              const active = activeSubject === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveSubject(active ? null : s.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                    active
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {s.display_name}{" "}
                  <span className="opacity-60">
                    · {s.role === "principal" ? "principal" : "dep"} · {count}
                  </span>
                </button>
              );
            })}
            {activeSubject && (
              <button
                onClick={() => setActiveSubject(null)}
                className="text-xs text-slate-500 underline"
              >
                limpar filtro
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-4 gap-3 mb-4">
          <SummaryCard label="Crítica" count={report.summary.critical} color="text-red-700" />
          <SummaryCard label="Alta" count={report.summary.high} color="text-orange-700" />
          <SummaryCard label="Média" count={report.summary.medium} color="text-yellow-700" />
          <SummaryCard label="Baixa" count={report.summary.low} color="text-blue-700" />
        </div>

        {reviewId ? (
          <div className="border-t border-slate-200 pt-4 mt-2">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Erros não detectados pelo sistema
                </h3>
                <p className="text-xs text-slate-500">
                  Aponte aqui um erro real do filing que o relatório acima deixou passar.
                  Vira input pra calibrar o revisor.
                </p>
              </div>
              <button
                onClick={() => setMissingModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 rounded-lg transition"
              >
                <Plus className="w-3.5 h-3.5" />
                Reportar erro não detectado
              </button>
            </div>
            {missingReports.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {missingReports.map((m) => (
                  <li
                    key={m.id}
                    className="text-xs px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      {m.suggested_severity && (
                        <span className="px-1.5 py-0.5 bg-white border border-amber-300 rounded text-[10px] uppercase font-bold text-amber-800">
                          {m.suggested_severity}
                        </span>
                      )}
                      <span className="font-semibold text-slate-900">{m.title}</span>
                    </div>
                    <p className="text-slate-700 mt-1">{m.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-3 pt-4 border-t border-slate-200">
          <SummaryCard
            label={tierLabel.tier1_filing.label}
            count={report.summary.by_tier.tier1_filing}
            color="text-red-700"
          />
          <SummaryCard
            label={tierLabel.tier2_substantivo.label}
            count={report.summary.by_tier.tier2_substantivo}
            color="text-orange-700"
          />
          <SummaryCard
            label={tierLabel.tier3_estrategico.label}
            count={report.summary.by_tier.tier3_estrategico}
            color="text-blue-700"
          />
        </div>
      </div>

      {tiers.map((tier) => {
        const tierFindings = filteredFindings.filter((f) => f.tier === tier);
        if (tierFindings.length === 0) return null;
        const tierInfo = tierLabel[tier];
        return (
          <section key={tier} className="space-y-3">
            <div className="flex items-baseline gap-3">
              <h3 className="text-xl font-bold text-slate-900">{tierInfo.label}</h3>
              <span className="text-sm text-slate-500">{tierInfo.desc}</span>
              <span className="ml-auto text-sm font-semibold text-slate-700">
                {tierFindings.length} achado(s)
              </span>
            </div>
            {(["critica", "alta", "media", "baixa"] as const).map((sev) => {
              const group = tierFindings.filter((f) => f.severity === sev);
              if (group.length === 0) return null;
              return (
                <div key={sev} className="space-y-2">
                  <div className="text-sm font-semibold text-slate-600">
                    {severityConfig[sev].label} ({group.length})
                  </div>
                  <div className="space-y-2">
                    {group.map((f, i) => {
                      const fb = f._hash ? feedbackMap.get(f._hash) : undefined;
                      return (
                        <FindingCard
                          key={`${tier}-${sev}-${i}-${f._hash ?? "nohash"}`}
                          finding={f}
                          feedback={fb}
                          canFeedback={!!reviewId && !!f._hash}
                          onCorrect={() => markCorrect(f)}
                          onIncorrect={() => openIncorrect(f)}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

      {modal.open && modal.finding && (
        <IncorrectModal
          finding={modal.finding}
          initial={
            modal.finding._hash ? feedbackMap.get(modal.finding._hash) : undefined
          }
          onClose={() => setModal({ open: false, finding: null })}
          onSubmit={submitIncorrect}
        />
      )}

      {missingModalOpen && (
        <MissingFindingModal
          subjects={report.subjects ?? []}
          forms={report.forms_detected ?? []}
          onClose={() => setMissingModalOpen(false)}
          onSubmit={submitMissingFinding}
        />
      )}
    </div>
  );
}

function MissingFindingModal({
  subjects,
  forms,
  onClose,
  onSubmit
}: {
  subjects: Array<{ id: string; display_name: string }>;
  forms: string[];
  onClose: () => void;
  onSubmit: (payload: {
    title: string;
    description: string;
    suggested_severity?: string;
    subject_id?: string;
    form?: string;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"" | "critica" | "alta" | "media" | "baixa">("");
  const [subjectId, setSubjectId] = useState<string>("");
  const [form, setForm] = useState<string>("");

  const canSubmit = title.trim().length >= 3 && description.trim().length >= 10;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-6 max-w-xl w-full shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              Reportar erro não detectado
            </h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Erro real do filing que o relatório acima deixou passar.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded text-slate-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Título *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: DOB do dependente Maria errado em todos os forms"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
              maxLength={200}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Descrição detalhada *
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o erro: onde está, qual o valor errado, qual deveria ser, e qual a regra USCIS violada (se souber)."
              rows={4}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
              maxLength={4000}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Severidade sugerida
              </label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as any)}
                className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="">— escolher —</option>
                <option value="critica">Crítica</option>
                <option value="alta">Alta</option>
                <option value="media">Média</option>
                <option value="baixa">Baixa</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Sujeito
              </label>
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="">— qualquer —</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.display_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Form
              </label>
              <select
                value={form}
                onChange={(e) => setForm(e.target.value)}
                className="w-full px-2 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="">— qualquer —</option>
                {forms.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
          >
            Cancelar
          </button>
          <button
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                title: title.trim(),
                description: description.trim(),
                suggested_severity: severity || undefined,
                subject_id: subjectId || undefined,
                form: form || undefined
              })
            }
            className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg"
          >
            Reportar
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  count,
  color
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-200">
      <div className={`text-2xl font-bold ${color}`}>{count}</div>
      <div className="text-xs text-slate-600 mt-1">{label}</div>
    </div>
  );
}

function FindingCard({
  finding,
  feedback,
  canFeedback,
  onCorrect,
  onIncorrect
}: {
  finding: FindingWithHash;
  feedback?: FeedbackState;
  canFeedback: boolean;
  onCorrect: () => void;
  onIncorrect: () => void;
}) {
  const cfg = severityConfig[finding.severity];
  const Icon = cfg.icon;
  const verdict = feedback?.verdict;

  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-4 relative`}>
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 text-slate-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap pr-20">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
              {categoryLabel[finding.category]}
            </span>
            {finding.form ? (
              <span className="text-xs px-2 py-0.5 bg-white rounded border border-slate-300 text-slate-700">
                {finding.form}
              </span>
            ) : null}
          </div>
          <h4 className="font-semibold text-slate-900">{finding.field}</h4>
          <p className="text-sm text-slate-700 mt-1">{finding.explanation}</p>
          {(finding.expected || finding.found) && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {finding.expected && (
                <div>
                  <div className="font-semibold text-slate-600 mb-1">Esperado</div>
                  <div className="bg-white rounded px-2 py-1 border border-slate-200 text-slate-800 break-words">
                    {finding.expected}
                  </div>
                </div>
              )}
              {finding.found && (
                <div>
                  <div className="font-semibold text-slate-600 mb-1">Encontrado</div>
                  <div className="bg-white rounded px-2 py-1 border border-slate-200 text-slate-800 break-words">
                    {finding.found}
                  </div>
                </div>
              )}
            </div>
          )}
          {finding.recommendation ? (
            <div className="mt-3 text-xs bg-white rounded px-3 py-2 border border-slate-300">
              <span className="font-semibold text-slate-600">Ação sugerida: </span>
              <span className="text-slate-800">{finding.recommendation}</span>
            </div>
          ) : null}
          {finding.source ? (
            <div className="text-xs text-slate-500 mt-2">Fonte: {finding.source}</div>
          ) : null}
          {feedback?.verdict === "incorrect" && feedback.error_type ? (
            <div className="mt-3 text-xs text-slate-600 bg-white border border-slate-200 rounded px-3 py-2">
              <span className="font-semibold">Seu feedback: </span>
              {FEEDBACK_LABELS[feedback.error_type as FeedbackErrorType] ??
                feedback.error_type}
              {feedback.note ? ` — ${feedback.note}` : ""}
            </div>
          ) : null}
        </div>
      </div>

      {canFeedback && (
        <div className="absolute top-3 right-3 flex items-center gap-1">
          <button
            type="button"
            onClick={onCorrect}
            title="Marcar como correto"
            aria-label="Marcar como correto"
            className={`w-8 h-8 rounded-full border flex items-center justify-center transition ${
              verdict === "correct"
                ? "bg-emerald-600 border-emerald-600 text-white"
                : "bg-white border-slate-300 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-400"
            }`}
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onIncorrect}
            title="Marcar como incorreto"
            aria-label="Marcar como incorreto"
            className={`w-8 h-8 rounded-full border flex items-center justify-center transition ${
              verdict === "incorrect"
                ? "bg-red-600 border-red-600 text-white"
                : "bg-white border-slate-300 text-red-700 hover:bg-red-50 hover:border-red-400"
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function IncorrectModal({
  finding,
  initial,
  onClose,
  onSubmit
}: {
  finding: FindingWithHash;
  initial?: FeedbackState;
  onClose: () => void;
  onSubmit: (payload: { error_type: FeedbackErrorType; note: string }) => void;
}) {
  const [errorType, setErrorType] = useState<FeedbackErrorType>(
    (initial?.error_type as FeedbackErrorType) ?? "falso_positivo"
  );
  const [note, setNote] = useState<string>(initial?.note ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-lg p-6 space-y-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Marcar como incorreto</h3>
          <p className="text-xs text-slate-500 mt-1 truncate">{finding.field}</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">Tipo de erro</label>
          <select
            value={errorType}
            onChange={(e) => setErrorType(e.target.value as FeedbackErrorType)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            {FEEDBACK_KEYS.map((k) => (
              <option key={k} value={k}>
                {FEEDBACK_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">
            Comentário (opcional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 2000))}
            rows={4}
            placeholder="Detalhe o que está errado para ajudar a melhorar a regra."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 resize-none"
          />
          <div className="text-xs text-slate-400 text-right">{note.length}/2000</div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onSubmit({ error_type: errorType, note })}
            className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
