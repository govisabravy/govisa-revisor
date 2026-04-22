"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Plus, RotateCcw, UserX } from "lucide-react";

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

export default function UsersPage() {
  const [rows, setRows] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch("/api/admin/users");
    const d = await res.json();
    setRows(d.items ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function changeRole(id: string, role: "admin" | "user") {
    await fetch(`/api/admin/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
    load();
  }
  async function toggleActive(u: User) {
    if (!confirm(`${u.active ? "Desativar" : "Reativar"} ${u.email}?`)) return;
    if (u.active) {
      await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
    } else {
      await fetch(`/api/admin/users/${u.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: 1 }) });
    }
    load();
  }
  async function resetPassword(u: User) {
    const pwd = prompt(`Nova senha temporária para ${u.email}:`);
    if (!pwd || pwd.length < 8) return alert("Mínimo 8 caracteres");
    await fetch(`/api/admin/users/${u.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset_password: pwd }) });
    alert("Senha resetada");
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
                        <button onClick={() => resetPassword(u)} className="text-xs bg-slate-100 hover:bg-slate-200 rounded px-2 py-1 flex items-center gap-1"><RotateCcw className="w-3 h-3" /> reset</button>
                        <button onClick={() => toggleActive(u)} className={`text-xs rounded px-2 py-1 flex items-center gap-1 ${u.active ? "bg-rose-100 hover:bg-rose-200 text-rose-800" : "bg-emerald-100 hover:bg-emerald-200 text-emerald-800"}`}><UserX className="w-3 h-3" /> {u.active ? "desativar" : "reativar"}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
