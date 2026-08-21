"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { Plan } from "@velozplanel/contracts";
import * as api from "@/lib/api";

/**
 * Planos dinâmicos vindos da API (não mais do enum `PLANS` do contracts).
 *
 * - `admin: false` (padrão) → GET /plans (só ativos; visão do cliente).
 * - `admin: true`           → GET /admin/plans (todos; para telas de admin
 *   que precisam resolver planos já desativados mas ainda em uso).
 *
 * Retorna a lista e um mapa id→Plan. Consumidores devem ser TOLERANTES: se um
 * ambiente aponta para um plano que não existe mais, `byId.get(id)` é
 * `undefined` — mostre o próprio id como rótulo de fallback.
 */
export function usePlans(opts: { admin?: boolean } = {}) {
  const admin = opts.admin ?? false;
  const q = useQuery({
    queryKey: admin ? ["admin", "plans"] : ["plans"],
    queryFn: admin ? api.listAdminPlans : api.listPlans,
    staleTime: 60_000,
  });

  const byId = React.useMemo(() => {
    const m = new Map<string, Plan>();
    for (const p of q.data ?? []) m.set(p.id, p);
    return m;
  }, [q.data]);

  return { ...q, plans: q.data ?? [], byId };
}
