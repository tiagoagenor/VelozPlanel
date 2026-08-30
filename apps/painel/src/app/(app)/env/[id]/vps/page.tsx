"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Server, Copy, Check, Loader2, KeyRound, Globe, ShieldCheck, ShieldAlert } from "lucide-react";
import type { VpsInfo } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const STATE_LABEL: Record<VpsInfo["state"], { label: string; cls: string }> = {
  provisioning: { label: "Provisionando…", cls: "bg-amber-500/15 text-amber-600" },
  running: { label: "Ligada", cls: "bg-emerald-500/15 text-emerald-600" },
  paused: { label: "Pausada", cls: "bg-bg text-text3" },
  shutoff: { label: "Desligada", cls: "bg-bg text-text3" },
  unknown: { label: "Desconhecido", cls: "bg-bg text-text3" },
  absent: { label: "Ausente", cls: "bg-red-500/15 text-red-600" },
  error: { label: "Erro", cls: "bg-red-500/15 text-red-600" },
};

/** Campo somente-leitura com botão de copiar. */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="space-y-1">
      <div className="text-[13px] font-medium text-text2">{label}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-bg px-2.5 py-1.5 text-[13px] text-text">
          {value}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

export default function VpsPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ["vps", id],
    queryFn: () => api.getVpsInfo(id),
    // Enquanto provisiona/muda de estado, acompanha ao vivo.
    refetchInterval: (query) => {
      const s = query.state.data?.state;
      return s === "provisioning" || s === "unknown" ? 4000 : 15000;
    },
  });

  if (q.isPending) {
    return (
      <div className="flex items-center gap-2 p-6 text-text3">
        <Loader2 className="size-4 animate-spin" /> Carregando dados do VPS…
      </div>
    );
  }
  if (q.isError || !q.data) {
    return <div className="p-6 text-text3">Não foi possível carregar o VPS.</div>;
  }

  const vps = q.data;
  const st = STATE_LABEL[vps.state];
  const sshReady = vps.sshHost && vps.sshUser;
  const sshCmd = sshReady ? `ssh -p ${vps.sshPort} ${vps.sshUser}@${vps.sshHost}` : null;

  return (
    <div className="space-y-4 p-1">
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Server className="size-5 text-text2" />
            <h2 className="text-[15px] font-semibold text-text">Sua VPS (KVM)</h2>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${st.cls}`}>{st.label}</span>
        </div>
        <p className="mt-1.5 text-[13px] text-text3">
          Máquina virtual completa — você é root e livre para instalar o que quiser (inclusive Docker).
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <div className="text-[13px] font-medium text-text2">IP interno</div>
            <code className="block rounded-md border border-border bg-bg px-2.5 py-1.5 text-[13px] text-text">
              {vps.ip ?? "—"}
            </code>
          </div>
          <div className="space-y-1">
            <div className="text-[13px] font-medium text-text2">Porta web (atrás do proxy)</div>
            <code className="block rounded-md border border-border bg-bg px-2.5 py-1.5 text-[13px] text-text">
              {vps.upstreamPort}
            </code>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-2.5">
          <KeyRound className="size-5 text-text2" />
          <h3 className="text-[15px] font-semibold text-text">Acesso SSH</h3>
        </div>
        {sshCmd ? (
          <div className="mt-3 space-y-3">
            <CopyField label="Conectar" value={sshCmd} />
            <div className="flex items-center gap-2 text-[13px] text-text3">
              {vps.hostKeyKnown ? (
                <>
                  <ShieldCheck className="size-4 text-emerald-600" /> Host key da VM fixada (verificada pelo gateway).
                </>
              ) : (
                <>
                  <ShieldAlert className="size-4 text-amber-600" /> Host key ainda não fixada — aguarde o boot concluir.
                </>
              )}
            </div>
            <p className="text-[13px] text-text3">
              Entra com a sua chave privada. Não tem chave cadastrada?{" "}
              <Link href={`/env/${id}/ssh`} className="font-medium text-text2 underline">
                Adicione uma chave SSH
              </Link>
              .
            </p>
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-text3">
            O gateway SSH ainda não está disponível para este nó. Assim que a borda estiver ativa, o comando de
            conexão aparece aqui.
          </p>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-2.5">
          <Globe className="size-5 text-text2" />
          <h3 className="text-[15px] font-semibold text-text">Domínio</h3>
        </div>
        {vps.domain ? (
          <p className="mt-3 text-[13px] text-text3">
            <code className="rounded bg-bg px-1.5 py-0.5 text-text">{vps.domain}</code> aponta para esta VM (porta{" "}
            {vps.upstreamPort}) via proxy. Configure o A record do domínio para o host do nó.
          </p>
        ) : (
          <p className="mt-3 text-[13px] text-text3">
            Nenhum domínio configurado.{" "}
            <Link href={`/env/${id}/dominio`} className="font-medium text-text2 underline">
              Configurar domínio
            </Link>
            .
          </p>
        )}
      </Card>
    </div>
  );
}
