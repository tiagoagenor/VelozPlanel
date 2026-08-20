"use client";

/*
 * ─────────────────────────────────────────────────────────────────────────
 *  VelozPanel — Casca da aplicação (rotas autenticadas)
 *
 *  Route group `(app)`: não muda URLs (só agrupa layout). Tudo aqui roda
 *  DENTRO de <AuthGuard> (sessão confirmada por me() antes de renderizar) e
 *  da casca de 3 zonas <AppShell> (sidebar 256px · topbar 56px · conteúdo).
 *  O /login fica FORA deste grupo → sem sidebar/topbar.
 *
 *  ESTRUTURA DE NAVEGAÇÃO (definida em components/AppShell.tsx → NAV):
 *    PRINCIPAL
 *      Ambientes         /            (ativo — lista de ambientes)
 *      Domínios          /dominios     (Em breve → tela honesta, não 404)
 *      Bancos de dados   /bancos       (Em breve)
 *      Financeiro        /financeiro   (Em breve)
 *      Suporte           /suporte      (Em breve)
 *    ADMIN  (renderiza só se me().role === 'admin')
 *      Visão geral       /admin        (ativo)
 *      Nós               /admin/nodes  (ativo)
 *
 *  DECISÕES:
 *    - Sidebar colapsável (72px, persiste em localStorage "vp-sidebar-collapsed");
 *      no mobile (<1024px) vira drawer off-canvas com overlay.
 *    - Item ativo: fundo roxo-suave + ícone/label roxo + barra de acento 3px +
 *      aria-current="page". Ícones Lucide (import nomeado, tree-shaken).
 *    - "Em breve": item clicável que leva a uma tela honesta (ComingSoon), com
 *      badge cinza — nunca item desabilitado confuso nem 404.
 *    - Conteúdo: máx. 1200px centralizado sobre fundo cinza; cards brancos.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { AuthGuard } from "@/components/AuthGuard";
import { AppShell } from "@/components/AppShell";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <AppShell>{children}</AppShell>
    </AuthGuard>
  );
}
