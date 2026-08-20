"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Copy,
  Database as DatabaseIcon,
  KeyRound,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { createDatabaseInput } from "@velozplanel/contracts";
import type { Database, DatabaseWithSecret } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";

export default function EnvBancoPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const toast = useToast();

  const [createOpen, setCreateOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<Database | null>(null);
  // Credenciais recém-criadas — mostradas UMA vez (a senha nunca volta da API).
  const [credentials, setCredentials] = React.useState<DatabaseWithSecret | null>(
    null,
  );

  const query = useQuery({
    queryKey: ["databases", id],
    queryFn: () => api.listDatabases(id),
  });

  const databases = query.data ?? [];

  return (
    <>
      {/* Cabeçalho da seção */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-text">Banco de dados</h1>
          <p className="text-sm text-text2">
            Bancos MySQL (MariaDB) deste ambiente, cada um com usuário e senha
            próprios.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus size={16} aria-hidden="true" />
          Criar banco
        </Button>
      </div>

      {/* Cartão de credenciais recém-criadas (revelado uma vez) */}
      {credentials ? (
        <CredentialsCard
          data={credentials}
          onDismiss={() => setCredentials(null)}
        />
      ) : null}

      {/* Conteúdo: loading / erro / vazio / lista */}
      {query.isPending ? (
        <div className="grid place-items-center py-16">
          <div
            role="status"
            aria-label="Carregando bancos"
            className="h-8 w-8 animate-spin rounded-full border-2 border-border-subtle border-t-brand"
          />
        </div>
      ) : query.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle
            size={20}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-danger"
          />
          <p role="alert" className="font-medium text-text">
            Não foi possível carregar os bancos deste ambiente.
          </p>
        </Card>
      ) : databases.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <ul className="flex flex-col gap-3">
          {databases.map((d) => (
            <li key={d.id}>
              <DatabaseRow db={d} onDelete={() => setToDelete(d)} />
            </li>
          ))}
        </ul>
      )}

      <CreateDatabaseDialog
        envId={id}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          setCredentials(created);
          setCreateOpen(false);
          qc.invalidateQueries({ queryKey: ["databases", id] });
          toast.show("success", `Banco "${created.name}" criado.`);
        }}
      />

      <DeleteDatabaseDialog
        envId={id}
        target={toDelete}
        onClose={() => setToDelete(null)}
        onDeleted={(name) => {
          setToDelete(null);
          qc.invalidateQueries({ queryKey: ["databases", id] });
          toast.show("success", `Banco "${name}" excluído.`);
        }}
      />
    </>
  );
}

/* ─────────────── Estado vazio ─────────────── */

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-strong">
        <DatabaseIcon size={24} aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-text">Nenhum banco ainda</p>
        <p className="text-sm text-text2">
          Crie um banco MySQL para este ambiente — geramos usuário e senha na
          hora.
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <Plus size={16} aria-hidden="true" />
        Criar banco
      </Button>
    </Card>
  );
}

/* ─────────────── Linha de um banco ─────────────── */

function DatabaseRow({ db, onDelete }: { db: Database; onDelete: () => void }) {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong">
          <DatabaseIcon size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-semibold text-text">
            {db.name}
          </p>
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text2">
            <div className="flex gap-1">
              <dt className="text-text3">Usuário:</dt>
              <dd className="font-mono">{db.dbUser}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-text3">Host:</dt>
              <dd className="font-mono">
                {db.host}:{db.port}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-text3">Criado em:</dt>
              <dd>{formatDateTime(db.createdAt)}</dd>
            </div>
          </dl>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onDelete}
        aria-label={`Excluir banco ${db.name}`}
      >
        <Trash2 size={16} aria-hidden="true" />
        Excluir
      </Button>
    </Card>
  );
}

/* ─────────────── Cartão de credenciais (uma vez) ─────────────── */

function CredentialsCard({
  data,
  onDismiss,
}: {
  data: DatabaseWithSecret;
  onDismiss: () => void;
}) {
  return (
    <Card className="mb-6 border-brand/40 bg-brand-soft/40">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-on-solid">
            <KeyRound size={18} aria-hidden="true" />
          </span>
          <div>
            <p className="font-semibold text-text">Credenciais do banco</p>
            <p className="text-sm text-text2">
              Guarde a senha agora — não vamos mostrá-la de novo.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dispensar credenciais"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-text2 hover:bg-bg"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <CopyField label="Host" value={data.host} />
        <CopyField label="Porta" value={String(data.port)} />
        <CopyField label="Database" value={data.name} />
        <CopyField label="Usuário" value={data.dbUser} />
        <div className="sm:col-span-2">
          <CopyField label="Senha" value={data.password} mono sensitive />
        </div>
      </div>

      <p
        role="alert"
        className="mt-3 flex items-center gap-2 text-xs font-medium text-text2"
      >
        <AlertTriangle size={14} aria-hidden="true" className="text-warning" />
        A senha não é armazenada em texto e não pode ser recuperada depois.
      </p>
    </Card>
  );
}

function CopyField({
  label,
  value,
  mono,
  sensitive,
}: {
  label: string;
  value: string;
  mono?: boolean;
  sensitive?: boolean;
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
            (mono || sensitive ? "font-mono " : "") +
            "min-w-0 flex-1 truncate text-sm text-text"
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

/* ─────────────── Diálogo: criar banco ─────────────── */

function CreateDatabaseDialog({
  envId,
  open,
  onClose,
  onCreated,
}: {
  envId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (created: DatabaseWithSecret) => void;
}) {
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: { name: string }) => api.createDatabase(envId, input),
    onSuccess: (created) => {
      setName("");
      setError(null);
      onCreated(created);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Falha ao criar o banco.");
      }
    },
  });

  function close() {
    if (mutation.isPending) return;
    setName("");
    setError(null);
    onClose();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createDatabaseInput.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Nome inválido.");
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Criar banco"
      description="Damos ao banco um nome único no servidor e geramos usuário e senha dedicados."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="db-name">Nome do banco</Label>
          <Input
            id="db-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="loja"
            aria-describedby="db-name-help"
            autoComplete="off"
            autoFocus
            required
          />
          <p id="db-name-help" className="text-xs text-text3">
            2 a 32 caracteres: comece com letra; use letras minúsculas, números e
            _.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="flex items-center gap-2 text-sm font-medium text-danger"
          >
            <AlertTriangle size={16} aria-hidden="true" />
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Criando…" : "Criar banco"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ─────────────── Diálogo: excluir banco (confirma digitando o nome) ─────────────── */

function DeleteDatabaseDialog({
  envId,
  target,
  onClose,
  onDeleted,
}: {
  envId: string;
  target: Database | null;
  onClose: () => void;
  onDeleted: (name: string) => void;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = React.useState("");

  // Zera o campo sempre que abrir para um banco diferente.
  React.useEffect(() => {
    setConfirm("");
  }, [target?.id]);

  const mutation = useMutation({
    mutationFn: () => api.deleteDatabase(envId, target!.id),
    onSuccess: () => {
      onDeleted(target!.name);
    },
    onError: (err) => {
      toast.show(
        "error",
        err instanceof Error ? err.message : "Falha ao excluir o banco.",
      );
    },
  });

  const matches = target != null && confirm === target.name;

  return (
    <Dialog
      open={target != null}
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
      title="Excluir banco"
      description="Esta ação apaga o banco e o usuário no servidor. Não dá para desfazer."
    >
      {target ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (matches && !mutation.isPending) mutation.mutate();
          }}
          className="flex flex-col gap-5"
          noValidate
        >
          <p className="text-sm text-text2">
            Todos os dados de <span className="font-mono font-semibold text-text">{target.name}</span>{" "}
            serão perdidos. Para confirmar, digite o nome do banco abaixo.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="db-confirm">Nome do banco</Label>
            <Input
              id="db-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={target.name}
              autoComplete="off"
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={!matches || mutation.isPending}
            >
              {mutation.isPending ? "Excluindo…" : "Excluir banco"}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
