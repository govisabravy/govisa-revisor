"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Plus, RotateCcw, UserX, Mail, X, Copy, Eye, EyeOff } from "lucide-react";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "user";
  active: number;
  must_change_password: number;
  created_at: string;
  last_login_at: string | null;
}

type ModalState =
  | { kind: "reset"; user: User }
  | { kind: "email"; user: User }
  | null;

export default function UsersPage() {
  const [rows, setRows] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);

  async function load() {
    const res = await fetch("/api/admin/users");
    const d = await res.json();
    setRows(d.items ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function changeRole(id: string, role: "admin" | "user") {
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role })
    });
    load();
  }

  async function toggleActive(u: User) {
    if (!confirm(`${u.active ? "Desativar" : "Reativar"} ${u.email}?`)) return;
    if (u.active) {
      await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
    } else {
      await fetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: 1 })
      });
    }
    load();
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="w-6 h-6 text-govisa-navy" />
            <h1 className="text-2xl font-bold text-slate-900">Usuários</h1>
          </div>
          <Link href="/admin/users/novo" className="flex items-center gap-2 bg-govisa-navy text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-slate-800">
            <Plus className="w-4 h-4" /> Novo usuário
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-500">Carregando...</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left py-3 px-4 font-semibold">Email</th>
                  <th className="text-left py-3 px-4 font-semibold">Nome</th>
                  <th className="text-left py-3 px-4 font-semibold">Papel</th>
                  <th className="text-left py-3 px-4 font-semibold">Status</th>
                  <th className="text-left py-3 px-4 font-semibold">Último login</th>
                  <th className="text-right py-3 px-4 font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4">
                      {u.email}
                      {u.must_change_password ? <span className="ml-2 text-xs bg-amber-100 text-amber-800 rounded px-2 py-0.5">pendente troca</span> : null}
                    </td>
                    <td className="py-3 px-4">{u.name ?? "—"}</td>
                    <td className="py-3 px-4">
                      <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value as any)} className="border border-slate-200 rounded px-2 py-1 text-xs">
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="py-3 px-4">
                      {u.active
                        ? <span className="text-xs bg-emerald-100 text-emerald-800 rounded px-2 py-0.5">ativo</span>
                        : <span className="text-xs bg-slate-200 text-slate-700 rounded px-2 py-0.5">desativado</span>}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500">{u.last_login_at ? new Date(u.last_login_at).toLocaleString("pt-BR") : "nunca"}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setModal({ kind: "email", user: u })} className="text-xs bg-slate-100 hover:bg-slate-200 rounded px-2 py-1 flex items-center gap-1" title="Editar email">
                          <Mail className="w-3 h-3" /> email
                        </button>
                        <button onClick={() => setModal({ kind: "reset", user: u })} className="text-xs bg-slate-100 hover:bg-slate-200 rounded px-2 py-1 flex items-center gap-1">
                          <RotateCcw className="w-3 h-3" /> reset
                        </button>
                        <button onClick={() => toggleActive(u)} className={`text-xs rounded px-2 py-1 flex items-center gap-1 ${u.active ? "bg-rose-100 hover:bg-rose-200 text-rose-800" : "bg-emerald-100 hover:bg-emerald-200 text-emerald-800"}`}>
                          <UserX className="w-3 h-3" /> {u.active ? "desativar" : "reativar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modal?.kind === "reset" && (
        <ResetPasswordModal
          user={modal.user}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }}
        />
      )}
      {modal?.kind === "email" && (
        <ChangeEmailModal
          user={modal.user}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }}
        />
      )}
    </main>
  );
}

function ResetPasswordModal(props: { user: User; onClose: () => void; onDone: () => void }) {
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pwd.length < 8) return setErr("Mínimo 8 caracteres");
    if (pwd !== confirm) return setErr("Confirmação não confere");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${props.user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset_password: pwd })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? "Erro"); return; }
      try { await navigator.clipboard?.writeText(pwd); } catch {}
      alert(`Senha resetada. A senha provisória foi copiada pra sua área de transferência:\n\n${pwd}\n\nO usuário será obrigado a trocá-la no próximo login.`);
      props.onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalShell title={`Resetar senha — ${props.user.email}`} onClose={props.onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-slate-600 uppercase">Nova senha provisória</label>
          <div className="relative mt-1">
            <input
              type={show ? "text" : "password"}
              required
              minLength={8}
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 pr-10 text-sm focus:outline-none focus:border-govisa-navy"
              placeholder="mínimo 8 caracteres"
              autoFocus
            />
            <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700">
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 uppercase">Confirmar</label>
          <input
            type={show ? "text" : "password"}
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-govisa-navy"
          />
        </div>
        {err && <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded-xl px-3 py-2">{err}</div>}
        <p className="text-xs text-slate-500">O usuário será obrigado a trocá-la no próximo login.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={props.onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-slate-100">Cancelar</button>
          <button disabled={loading} className="text-sm px-3 py-2 rounded-lg bg-govisa-navy text-white font-semibold hover:bg-slate-800 disabled:opacity-60 flex items-center gap-2">
            {loading ? "Salvando..." : (<><Copy className="w-3 h-3" /> Resetar e copiar</>)}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ChangeEmailModal(props: { user: User; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState(props.user.email);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${props.user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? "Erro"); return; }
      props.onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalShell title={`Editar email — ${props.user.email}`} onClose={props.onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-slate-600 uppercase">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-govisa-navy"
            autoFocus
          />
        </div>
        {err && <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded-xl px-3 py-2">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={props.onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-slate-100">Cancelar</button>
          <button disabled={loading} className="text-sm px-3 py-2 rounded-lg bg-govisa-navy text-white font-semibold hover:bg-slate-800 disabled:opacity-60">
            {loading ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={props.onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900">{props.title}</h2>
          <button onClick={props.onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>
        {props.children}
      </div>
    </div>
  );
}
