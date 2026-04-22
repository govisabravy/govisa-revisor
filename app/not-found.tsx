import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-md text-center">
        <div className="text-5xl font-bold text-slate-900 mb-2">404</div>
        <div className="text-slate-600 mb-4">Página não encontrada</div>
        <Link href="/" className="text-sm font-semibold text-govisa-navy hover:underline">
          Voltar pro início
        </Link>
      </div>
    </main>
  );
}
