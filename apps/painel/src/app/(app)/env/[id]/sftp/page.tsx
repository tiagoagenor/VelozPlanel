"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderSync,
  KeyRound,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Info,
  ShieldCheck,
} from "lucide-react";
import type { SftpConfig } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR");
}

/** Campo somente-leitura com botão de copiar. */
function CopyField({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.show("error", "Não foi possível copiar.");
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-text3">{label}</span>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-sm text-text">{value}</code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copiar ${label}`}
          className="shrink-0 rounded p-1 text-text2 hover:bg-bg hover:text-brand-strong"
        >
          {copied ? (
            <Check size={16} aria-hidden="true" className="text-success" />
          ) : (
            <Copy size={16} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

export default function EnvSftpPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const toast = useToast();

  const sftpQuery = useQuery({
    queryKey: ["sftp", id],
    queryFn: () => api.getSftp(id),
  });
  const sftp = sftpQuery.data;

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.setSftpEnabled(id, { enabled }),
    onSuccess: (updated) => qc.setQueryData(["sftp", id], updated),
    onError: (err) =>
      toast.show("error", err instanceof Error ? err.message : "Não foi possível salvar."),
  });

  const [revealed, setRevealed] = React.useState<string | null>(null);
  const [pwCopied, setPwCopied] = React.useState(false);
  const resetPw = useMutation({
    mutationFn: () => api.resetSftpPassword(id),
    onSuccess: (res) => {
      setRevealed(res.password); // mostra a senha UMA vez (só o hash fica no servidor)
      setPwCopied(false);
      qc.invalidateQueries({ queryKey: ["sftp", id] });
    },
    onError: (err) =>
      toast.show("error", err instanceof Error ? err.message : "Não foi possível gerar a senha."),
  });

  if (sftpQuery.isPending) {
    return (
      <div className="flex min-h-40 items-center justify-center" role="status" aria-live="polite">
        <Loader2 size={28} aria-hidden="true" className="animate-spin text-brand-strong" />
        <span className="sr-only">Carregando…</span>
      </div>
    );
  }

  if (sftpQuery.isError || !sftp) {
    return (
      <Card className="flex items-start gap-3">
        <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
        <p role="alert" className="font-medium text-text">
          Não foi possível carregar o acesso SFTP deste ambiente.
        </p>
      </Card>
    );
  }

  const sftpCmd = `sftp -P ${sftp.port} ${sftp.username}@${sftp.host}`;

  return (
    <div className="flex flex-col gap-5">
      {/* Dados de conexão */}
      <Card>
        <div className="flex flex-col gap-4">
          <h2 className="vp-accent-bar flex items-center gap-2 text-base font-semibold text-text">
            <FolderSync size={18} aria-hidden="true" className="text-brand-strong" />
            SFTP — transferência de arquivos
          </h2>
          <p className="text-sm text-text2">
            O SFTP é <strong>só por senha</strong> (porta {sftp.port}) e serve só para
            transferir arquivos — não abre terminal. Para shell, use o{" "}
            <strong>SSH</strong> (por chave). A senha é gerada aqui e mostrada uma
            única vez.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CopyField label="Host" value={sftp.host} />
            <CopyField label="Porta" value={String(sftp.port)} />
            <CopyField label="Usuário" value={sftp.username} />
          </div>
          <CopyField label="Conectar via SFTP" value={sftpCmd} />
        </div>
      </Card>

      {/* Ativar SFTP */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-text">Ativar SFTP</span>
            <span className="max-w-md text-sm text-text2">
              Libera o acesso por SFTP (arquivos) a este ambiente. Gerar uma senha
              já liga o SFTP automaticamente.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sftp.enabled}
            aria-label="Ativar SFTP"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(!sftp.enabled)}
            className={[
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full",
              "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
              sftp.enabled ? "bg-brand" : "bg-border",
            ].join(" ")}
          >
            <span
              className={[
                "inline-block h-5 w-5 transform rounded-full bg-surface shadow transition-transform duration-150",
                sftp.enabled ? "translate-x-5" : "translate-x-0.5",
              ].join(" ")}
              aria-hidden="true"
            />
          </button>
        </div>
      </Card>

      {/* Senha */}
      <Card>
        <div className="flex flex-col gap-4">
          <h2 className="vp-accent-bar flex items-center gap-2 text-base font-semibold text-text">
            <KeyRound size={18} aria-hidden="true" className="text-brand-strong" />
            Senha do SFTP
          </h2>

          {/* Reveal ÚNICO da senha recém-gerada */}
          {revealed ? (
            <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
                <p className="text-sm text-text">
                  Esta é a <strong>única vez</strong> que a senha aparece. Copie e guarde
                  agora — o servidor guarda só o hash e não há como recuperá-la. Se perder,
                  gere outra (a antiga deixa de valer).
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-sm text-text">{revealed}</code>
                <button
                  type="button"
                  aria-label="Copiar senha"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(revealed);
                      setPwCopied(true);
                      window.setTimeout(() => setPwCopied(false), 1500);
                    } catch {
                      /* ignora */
                    }
                  }}
                  className="shrink-0 rounded p-1 text-text2 hover:bg-bg hover:text-brand-strong"
                >
                  {pwCopied ? (
                    <Check size={16} aria-hidden="true" className="text-success" />
                  ) : (
                    <Copy size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
              <div>
                <Button type="button" variant="ghost" onClick={() => setRevealed(null)}>
                  Já guardei — fechar
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-text2">
              {sftp.hasPassword
                ? `Senha definida${sftp.passwordSetAt ? ` em ${formatDate(sftp.passwordSetAt)}` : ""}. Você pode resetar a qualquer momento (gera uma nova aleatória).`
                : "Nenhuma senha definida ainda. Gere uma para conectar por SFTP."}
            </p>
          )}

          <div>
            <Button onClick={() => resetPw.mutate()} disabled={resetPw.isPending}>
              {resetPw.isPending ? (
                <Loader2 size={16} aria-hidden="true" className="animate-spin" />
              ) : (
                <RefreshCw size={16} aria-hidden="true" />
              )}
              {resetPw.isPending
                ? "Gerando…"
                : sftp.hasPassword
                  ? "Resetar senha"
                  : "Gerar senha"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Mensagem honesta vinda da API */}
      {sftp.message ? (
        <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
          <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
          <span>{sftp.message}</span>
        </p>
      ) : null}

      <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
        <ShieldCheck size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
        <span>
          A senha é sempre aleatória e guardada só como hash. O SFTP não dá acesso a
          terminal — apenas leitura/escrita dos arquivos do ambiente.
        </span>
      </p>
    </div>
  );
}
