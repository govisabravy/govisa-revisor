import { AlertTriangle } from "lucide-react";
import { SYSTEM_PAUSED_MESSAGE, SYSTEM_PAUSED_PHONE } from "@/lib/system-status";

export default function SystemPausedScreen() {
  const telHref = `tel:${SYSTEM_PAUSED_PHONE.replace(/[^\d+]/g, "")}`;
  return (
    <main className="min-h-screen bg-govisa-navy flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-lg p-8 text-center space-y-6">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-red-600" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-bold text-slate-900">Sistema pausado</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            {SYSTEM_PAUSED_MESSAGE}
          </p>
        </div>
        <a
          href={telHref}
          className="inline-block bg-govisa-navy text-white rounded-xl px-6 py-3 text-lg font-bold tracking-wide hover:bg-slate-800 transition"
        >
          {SYSTEM_PAUSED_PHONE}
        </a>
      </div>
    </main>
  );
}
