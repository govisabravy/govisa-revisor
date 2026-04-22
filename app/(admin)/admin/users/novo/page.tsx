"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";

export default function NovoUser() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [pwd, setPwd] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, role, temp_password: pwd })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? "Erro"); return; }
      router.replace("/admin/users");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-lg mx-auto p-6">
        <Link href="/admin/users" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
        <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <h1 className="text-xl font-bold text-slate-900">Novo usuário</h1>
          <div>
            <label className="text-xs font-semibold text-slate-600 uppercase">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-govisa-navy" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 uppercase">Nome</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-govisa-navy" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 uppercase">Papel</label>
            <select value={role} onChange={(e) => setRole(e.target.value as any)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="user">User (case manager)</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 uppercase">Senha temporária</label>
            <input type="text" required minLength={8} value={pwd} onChange={(e) => setPwd(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-govisa-navy"
              placeholder="mínimo 8 caracteres" />
            <p className="text-xs text-slate-500 mt-1">Usuário será obrigado a trocar no primeiro login.</p>
          </div>
          {err && <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded-xl px-3 py-2">{err}</div>}
          <button disabled={loading} className="w-full bg-govisa-navy text-white rounded-xl py-2.5 font-semibold hover:bg-slate-800 disabled:opacity-60 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Criar
          </button>
        </form>
      </div>
    </main>
  );
}
