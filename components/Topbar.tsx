"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, FileText, History, LayoutDashboard, Users } from "lucide-react";

export default function Topbar({
  user
}: {
  user: { email: string; name: string | null; role: "admin" | "user" };
}) {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }
  return (
    <header className="bg-govisa-navy text-white py-4 px-6">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 font-bold">
            <FileText className="w-5 h-5" />
            Go Visa Revisor
          </div>
          <nav className="flex items-center gap-1 text-sm">
            {user.role === "admin" && (
              <>
                <NavLink href="/admin" icon={<LayoutDashboard className="w-4 h-4" />}>
                  Dashboard
                </NavLink>
                <NavLink href="/admin/users" icon={<Users className="w-4 h-4" />}>
                  Usuários
                </NavLink>
                <NavLink href="/admin/revisoes" icon={<History className="w-4 h-4" />}>
                  Revisões
                </NavLink>
                <div className="w-px h-5 bg-white/20 mx-2" />
              </>
            )}
            <NavLink href="/app" icon={<FileText className="w-4 h-4" />}>
              Nova revisão
            </NavLink>
            <NavLink href="/app/historico" icon={<History className="w-4 h-4" />}>
              Histórico
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-semibold">{user.name ?? user.email}</div>
            <div className="text-xs text-white/60">{user.role === "admin" ? "Admin" : "Case Manager"}</div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium"
            title="Sair"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  icon,
  children
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/10 text-white/90 hover:text-white"
    >
      {icon}
      {children}
    </Link>
  );
}
