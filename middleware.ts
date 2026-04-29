import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import {
  sessionOptions,
  SESSION_TTL_SECONDS,
  type SessionData
} from "@/lib/auth/session";

// ATENÇÃO: o matcher abaixo EXCLUI `api/auth` e `change-password`, o que significa
// que nem `/api/auth/*` nem `/change-password` passam por este middleware — esses
// caminhos existem precisamente pra o usuário conseguir trocar a senha ou deslogar
// antes de ter sessão válida. Então a checagem de `mustChangePassword` abaixo só
// vale pra TODAS AS OUTRAS rotas (páginas + APIs). Ao adicionar novas rotas API
// que o usuário precisa acessar DURANTE o fluxo de troca obrigatória (ex: GET de
// perfil), adicione o path em `MUST_CHANGE_ALLOWED_APIS` — caso contrário ele
// retornará 403 até o `must_change_password` ser zerado.
export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|login|change-password).*)"
  ]
};

const MUST_CHANGE_ALLOWED_APIS = new Set<string>(["/api/me"]);

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  const path = req.nextUrl.pathname;

  const isApi = path.startsWith("/api/");
  const isAuthed = !!session.userId;
  if (!isAuthed) {
    if (isApi) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (session.mustChangePassword) {
    if (isApi) {
      if (!MUST_CHANGE_ALLOWED_APIS.has(path)) {
        return NextResponse.json(
          { error: "Troca de senha obrigatória" },
          { status: 403 }
        );
      }
    } else if (path !== "/change-password") {
      const url = req.nextUrl.clone();
      url.pathname = "/change-password";
      return NextResponse.redirect(url);
    }
  }

  if (path.startsWith("/admin") && session.role !== "admin") {
    const url = req.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url);
  }

  if (path.startsWith("/api/admin") && session.role !== "admin") {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  // Sliding session: renova o cookie quando mais de 50% do TTL já passou,
  // evitando que usuários ativos sejam deslogados exatamente 7 dias após o login.
  // Cookies pré-migração (sem createdAt) usam 0 aqui e são renovados na 1a request.
  // iron-session v8 injeta o Set-Cookie em `res` por referência em session.save()
  // (node_modules/iron-session/dist/index.js → setCookie(res, …) chama
  // res.headers.append("set-cookie", …)), então o `return res` abaixo carrega o
  // cookie renovado. NÃO trocar `res` por outro NextResponse aqui — perderia o cookie.
  const now = Math.floor(Date.now() / 1000);
  const createdAt = session.createdAt ?? 0;
  const elapsed = now - createdAt;
  if (elapsed > SESSION_TTL_SECONDS / 2) {
    session.createdAt = now;
    await session.save();
  }

  return res;
}
