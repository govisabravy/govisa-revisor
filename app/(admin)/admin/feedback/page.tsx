import Link from "next/link";
import { aggregateFeedbackByRuleId } from "@/lib/db";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Period = "7d" | "30d" | "all";

const PERIOD_LABELS: Record<Period, string> = {
  "7d": "7 dias",
  "30d": "30 dias",
  all: "Todo o período"
};

function periodToSinceISO(p: Period): string | undefined {
  if (p === "all") return undefined;
  const days = p === "7d" ? 7 : 30;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export default function FeedbackAdminPage({
  searchParams
}: {
  searchParams?: { period?: string };
}) {
  const rawPeriod = (searchParams?.period ?? "30d") as Period;
  const period: Period = ["7d", "30d", "all"].includes(rawPeriod) ? rawPeriod : "30d";
  const since = periodToSinceISO(period);

  const rows = aggregateFeedbackByRuleId(since ? { since } : {});

  const totals = rows.reduce(
    (acc, r) => {
      acc.total += r.total;
      acc.correct += r.correct;
      acc.incorrect += r.incorrect;
      return acc;
    },
    { total: 0, correct: 0, incorrect: 0 }
  );
  const overallRate = totals.total > 0 ? totals.incorrect / totals.total : 0;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Feedback do revisor</h1>
            <p className="text-sm text-slate-500 mt-1">
              Ranking de regras por taxa de feedback incorrect dos usuários.
            </p>
          </div>
          <Link
            href="/admin"
            className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm hover:bg-slate-50"
          >
            <ArrowLeft className="w-4 h-4" /> Voltar
          </Link>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <Link
                key={p}
                href={`/admin/feedback?period=${p}`}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                  period === p
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {PERIOD_LABELS[p]}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-6 text-sm">
            <div>
              <div className="text-xs text-slate-500">Total feedbacks</div>
              <div className="font-bold text-slate-900">{totals.total}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Corretos</div>
              <div className="font-bold text-emerald-700">{totals.correct}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Incorretos</div>
              <div className="font-bold text-red-700">{totals.incorrect}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">% incorrect global</div>
              <div className="font-bold text-slate-900">
                {(overallRate * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center text-slate-500">
            Nenhum feedback registrado nesse período.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-xs uppercase tracking-wide text-slate-600">
                  <th className="px-4 py-3 font-semibold">Rule ID</th>
                  <th className="px-4 py-3 font-semibold text-right">Total</th>
                  <th className="px-4 py-3 font-semibold text-right">Correct</th>
                  <th className="px-4 py-3 font-semibold text-right">Incorrect</th>
                  <th className="px-4 py-3 font-semibold w-72">% incorrect</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pct = Math.round(r.rate_incorrect * 100);
                  const barColor =
                    pct >= 50
                      ? "bg-red-500"
                      : pct >= 25
                      ? "bg-orange-500"
                      : pct >= 10
                      ? "bg-yellow-500"
                      : "bg-emerald-500";
                  return (
                    <tr
                      key={r.rule_id}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3">
                        <code className="font-mono text-xs text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                          {r.rule_id}
                        </code>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-700">
                        {r.total}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                        {r.correct}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-red-700">
                        {r.incorrect}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${barColor}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-slate-700 w-12 text-right">
                            {pct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
