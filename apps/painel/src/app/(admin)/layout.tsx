"use client";

/*
 * ─────────────────────────────────────────────────────────────────────────
 *  VelozPanel — Casca da área de SUPER ADMIN (route group `(admin)`)
 *
 *  Grupo `(admin)`: não muda URLs (as rotas seguem em /admin/*). Tudo aqui
 *  roda DENTRO de <AdminAuthGuard> (sessão confirmada por me() E papel admin
 *  exigido) e da casca própria <AdminShell> — visual DISTINTO do painel do
 *  cliente para nunca confundir o contexto.
 *
 *  NAVEGAÇÃO (definida em components/AdminShell.tsx → NAV):
 *    Visão geral   /admin
 *    Servidores    /admin/nodes
 *    Usuários      /admin/usuarios
 *    Ambientes     /admin/ambientes
 *    Rede          /admin/rede
 *    Planos        /admin/planos
 *    Módulos       /admin/modulos
 *    Auditoria     /admin/auditoria
 *    ‹ Voltar ao painel do cliente  → "/"
 * ─────────────────────────────────────────────────────────────────────────
 */

import { AdminAuthGuard } from "@/components/AdminAuthGuard";
import { AdminShell } from "@/components/AdminShell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminAuthGuard>
      <AdminShell>{children}</AdminShell>
    </AdminAuthGuard>
  );
}
