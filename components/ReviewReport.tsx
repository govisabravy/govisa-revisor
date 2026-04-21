"use client";

import type { ReviewReport, Finding } from "@/lib/schemas/forms";
import { AlertTriangle, AlertCircle, Info, CheckCircle2 } from "lucide-react";

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
  estrategia: "Estratégia"
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

export default function ReviewReportView({ report }: { report: ReviewReport }) {
  const tiers: Finding["tier"][] = ["tier1_filing", "tier2_substantivo", "tier3_estrategico"];

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

        <div className="grid grid-cols-4 gap-3 mb-4">
          <SummaryCard label="Crítica" count={report.summary.critical} color="text-red-700" />
          <SummaryCard label="Alta" count={report.summary.high} color="text-orange-700" />
          <SummaryCard label="Média" count={report.summary.medium} color="text-yellow-700" />
          <SummaryCard label="Baixa" count={report.summary.low} color="text-blue-700" />
        </div>

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
        const findings = report.findings.filter((f) => f.tier === tier);
        if (findings.length === 0) return null;
        const tierInfo = tierLabel[tier];
        return (
          <section key={tier} className="space-y-3">
            <div className="flex items-baseline gap-3">
              <h3 className="text-xl font-bold text-slate-900">{tierInfo.label}</h3>
              <span className="text-sm text-slate-500">{tierInfo.desc}</span>
              <span className="ml-auto text-sm font-semibold text-slate-700">
                {findings.length} achado(s)
              </span>
            </div>
            {(["critica", "alta", "media", "baixa"] as const).map((sev) => {
              const group = findings.filter((f) => f.severity === sev);
              if (group.length === 0) return null;
              return (
                <div key={sev} className="space-y-2">
                  <div className="text-sm font-semibold text-slate-600">
                    {severityConfig[sev].label} ({group.length})
                  </div>
                  <div className="space-y-2">
                    {group.map((f, i) => (
                      <FindingCard key={`${tier}-${sev}-${i}`} finding={f} />
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
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

function FindingCard({ finding }: { finding: Finding }) {
  const cfg = severityConfig[finding.severity];
  const Icon = cfg.icon;
  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-4`}>
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 text-slate-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
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
        </div>
      </div>
    </div>
  );
}
