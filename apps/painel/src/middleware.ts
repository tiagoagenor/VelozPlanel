import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Defesa extra no servidor: se o cookie de sessão `vp_session` não estiver
 * presente, redireciona para /login ANTES de renderizar a rota protegida.
 *
 * É uma checagem barata (presença do cookie, não validade — a validade é
 * confirmada pela API via `me()` no AuthGuard do cliente). Complementa, não
 * substitui, o guardião de cliente.
 */
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has("vp_session");
  if (hasSession) return NextResponse.next();

  const url = req.nextUrl.clone();
  const next = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

/**
 * Aplica a TODAS as rotas, exceto:
 *  - /login (público)
 *  - /_next/* (assets do Next), /favicon.ico e demais estáticos
 */
export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
