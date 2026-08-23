"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, XCircle, Loader2, Rocket, ChevronRight, ChevronDown, Circle } from "lucide-react";
import * as api from "@/lib/api";
import { Card } from "@/components/ui/card";

const STEP_LABEL: Record<string, string> = {
  git_sync: "Baixar código (git)",
  composer_install: "Instalar dependências (composer)",
  npm_ci: "Instalar dependências (npm)",
  npm_build: "Build",
  php_migrate: "Migrações do banco",
  artisan_migrate: "Migrações do banco (artisan)",
  artisan_optimize: "Cache config/rotas/views",
  artisan_storage_link: "Link de storage",
  node_restart: "Reiniciar o app",
  shell: "Comando personalizado",
  project_dir: "Pasta do projeto",
};

type StepStatus = "success" | "failed" | "running" | "pending";
interface Section { id: string; label: string; status: StepStatus; lines: string[] }

/** Converte o log com marcadores ::vp:... numa lista de passos (com o log de cada um). */
function parseSteps(log: string, runStatus: string): Section[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  const open = (id: string, label: string) => { cur = { id: id + ":" + sections.length, label, status: "running", lines: [] }; sections.push(cur); };
  const close = (ok: boolean) => { if (cur) { cur.status = ok ? "success" : "failed"; cur = null; } };
  for (const l of log.split("\n")) {
    let m: RegExpExecArray | null;
    if (/^::vp:phase:build/.test(l)) continue;
    if (/^::vp:phase:place/.test(l)) { close(true); open("place", "Colocar arquivos no ambiente"); continue; }
    if (l === "::vp:placed") { close(true); continue; }
    if (/^::vp:phase:restart/.test(l)) { close(true); open("restart", "Reiniciar o app"); continue; }
    if ((m = /^::vp:step:([a-z_]+):start/.exec(l))) { close(true); open(m[1]!, STEP_LABEL[m[1]!] ?? m[1]!); continue; }
    if ((m = /^::vp:step:([a-z_]+):exit:(\d+)/.exec(l))) { close(m[2] === "0"); continue; }
    if (l === "::vp:done") { close(true); continue; }
    if (cur) (cur as Section).lines.push(l);
  }
  if (cur && runStatus !== "running") (cur as Section).status = runStatus === "success" ? "success" : "failed";
  return sections;
}

function StepIcon({ s }: { s: StepStatus }) {
  if (s === "success") return <CheckCircle2 size={16} className="text-success" />;
  if (s === "failed") return <XCircle size={16} className="text-danger" />;
  if (s === "running") return <Loader2 size={16} className="animate-spin text-info" />;
  return <Circle size={16} className="text-text3" />;
}

export default function DeployRunPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const [overrides, setOverrides] = React.useState<Record<string, boolean>>({});
  const q = useQuery({
    queryKey: ["deploy-run-log", id, runId],
    queryFn: () => api.getDeployRunLog(id, runId),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 1500 : false),
  });

  const status = q.data?.status ?? "running";
  const running = status === "running";
  const sections = React.useMemo(() => parseSteps(q.data?.log ?? "", status), [q.data?.log, status]);

  const isOpen = (sec: Section) => (sec.id in overrides ? overrides[sec.id]! : sec.status === "running" || sec.status === "failed");
  const toggle = (sec: Section) => setOverrides((o) => ({ ...o, [sec.id]: !isOpen(sec) }));

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/env/${id}/deploy`} className="inline-flex items-center gap-1 text-sm text-link hover:underline"><ArrowLeft size={14} /> Voltar para Deploy</Link>

      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="vp-accent-bar flex items-center gap-2 text-base font-semibold text-text"><Rocket size={18} className="text-brand-strong" /> Deploy</h2>
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {running ? <><Loader2 size={16} className="animate-spin text-info" /> <span className="text-info">Rodando…</span></>
                : status === "success" ? <><CheckCircle2 size={16} className="text-success" /> <span className="text-success">Concluído</span></>
                : <><XCircle size={16} className="text-danger" /> <span className="text-danger">Falhou</span></>}
            </span>
          </div>

          {sections.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-sm text-text3"><Loader2 size={15} className="animate-spin" /> preparando o deploy…</div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {sections.map((sec) => {
                const open = isOpen(sec);
                return (
                  <li key={sec.id} className={`rounded-lg border ${sec.status === "failed" ? "border-danger/40" : "border-border-subtle"} bg-surface`}>
                    <button type="button" onClick={() => toggle(sec)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm">
                      <StepIcon s={sec.status} />
                      <span className={`font-medium ${sec.status === "success" ? "text-success" : sec.status === "failed" ? "text-danger" : "text-text"}`}>{sec.label}</span>
                      {sec.lines.length ? <span className="ml-auto text-xs text-text3">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span> : <span className="ml-auto" />}
                    </button>
                    {open && sec.lines.length ? (
                      <pre className="max-h-72 overflow-auto border-t border-border-subtle bg-[#0d1117] px-4 py-3 font-mono text-xs leading-relaxed text-[#c9d1d9]">
{sec.lines.join("\n").trim() || "(sem saída)"}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="text-xs text-text3">
            {running ? "Atualizando ao vivo… clique num passo para ver/ocultar o log dele. Pode sair da tela; o log fica salvo no histórico."
              : status === "success" ? "Deploy concluído. Clique em qualquer passo para ver o log. Salvo no histórico."
              : "Deploy falhou — abra o passo em vermelho para ver onde parou. Salvo no histórico."}
          </div>
        </div>
      </Card>
    </div>
  );
}
