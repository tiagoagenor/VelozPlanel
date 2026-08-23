"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  TerminalSquare,
  KeyRound,
  Copy,
  Check,
  Trash2,
  Plus,
  Info,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  Network,
  Download,
  Sparkles,
} from "lucide-react";
import type {
  SshConfig,
  SshAccessScope,
  UpdateSshConfigInput,
  GeneratedSshKey,
} from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";

/** Formato de IP/CIDR aceito (espelha o schema do contrato). */
const IP_CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Campo somente-leitura com botão de copiar (host, porta, usuário, comandos). */
function CopyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
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
        <code
          className={
            (mono ? "font-mono " : "") + "min-w-0 flex-1 truncate text-sm text-text"
          }
        >
          {value}
        </code>
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

export default function EnvSshPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const toast = useToast();

  const sshQuery = useQuery({
    queryKey: ["ssh", id],
    queryFn: () => api.getSsh(id),
  });
  const ssh = sshQuery.data;

  // Salva a configuração inteira (toggle / modo / escopo / allowlist).
  const save = useMutation({
    mutationFn: (input: UpdateSshConfigInput) => api.updateSsh(id, input),
    onSuccess: (updated) => {
      qc.setQueryData(["ssh", id], updated);
    },
    onError: (err) =>
      toast.show(
        "error",
        err instanceof Error ? err.message : "Não foi possível salvar.",
      ),
  });

  const addKey = useMutation({
    mutationFn: (input: { label: string; publicKey: string }) =>
      api.addSshKey(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ssh", id] });
      toast.show("success", "Chave adicionada.");
      setKeyLabel("");
      setKeyValue("");
      setKeyError(null);
    },
    onError: (err) => {
      const msg =
        err instanceof Error ? err.message : "Não foi possível adicionar a chave.";
      setKeyError(msg);
    },
  });

  const removeKey = useMutation({
    mutationFn: (keyId: string) => api.deleteSshKey(id, keyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ssh", id] });
      toast.show("success", "Chave removida.");
    },
    onError: (err) =>
      toast.show(
        "error",
        err instanceof Error ? err.message : "Não foi possível remover a chave.",
      ),
  });

  // Geração de chave NO SERVIDOR — a privada volta uma única vez.
  const [genLabel, setGenLabel] = React.useState("");
  const [generated, setGenerated] = React.useState<GeneratedSshKey | null>(null);
  const [genError, setGenError] = React.useState<string | null>(null);
  const [privCopied, setPrivCopied] = React.useState(false);
  const generate = useMutation({
    mutationFn: (label: string) => api.generateSshKey(id, { label }),
    onSuccess: (res) => {
      setGenerated(res); // mostra a privada UMA vez (não fica no servidor)
      setGenError(null);
      setGenLabel("");
      qc.invalidateQueries({ queryKey: ["ssh", id] });
    },
    onError: (err) =>
      setGenError(err instanceof Error ? err.message : "Não foi possível gerar a chave."),
  });

  // Nome do arquivo da chave privada: identificável e vinculado ao ambiente,
  // ex.: "vp-env_a5c1fecc-meu-notebook" (não só o rótulo cru).
  function keyFileName(): string {
    const user = ssh?.username ?? "velozplanel";
    const label = generated?.key.label ?? "";
    const raw = label ? `vp-${user}-${label}` : `vp-${user}-id_ed25519`;
    return (
      raw
        .replace(/[^A-Za-z0-9_.-]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^[_-]+|[_-]+$/g, "") || "id_ed25519"
    );
  }

  function downloadPrivateKey() {
    if (!generated) return;
    const safe = keyFileName();
    const blob = new Blob([generated.privateKey.endsWith("\n") ? generated.privateKey : generated.privateKey + "\n"], {
      type: "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safe;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Estado local do formulário de chave e do campo de IP.
  const [keyLabel, setKeyLabel] = React.useState("");
  const [keyValue, setKeyValue] = React.useState("");
  const [keyError, setKeyError] = React.useState<string | null>(null);
  const [ipDraft, setIpDraft] = React.useState("");
  const [ipError, setIpError] = React.useState<string | null>(null);

  // Helper: dispara um save mesclando o campo alterado sobre o estado atual.
  function patch(cfg: SshConfig, partial: Partial<UpdateSshConfigInput>) {
    save.mutate({
      enabled: cfg.enabled,
      authMode: "key",
      accessScope: cfg.accessScope,
      allowlist: cfg.allowlist,
      ...partial,
    });
  }

  if (sshQuery.isPending) {
    return (
      <div
        className="flex min-h-40 items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <Loader2
          size={28}
          aria-hidden="true"
          className="animate-spin text-brand-strong"
        />
        <span className="sr-only">Carregando…</span>
      </div>
    );
  }

  if (sshQuery.isError || !ssh) {
    return (
      <Card className="flex items-start gap-3">
        <AlertTriangle
          size={20}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-danger"
        />
        <p role="alert" className="font-medium text-text">
          Não foi possível carregar o acesso SSH deste ambiente.
        </p>
      </Card>
    );
  }

  const sshCmd = `ssh -p ${ssh.port} ${ssh.username}@${ssh.host}`;

  function addIp() {
    const v = ipDraft.trim();
    if (!v) return;
    if (!IP_CIDR_RE.test(v)) {
      setIpError("Informe um IP ou CIDR válido, ex.: 189.40.1.2 ou 189.40.0.0/16");
      return;
    }
    if (ssh!.allowlist.includes(v)) {
      setIpError("Este IP/CIDR já está na lista.");
      return;
    }
    setIpError(null);
    setIpDraft("");
    patch(ssh!, { allowlist: [...ssh!.allowlist, v] });
  }

  function removeIp(v: string) {
    patch(ssh!, { allowlist: ssh!.allowlist.filter((x) => x !== v) });
  }

  function submitKey(e: React.FormEvent) {
    e.preventDefault();
    setKeyError(null);
    if (!keyLabel.trim()) {
      setKeyError("Dê um rótulo para a chave (ex.: notebook do trabalho).");
      return;
    }
    if (!keyValue.trim()) {
      setKeyError("Cole a chave pública (linha começando com ssh-ed25519, ssh-rsa…).");
      return;
    }
    addKey.mutate({ label: keyLabel.trim(), publicKey: keyValue.trim() });
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-text">
          <TerminalSquare
            size={20}
            aria-hidden="true"
            className="text-brand-strong"
          />
          SSH / SFTP
        </h1>
        <p className="mt-1 text-sm text-text2">
          Configure o acesso por terminal (SSH) e transferência de arquivos
          (SFTP) deste ambiente.
        </p>
      </header>

      {/* Dados de conexão + comandos prontos */}
      <Card>
        <div className="flex flex-col gap-4">
          <h2 className="vp-accent-bar text-base font-semibold text-text">
            Dados de conexão
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CopyField label="Host" value={ssh.host} mono />
            <CopyField label="Porta" value={String(ssh.port)} mono />
            <CopyField label="Usuário" value={ssh.username} mono />
          </div>
          <div className="grid grid-cols-1 gap-4">
            <CopyField label="Conectar via SSH" value={sshCmd} mono />
          </div>
        </div>
      </Card>

      {/* Ativar acesso */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-text">Ativar acesso SSH</span>
            <span className="max-w-md text-sm text-text2">
              Libera o acesso por SSH (terminal) a este ambiente. O SSH é só por chave.
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={ssh.enabled}
            aria-label="Ativar acesso SSH"
            disabled={save.isPending}
            onClick={() => patch(ssh, { enabled: !ssh.enabled })}
            className={[
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full",
              "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
              ssh.enabled ? "bg-brand" : "bg-border",
            ].join(" ")}
          >
            <span
              className={[
                "inline-block h-5 w-5 transform rounded-full bg-surface shadow transition-transform duration-150",
                ssh.enabled ? "translate-x-5" : "translate-x-0.5",
              ].join(" ")}
              aria-hidden="true"
            />
          </button>
        </div>
      </Card>

      {/* Escopo de acesso */}
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span
              id="ssh-scope-label"
              className="vp-accent-bar text-base font-semibold text-text"
            >
              Acesso
            </span>
            <span className="text-sm text-text2">
              De onde as conexões podem partir.
            </span>
          </div>
          <SegmentedControl<SshAccessScope>
            label="Acesso"
            labelledBy="ssh-scope-label"
            value={ssh.accessScope}
            onChange={(v) => patch(ssh, { accessScope: v })}
            options={[
              { value: "any", label: "Qualquer IP" },
              { value: "allowlist", label: "Lista de IPs" },
            ]}
          />

          <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
            <ShieldCheck size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
            <span>
              Liberar de <strong>qualquer IP</strong> é comum e seguro quando a
              autenticação é por chave. Restringir por <strong>lista de IPs</strong>{" "}
              é mais fechado — bom para IPs fixos.
            </span>
          </p>

          {ssh.accessScope === "allowlist" ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ssh-ip">Adicionar IP ou CIDR</Label>
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-48 flex-1">
                    <Input
                      id="ssh-ip"
                      value={ipDraft}
                      inputMode="text"
                      placeholder="189.40.1.2 ou 189.40.0.0/16"
                      aria-invalid={ipError ? true : undefined}
                      aria-describedby={ipError ? "ssh-ip-error" : undefined}
                      onChange={(e) => {
                        setIpDraft(e.target.value);
                        if (ipError) setIpError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addIp();
                        }
                      }}
                    />
                  </div>
                  <Button
                    variant="outline"
                    onClick={addIp}
                    disabled={save.isPending}
                  >
                    <Plus size={16} aria-hidden="true" />
                    Adicionar
                  </Button>
                </div>
                {ipError ? (
                  <p id="ssh-ip-error" role="alert" className="text-sm text-danger">
                    {ipError}
                  </p>
                ) : null}
              </div>

              {ssh.allowlist.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {ssh.allowlist.map((ip) => (
                    <li
                      key={ip}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Network size={15} aria-hidden="true" className="shrink-0 text-text3" />
                        <code className="truncate font-mono text-sm text-text">{ip}</code>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeIp(ip)}
                        disabled={save.isPending}
                        aria-label={`Remover ${ip}`}
                        className="shrink-0 rounded p-1 text-text2 hover:bg-bg hover:text-danger disabled:opacity-50"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text3">
                  Nenhum IP na lista ainda. Sem IPs, nenhuma origem será liberada
                  quando o gateway ativar.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </Card>

      {/* Chaves SSH */}
      <Card>
        <div className="flex flex-col gap-4">
          <h2 className="vp-accent-bar flex items-center gap-2 text-base font-semibold text-text">
            <KeyRound size={18} aria-hidden="true" className="text-brand-strong" />
            Chaves SSH
          </h2>

          {ssh.keys.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {ssh.keys.map((k) => (
                <li
                  key={k.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface px-3 py-2.5"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium text-text">{k.label}</span>
                    <code className="truncate font-mono text-xs text-text2">
                      {k.fingerprint}
                    </code>
                    <span className="text-xs text-text3">
                      Adicionada em {formatDate(k.createdAt)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeKey.mutate(k.id)}
                    disabled={removeKey.isPending}
                    aria-label={`Remover chave ${k.label}`}
                    className="shrink-0 rounded p-1.5 text-text2 hover:bg-bg hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text3">
              Nenhuma chave pública cadastrada ainda.
            </p>
          )}

          {/* Reveal ÚNICO da chave privada recém-gerada */}
          {generated ? (
            <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
                <p className="text-sm text-text">
                  Esta é a <strong>única vez</strong> que a chave privada aparece. Baixe ou
                  copie agora e guarde em local seguro — o servidor <strong>não</strong> a
                  armazena e não há como recuperá-la depois. Se perder, gere outra e apague esta.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gen-priv">Chave privada ({generated.key.label})</Label>
                <textarea
                  id="gen-priv"
                  readOnly
                  value={generated.privateKey}
                  rows={8}
                  spellCheck={false}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={downloadPrivateKey}>
                  <Download size={16} aria-hidden="true" />
                  Baixar chave privada
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(generated.privateKey);
                      setPrivCopied(true);
                      setTimeout(() => setPrivCopied(false), 1500);
                    } catch {
                      /* ignora */
                    }
                  }}
                >
                  {privCopied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                  {privCopied ? "Copiada" : "Copiar"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setGenerated(null);
                    setPrivCopied(false);
                  }}
                >
                  Já guardei — fechar
                </Button>
              </div>
              <div className="flex flex-col gap-1.5 border-t border-border-subtle pt-3">
                <span className="text-xs font-medium text-text3">Conectar com esta chave</span>
                <code className="block overflow-x-auto rounded bg-surface px-3 py-2 font-mono text-xs text-text2">
                  ssh -i {keyFileName()} -p {ssh.port} {ssh.username}@{ssh.host}
                </code>
                <span className="text-xs text-text3">
                  No Linux/macOS, ajuste as permissões: <code>chmod 600 {keyFileName()}</code>
                </span>
              </div>
            </div>
          ) : null}

          {/* Gerar chave NO SERVIDOR (o painel cria o par e entrega a privada) */}
          <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg/50 p-4">
            <div className="flex items-start gap-2">
              <Sparkles size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-strong" />
              <p className="text-sm text-text2">
                Não tem uma chave? O painel gera um par <strong>ed25519</strong> para este
                ambiente e te entrega a <strong>chave privada</strong> para baixar. Só a
                pública fica no servidor.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
                <Label htmlFor="gen-label">Rótulo</Label>
                <Input
                  id="gen-label"
                  value={genLabel}
                  maxLength={60}
                  placeholder="ex.: meu-notebook"
                  onChange={(e) => setGenLabel(e.target.value)}
                />
              </div>
              <Button
                type="button"
                disabled={generate.isPending || genLabel.trim().length < 1}
                onClick={() => generate.mutate(genLabel.trim())}
              >
                {generate.isPending ? (
                  <Loader2 size={16} aria-hidden="true" className="animate-spin" />
                ) : (
                  <Sparkles size={16} aria-hidden="true" />
                )}
                {generate.isPending ? "Gerando…" : "Gerar chave"}
              </Button>
            </div>
            {genError ? (
              <p role="alert" className="text-sm text-danger">
                {genError}
              </p>
            ) : null}
          </div>

          {/* Formulário de nova chave */}
          <form
            onSubmit={submitKey}
            className="flex flex-col gap-3 border-t border-border-subtle pt-4"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-label">Rótulo</Label>
              <Input
                id="key-label"
                value={keyLabel}
                maxLength={60}
                placeholder="ex.: notebook do trabalho"
                onChange={(e) => setKeyLabel(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-value">Chave pública</Label>
              <textarea
                id="key-value"
                value={keyValue}
                rows={3}
                spellCheck={false}
                placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... comentário"
                aria-invalid={keyError ? true : undefined}
                aria-describedby={keyError ? "key-error" : undefined}
                onChange={(e) => setKeyValue(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text placeholder:text-text3"
              />
              <p className="text-xs text-text3">
                Cole apenas a chave <strong>pública</strong> (o conteúdo do
                arquivo <code>.pub</code>). Nunca envie a chave privada.
              </p>
            </div>
            {keyError ? (
              <p id="key-error" role="alert" className="text-sm text-danger">
                {keyError}
              </p>
            ) : null}
            <div>
              <Button type="submit" disabled={addKey.isPending}>
                <Plus size={16} aria-hidden="true" />
                {addKey.isPending ? "Adicionando…" : "Adicionar chave"}
              </Button>
            </div>
          </form>
        </div>
      </Card>

      {/* Mensagem honesta vinda da API */}
      {ssh.message ? (
        <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
          <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
          <span>{ssh.message}</span>
        </p>
      ) : null}

      {/* Nota honesta fixa sobre a limitação do núcleo */}
      <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
        <AlertTriangle
          size={16}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-warning"
        />
        <span>
          Toda a configuração fica salva. O acesso SSH/SFTP passa a valer quando
          o <strong>gateway SSH/SFTP</strong> for provisionado (fase de infra),
          assim como o SSL. No núcleo local ainda <strong>não há</strong> gateway
          aceitando conexão — os dados acima são o que você usará quando ele
          estiver ativo.
        </span>
      </p>
    </div>
  );
}
