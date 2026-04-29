"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn, Loader2 } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get("next") ?? null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Erro ao autenticar");
        return;
      }
      if (data.must_change_password) {
        router.replace("/change-password");
        return;
      }
      const target =
        data.role === "admin" ? (nextPath ?? "/admin") : (nextPath ?? "/app");
      router.replace(target);
    } catch {
      setErr("Erro de rede");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border border-slate-200 w-full max-w-md p-8 space-y-5">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-govisa-navy flex items-center justify-center">
            <LogIn className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-lg text-slate-900">Go Visa Revisor</div>
            <div className="text-xs text-slate-500">Entre com sua conta</div>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Email</label>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-govisa-navy"
            placeholder="nome@govisalawfirm.com"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Senha</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-govisa-navy"
          />
        </div>

        {err && (
          <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded-xl px-3 py-2">
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-govisa-navy text-white rounded-xl py-2.5 font-semibold hover:bg-slate-800 transition disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Entrar
        </button>

        <div className="text-center">
          <a
            href="mailto:tiago@asv.digital?subject=Go%20Visa%20Revisor%20-%20Acesso"
            className="text-xs text-slate-500 hover:text-govisa-navy"
          >
            Esqueci minha senha — falar com o admin
          </a>
        </div>
      </form>
    </main>
  );
}
