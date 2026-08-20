"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Box,
  Server,
  Globe2,
  type LucideIcon,
} from "lucide-react";
import type { ModuleInfo } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CenterLoader } from "@/components/Skeletons";

type Scope = ModuleInfo["scope"];
type Status = ModuleInfo["status"];

const SCOPE_META: Record<Scope, { label: string; icon: LucideIcon }> = {
  environment: { label: "Ambiente", icon: Box },
  node: { label: "Nó", icon: Server },
  platform: { label: "Plataforma", icon: Globe2 },
};

const STATUS_META: Record<Status, { tone: "brand" | "success" | "neutral"; label: string }> = {
  builtin: { tone: "brand", label: "Nativo" },
  active: { tone: "success", label: "Ativo" },
  planned: { tone: "neutral", label: "Planejado" },
};

export default function AdminModulesPage() {
  const q = useQuery({ queryKey: ["admin", "modules"], queryFn: api.listModules });

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight text-text">Módulos</h1>
        <p className="mt-1 text-sm text-text2">
          Catálogo de capacidades da plataforma e seu estágio.
        </p>
      </header>

      {q.isPending ? (
        <CenterLoader minHeight="40vh" />
      ) : q.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">Não foi possível carregar os módulos.</p>
        </Card>
      ) : q.data.length === 0 ? (
        <Card><p className="text-text2">Nenhum módulo no catálogo.</p></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((mod) => {
            const scope = SCOPE_META[mod.scope];
            const status = STATUS_META[mod.status];
            const ScopeIcon = scope.icon;
            return (
              <Card key={mod.key} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                    <ScopeIcon size={20} />
                  </span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
                <div>
                  <p className="font-semibold text-text">{mod.label}</p>
                  <p className="mt-1 text-sm text-text2">{mod.description}</p>
                </div>
                <p className="mt-auto flex items-center gap-1.5 text-xs text-text3">
                  <ScopeIcon size={13} aria-hidden="true" />
                  Escopo: {scope.label}
                </p>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
