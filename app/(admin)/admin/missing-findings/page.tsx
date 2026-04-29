import Link from "next/link";
import { listAllMissingFindingReports } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  open: "Aberto",
  triaged: "Triado",
  resolved: "Resolvido",
  wont_fix: "Não corrigir"
};

const SEVERITY_BADGE: Record<string, string> = {
  critica: "bg-red-100 text-red-800 border-red-300",
  alta: "bg-orange-100 text-orange-800 border-orange-300",
  media: "bg-yellow-100 text-yellow-800 border-yellow-300",
  baixa: "bg-blue-100 text-blue-800 border-blue-300"
};

export default async function MissingFindingsAdminPage({
  searchParams
}: {
  searchParams: { status?: string; period?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/missing-findings");
  if (user.role !== "admin") redirect("/app");

  const status = searchParams.status;
  const period = searchParams.period ?? "30d";
  const since =
    period === "7d"
      ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      : period === "30d"
      ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

  const items = listAllMissingFindingReports({
    status: status && status !== "all" ? status : undefined,
    since,
    limit: 200
  });

  const counts = {
    open: items.filter((i) => i.status === "open").length,
    triaged: items.filter((i) => i.status === "triaged").length,
    resolved: items.filter((i) => i.status === "resolved").length,
    wont_fix: items.filter((i) => i.status === "wont_fix").length
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Erros não detectados
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Reports de falsos negativos enviados pelos advogados — input pra
            calibrar regras e prompts.
          </p>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {(["7d", "30d", "all"] as const).map((p) => (
          <Link
            key={p}
            href={`?period=${p}${status ? `&status=${status}` : ""}`}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
              period === p
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-300"
            }`}
          >
            {p === "7d" ? "Últimos 7 dias" : p === "30d" ? "30 dias" : "Tudo"}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-3 mb-6">
        {(["open", "triaged", "resolved", "wont_fix"] as const).map((s) => (
          <Link
            key={s}
            href={`?period=${period}&status=${s}`}
            className={`p-3 rounded-xl border text-center ${
              status === s
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white border-slate-200 hover:bg-slate-50"
            }`}
          >
            <div className="text-2xl font-bold">{counts[s]}</div>
            <div className="text-xs opacity-80 mt-1">{STATUS_LABEL[s]}</div>
          </Link>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left">
              <th className="px-4 py-3 font-semibold text-slate-600">Quando</th>
              <th className="px-4 py-3 font-semibold text-slate-600">Cliente</th>
              <th className="px-4 py-3 font-semibold text-slate-600">Título</th>
              <th className="px-4 py-3 font-semibold text-slate-600">Sev.</th>
              <th className="px-4 py-3 font-semibold text-slate-600">Form</th>
              <th className="px-4 py-3 font-semibold text-slate-600">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                  Nenhum erro não detectado reportado neste período.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {new Date(item.created_at).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <Link
                      href={`/admin/revisoes/${item.review_id}`}
                      className="hover:underline"
                    >
                      {item.client_name ?? item.review_id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    <div className="font-medium">{item.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                      {item.description}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {item.suggested_severity && (
                      <span
                        className={`inline-block px-2 py-0.5 text-[10px] uppercase font-bold border rounded ${
                          SEVERITY_BADGE[item.suggested_severity] ??
                          "bg-slate-100 text-slate-700 border-slate-300"
                        }`}
                      >
                        {item.suggested_severity}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {item.form ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded">
                      {STATUS_LABEL[item.status] ?? item.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
