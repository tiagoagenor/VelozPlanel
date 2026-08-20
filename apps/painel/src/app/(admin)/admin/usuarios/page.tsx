"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  UserPlus,
  Pencil,
  Trash2,
  Ban,
  CheckCircle2,
  ShieldCheck,
  User as UserIcon,
  AlertTriangle,
  Boxes,
} from "lucide-react";
import {
  createUserInput,
  updateUserInput,
  type AdminUser,
  type UserRole,
  type AccountStatus,
} from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { CenterLoader } from "@/components/Skeletons";
import { EnvStateBadge } from "@/components/EnvStateBadge";
import { formatDateTime } from "@/lib/format";

function RoleBadge({ role }: { role: UserRole }) {
  return role === "admin" ? (
    <Badge tone="accent" aria-label="Papel: administrador">
      <ShieldCheck size={13} aria-hidden="true" />
      Admin
    </Badge>
  ) : (
    <Badge tone="neutral" aria-label="Papel: cliente">
      <UserIcon size={13} aria-hidden="true" />
      Cliente
    </Badge>
  );
}

function StatusBadge({ status }: { status: AccountStatus }) {
  return status === "active" ? (
    <Badge tone="success" aria-label="Status: ativo">
      <CheckCircle2 size={13} aria-hidden="true" />
      Ativo
    </Badge>
  ) : (
    <Badge tone="danger" aria-label="Status: suspenso">
      <Ban size={13} aria-hidden="true" />
      Suspenso
    </Badge>
  );
}

export default function AdminUsersPage() {
  const q = useQuery({ queryKey: ["admin", "users"], queryFn: api.listUsers });

  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<AdminUser | null>(null);
  const [deleting, setDeleting] = React.useState<AdminUser | null>(null);
  const [detail, setDetail] = React.useState<AdminUser | null>(null);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-text">
            Usuários
          </h1>
          <p className="mt-1 text-sm text-text2">
            Contas da plataforma: papéis, status e ambientes.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <UserPlus size={16} aria-hidden="true" />
          Criar usuário
        </Button>
      </header>

      {q.isPending ? (
        <CenterLoader minHeight="45vh" />
      ) : q.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">
            Não foi possível carregar os usuários.
          </p>
        </Card>
      ) : q.data.length === 0 ? (
        <Card>
          <p className="text-text2">Nenhum usuário cadastrado.</p>
        </Card>
      ) : (
        <>
          {/* Desktop: tabela */}
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[54rem] border-collapse text-sm">
              <caption className="sr-only">
                Lista de usuários com nome, e-mail, papel, status, ambientes e data de criação.
              </caption>
              <thead>
                <tr className="border-b border-border-subtle bg-bg text-left text-text3">
                  <th scope="col" className="px-4 py-3 font-semibold">Nome</th>
                  <th scope="col" className="px-4 py-3 font-semibold">E-mail</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Papel</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Ambientes</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Criado em</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((u) => (
                  <tr key={u.id} className="border-b border-border-subtle last:border-0 hover:bg-bg">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setDetail(u)}
                        className="font-medium text-link hover:underline"
                      >
                        {u.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text2">{u.email}</td>
                    <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-text2">{u.envCount}</td>
                    <td className="px-4 py-3 text-text2">{formatDateTime(u.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <ToggleStatusButton user={u} />
                        <Button variant="ghost" size="sm" onClick={() => setEditing(u)} aria-label={`Editar ${u.name}`}>
                          <Pencil size={15} aria-hidden="true" />
                          Editar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleting(u)} aria-label={`Excluir ${u.name}`} className="text-danger hover:bg-danger/10">
                          <Trash2 size={15} aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile: cards */}
          <ul className="flex flex-col gap-3 md:hidden">
            {q.data.map((u) => (
              <li key={u.id} className="vp-card-shadow rounded-xl border border-border-subtle bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => setDetail(u)} className="min-w-0 text-left">
                    <p className="truncate font-semibold text-link">{u.name}</p>
                    <p className="truncate font-mono text-xs text-text3">{u.email}</p>
                  </button>
                  <StatusBadge status={u.status} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
                  <RoleBadge role={u.role} />
                  <span className="text-xs text-text3">{u.envCount} ambiente(s)</span>
                  <span className="text-xs text-text3">· {formatDateTime(u.createdAt)}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ToggleStatusButton user={u} />
                  <Button variant="outline" size="sm" onClick={() => setEditing(u)}>
                    <Pencil size={15} aria-hidden="true" />
                    Editar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDeleting(u)} className="text-danger">
                    <Trash2 size={15} aria-hidden="true" />
                    Excluir
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <CreateUserDialog open={creating} onClose={() => setCreating(false)} />
      <EditUserDialog user={editing} onClose={() => setEditing(null)} />
      <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} />
      <UserDetailDialog user={detail} onClose={() => setDetail(null)} />
    </>
  );
}

/* ─────────────── Suspender / reativar ─────────────── */

function ToggleStatusButton({ user }: { user: AdminUser }) {
  const qc = useQueryClient();
  const toast = useToast();
  const next: AccountStatus = user.status === "active" ? "suspended" : "active";

  const m = useMutation({
    mutationFn: () => api.updateUser(user.id, { status: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.show("success", next === "suspended" ? "Usuário suspenso." : "Usuário reativado.");
    },
    onError: (e) => toast.show("error", e instanceof Error ? e.message : "Falha ao alterar status."),
  });

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => m.mutate()}
      disabled={m.isPending}
      aria-label={next === "suspended" ? `Suspender ${user.name}` : `Reativar ${user.name}`}
    >
      {user.status === "active" ? (
        <>
          <Ban size={15} aria-hidden="true" />
          Suspender
        </>
      ) : (
        <>
          <CheckCircle2 size={15} aria-hidden="true" />
          Reativar
        </>
      )}
    </Button>
  );
}

/* ─────────────── Criar usuário ─────────────── */

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<UserRole>("client");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setPassword("");
      setRole("client");
      setError(null);
    }
  }, [open]);

  const m = useMutation({
    mutationFn: () => api.createUser({ name, email, password, role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      toast.show("success", "Usuário criado.");
      onClose();
    },
    onError: (e) => toast.show("error", e instanceof Error ? e.message : "Falha ao criar usuário."),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createUserInput.safeParse({ name, email, password, role });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Verifique os campos.");
      return;
    }
    m.mutate();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Criar usuário" description="Cria uma conta na plataforma.">
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cu-name">Nome</Label>
          <Input id="cu-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cu-email">E-mail</Label>
          <Input id="cu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" className="font-mono" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cu-pass">Senha</Label>
          <Input id="cu-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <p className="text-xs text-text3">Mínimo de 6 caracteres.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="block text-sm font-medium text-text2">Papel</span>
          <SegmentedControl<UserRole>
            label="Papel do usuário"
            value={role}
            onChange={setRole}
            options={[
              { value: "client", label: "Cliente" },
              { value: "admin", label: "Administrador" },
            ]}
            fluid
          />
        </div>
        {error ? (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle size={16} aria-hidden="true" />
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={m.isPending}>
            {m.isPending ? "Criando…" : "Criar usuário"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ─────────────── Editar usuário ─────────────── */

function EditUserDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<UserRole>("client");
  const [status, setStatus] = React.useState<AccountStatus>("active");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (user) {
      setName(user.name);
      setRole(user.role);
      setStatus(user.status);
      setPassword("");
      setError(null);
    }
  }, [user]);

  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { name, role, status };
      if (password.trim() !== "") body.password = password;
      return api.updateUser(user!.id, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.show("success", "Usuário atualizado.");
      onClose();
    },
    onError: (e) => toast.show("error", e instanceof Error ? e.message : "Falha ao atualizar."),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload: Record<string, unknown> = { name, role, status };
    if (password.trim() !== "") payload.password = password;
    const parsed = updateUserInput.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Verifique os campos.");
      return;
    }
    m.mutate();
  }

  if (!user) return null;

  return (
    <Dialog open={user !== null} onClose={onClose} title={`Editar — ${user.name}`} description={user.email}>
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="eu-name">Nome</Label>
          <Input id="eu-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="block text-sm font-medium text-text2">Papel</span>
          <SegmentedControl<UserRole>
            label="Papel do usuário"
            value={role}
            onChange={setRole}
            options={[
              { value: "client", label: "Cliente" },
              { value: "admin", label: "Administrador" },
            ]}
            fluid
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="block text-sm font-medium text-text2">Status</span>
          <SegmentedControl<AccountStatus>
            label="Status da conta"
            value={status}
            onChange={setStatus}
            options={[
              { value: "active", label: "Ativo" },
              { value: "suspended", label: "Suspenso" },
            ]}
            fluid
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="eu-pass">Nova senha (opcional)</Label>
          <Input id="eu-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="Deixe em branco para manter" />
        </div>
        {error ? (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle size={16} aria-hidden="true" />
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={m.isPending}>
            {m.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ─────────────── Excluir usuário ─────────────── */

function DeleteUserDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  const m = useMutation({
    mutationFn: () => api.deleteUser(user!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      toast.show("success", "Usuário excluído.");
      onClose();
    },
    onError: (e) => toast.show("error", e instanceof Error ? e.message : "Falha ao excluir usuário."),
  });

  if (!user) return null;

  return (
    <Dialog open={user !== null} onClose={onClose} title="Excluir usuário" description="Esta ação não pode ser desfeita.">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text2">
          Excluir <strong className="text-text">{user.name}</strong> ({user.email})? Você não pode excluir a própria conta.
        </p>
        {m.isError ? (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
            <AlertTriangle size={16} aria-hidden="true" />
            {m.error instanceof Error ? m.error.message : "Falha ao excluir."}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending ? "Excluindo…" : "Excluir definitivamente"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ─────────────── Detalhe: ambientes do usuário ─────────────── */

function UserDetailDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["admin", "user-envs", user?.id],
    queryFn: () => api.userEnvironments(user!.id),
    enabled: user !== null,
  });

  if (!user) return null;

  return (
    <Dialog open={user !== null} onClose={onClose} title={user.name} description={`${user.email} · ${user.envCount} ambiente(s)`}>
      {q.isPending ? (
        <div className="py-8"><CenterLoader minHeight="8rem" label="Carregando ambientes…" /></div>
      ) : q.isError ? (
        <p role="alert" className="flex items-center gap-2 text-sm font-medium text-danger">
          <AlertTriangle size={16} aria-hidden="true" />
          Não foi possível carregar os ambientes.
        </p>
      ) : q.data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Boxes size={28} aria-hidden="true" className="text-text3" />
          <p className="text-sm text-text2">Este usuário ainda não tem ambientes.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {q.data.map((env) => (
            <li key={env.id} className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg p-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-text">{env.name}</p>
                <p className="truncate text-xs text-text3">
                  {env.plan} · {env.runtime.kind} {env.runtime.version}
                  {env.nodeName ? ` · ${env.nodeName}` : ""}
                </p>
              </div>
              <EnvStateBadge state={env.state} />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
