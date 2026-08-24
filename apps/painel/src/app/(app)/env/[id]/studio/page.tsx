"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Table2, Play, Loader2, Lock, Power, AlertTriangle, Database, RefreshCw} from "lucide-react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import type { DbResult, DbMongoOp } from "@velozplanel/contracts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

const ENGINE_LABEL: Record<string, string> = { mysql: "MySQL", mariadb: "MariaDB", postgres: "PostgreSQL", mongodb: "MongoDB" };
const MONGO_OPS: DbMongoOp[] = ["find", "aggregate", "count", "distinct", "insertOne", "updateOne", "deleteOne", "createCollection", "createIndex"];
const MONGO_WRITE_OPS = new Set(["insertOne", "updateOne", "deleteOne", "createCollection", "createIndex"]);

export default function StudioPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();

  const envQ = useQuery({ queryKey: ["environment", id], queryFn: () => api.getEnvironment(id) });
  const cfgQ = useQuery({ queryKey: ["studio", id], queryFn: () => api.getStudioConfig(id) });

  const cfg = cfgQ.data;
  const env = envQ.data;

  const enable = useMutation({
    mutationFn: (v: boolean) => api.setStudioEnabled(id, v),
    onSuccess: (c) => qc.setQueryData(["studio", id], c),
    onError: (e) => toast.show("error", e instanceof ApiError ? e.message : "Falha ao alterar"),
  });

  if (cfgQ.isLoading || envQ.isLoading) {
    return <Centered><Loader2 className="animate-spin text-text3" /> </Centered>;
  }
  if (!cfg || !cfg.engine) {
    return <Centered><p className="text-text2">Este ambiente não é um banco de dados.</p></Centered>;
  }

  const engineLabel = ENGINE_LABEL[cfg.engine] ?? cfg.engine;

  // 1) desligado
  if (!cfg.enabled) {
    return (
      <Centered>
        <IconBubble><Table2 size={22} /></IconBubble>
        <h2 className="mt-3 text-lg font-semibold text-text">Ative o Data Studio</h2>
        <p className="mt-1 max-w-md text-sm text-text2">
          Um painel para rodar queries, criar tabelas e editar os dados do seu {engineLabel} — só acessível de dentro do Jamees.
        </p>
        <Button className="mt-4" onClick={() => enable.mutate(true)} disabled={enable.isPending}>
          {enable.isPending ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />} Ativar Data Studio
        </Button>
      </Centered>
    );
  }

  // 2) ambiente parado
  if (env && env.state !== "running") {
    return <PausedState id={id} state={env.state} />;
  }

  // 3) bloqueado por senha
  if (cfg.hasPassword && !cfg.unlocked) {
    return <UnlockState id={id} />;
  }

  // 4) console
  return <Console id={id} engine={cfg.engine} engineLabel={engineLabel} hasPassword={cfg.hasPassword} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">{children}</div>;
}
function IconBubble({ children }: { children: React.ReactNode }) {
  return <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-strong">{children}</div>;
}

function PausedState({ id, state }: { id: string; state: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const start = useMutation({
    mutationFn: () => api.startEnvironment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["environment", id] }),
    onError: (e) => toast.show("error", e instanceof ApiError ? e.message : "Falha ao iniciar"),
  });
  if (state === "provisioning") return <Centered><Loader2 className="animate-spin text-text3" /><p className="mt-2 text-sm text-text2">Preparando o ambiente…</p></Centered>;
  return (
    <Centered>
      <IconBubble><Power size={22} /></IconBubble>
      <h2 className="mt-3 text-lg font-semibold text-text">Ambiente pausado</h2>
      <p className="mt-1 text-sm text-text2">Inicie o ambiente para usar o Data Studio.</p>
      <Button className="mt-4" onClick={() => start.mutate()} disabled={start.isPending}>
        {start.isPending ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />} Iniciar ambiente
      </Button>
      <p className="mt-2 text-xs text-text3">Iniciar retoma a cobrança por hora.</p>
    </Centered>
  );
}

function UnlockState({ id }: { id: string }) {
  const qc = useQueryClient();
  const [pw, setPw] = React.useState("");
  const unlock = useMutation({
    mutationFn: () => api.unlockStudio(id, pw),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["studio", id] }),
  });
  return (
    <Centered>
      <IconBubble><Lock size={22} /></IconBubble>
      <h2 className="mt-3 text-lg font-semibold text-text">Data Studio protegido</h2>
      <p className="mt-1 text-sm text-text2">Digite a senha do Data Studio para continuar.</p>
      <form className="mt-4 flex w-full max-w-xs flex-col gap-2" onSubmit={(e) => { e.preventDefault(); unlock.mutate(); }}>
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Senha" autoFocus />
        {unlock.isError ? <p role="alert" className="text-xs text-danger">Senha incorreta.</p> : null}
        <Button type="submit" disabled={unlock.isPending || !pw}>{unlock.isPending ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />} Entrar</Button>
      </form>
    </Centered>
  );
}

/* ───────────────────────── Console ───────────────────────── */

function Console({ id, engine, engineLabel, hasPassword }: { id: string; engine: string; engineLabel: string; hasPassword: boolean }) {
  const isMongo = engine === "mongodb";
  const [write, setWrite] = React.useState(false);
  const [confirmWrite, setConfirmWrite] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Table2 size={18} className="text-text3" />
          <h2 className="text-base font-semibold text-text">Data Studio</h2>
          <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-medium text-text2">{engineLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <WriteToggle write={write} onToggle={(v) => (v ? setConfirmWrite(true) : setWrite(false))} />
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>Configurações</Button>
        </div>
      </div>

      {isMongo ? <MongoConsole id={id} write={write} /> : <SqlConsole id={id} engine={engine} write={write} />}

      <Dialog
        open={confirmWrite}
        onClose={() => setConfirmWrite(false)}
        title="Habilitar escrita?"
        description="O banco atende produção. Escrita pode alterar ou apagar dados de forma irreversível. Habilitar nesta sessão?"
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirmWrite(false)}>Cancelar</Button>
          <Button variant="danger" size="sm" onClick={() => { setWrite(true); setConfirmWrite(false); }}>Habilitar escrita</Button>
        </div>
      </Dialog>

      {showSettings ? <SettingsDialog id={id} hasPassword={hasPassword} onClose={() => setShowSettings(false)} /> : null}
    </div>
  );
}

function WriteToggle({ write, onToggle }: { write: boolean; onToggle: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!write)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        write ? "bg-danger/15 text-danger" : "bg-bg text-text2",
      )}
      title={write ? "Escrita habilitada — clique para voltar a somente leitura" : "Somente leitura — clique para habilitar escrita"}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", write ? "bg-danger" : "bg-success")} />
      {write ? "Escrita habilitada" : "Somente leitura"}
    </button>
  );
}

function SqlConsole({ id, engine, write }: { id: string; engine: string; write: boolean }) {
  const [sql, setSql] = React.useState("");
  const [result, setResult] = React.useState<DbResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const quote = engine === "postgres" ? (t: string) => `"${t}"` : (t: string) => "`" + t + "`";

  const run = useMutation({
    mutationFn: () => api.studioExec(id, { sql: { sql, write } }),
    onSuccess: (r) => { setResult(r); setError(null); },
    onError: (e) => { setError(e instanceof ApiError ? e.message : "Erro"); setResult(null); },
  });

  const tables = useQuery({
    queryKey: ["studio-tables", id, engine],
    queryFn: async () => {
      const q = engine === "postgres"
        ? "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1"
        : "SHOW TABLES";
      const r = await api.studioExec(id, { sql: { sql: q, write: false } });
      return r.kind === "rows" ? r.rows.map((row) => (typeof row[0] === "string" ? row[0] : "")).filter(Boolean) : [];
    },
  });

  function exec() { if (sql.trim()) run.mutate(); }

  return (
    <div className="grid gap-3 lg:grid-cols-[200px_1fr]">
      <Card className="hidden max-h-[70vh] overflow-auto p-2 lg:block">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-text3">Tabelas</span>
          <button onClick={() => tables.refetch()} className="text-text3 hover:text-text2"><RefreshCw size={13} /></button>
        </div>
        {tables.isLoading ? <p className="px-1 text-xs text-text3">…</p> : null}
        {(tables.data ?? []).map((t) => (
          <button key={t} onClick={() => setSql(`SELECT * FROM ${quote(t)} LIMIT 100`)} className="flex w-full items-center gap-1.5 truncate rounded px-1.5 py-1 text-left text-[13px] text-text2 hover:bg-bg">
            <Table2 size={13} className="shrink-0 text-text3" /> <span className="truncate">{t}</span>
          </button>
        ))}
        {tables.data && tables.data.length === 0 ? <p className="px-1 text-xs text-text3">Nenhuma tabela.</p> : null}
      </Card>

      <div className="flex flex-col gap-2">
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); exec(); } }}
          placeholder={write ? "INSERT / UPDATE / CREATE TABLE …" : "SELECT * FROM …   (⌘/Ctrl+Enter para rodar)"}
          spellCheck={false}
          className="h-40 w-full resize-y rounded-lg border border-border bg-surface p-3 font-mono text-[13px] text-text outline-none focus:border-brand-strong"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={exec} disabled={run.isPending || !sql.trim()}>
            {run.isPending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Executar
          </Button>
          {!write ? <span className="text-xs text-text3">Somente leitura — habilite a escrita para alterar dados.</span> : null}
        </div>
        <ResultView result={result} error={error} />
      </div>
    </div>
  );
}

function MongoConsole({ id, write }: { id: string; write: boolean }) {
  const [op, setOp] = React.useState<DbMongoOp>("find");
  const [collection, setCollection] = React.useState("");
  const [argsText, setArgsText] = React.useState('{\n  "filter": {}\n}');
  const [result, setResult] = React.useState<DbResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const collections = useQuery({
    queryKey: ["studio-colls", id],
    queryFn: async () => {
      const r = await api.studioExec(id, { mongo: { op: "listCollections", write: false } });
      return r.kind === "mongo" ? (JSON.parse(r.ejson)?.result ?? []).map((c: { name?: string }) => c.name).filter(Boolean) : [];
    },
  });

  const run = useMutation({
    mutationFn: () => {
      let args: Record<string, unknown> = {};
      try { args = argsText.trim() ? JSON.parse(argsText) : {}; } catch { throw new ApiError(400, "json_invalido", "JSON dos argumentos inválido"); }
      return api.studioExec(id, { mongo: { op, collection: collection || undefined, args, write } });
    },
    onSuccess: (r) => { setResult(r); setError(null); },
    onError: (e) => { setError(e instanceof ApiError ? e.message : "Erro"); setResult(null); },
  });

  const needsColl = op !== "listCollections";
  const isWriteOp = MONGO_WRITE_OPS.has(op);

  return (
    <div className="grid gap-3 lg:grid-cols-[200px_1fr]">
      <Card className="hidden max-h-[70vh] overflow-auto p-2 lg:block">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-text3">Coleções</span>
          <button onClick={() => collections.refetch()} className="text-text3 hover:text-text2"><RefreshCw size={13} /></button>
        </div>
        {(collections.data ?? []).map((c: string) => (
          <button key={c} onClick={() => { setCollection(c); setOp("find"); }} className="flex w-full items-center gap-1.5 truncate rounded px-1.5 py-1 text-left text-[13px] text-text2 hover:bg-bg">
            <Database size={13} className="shrink-0 text-text3" /> <span className="truncate">{c}</span>
          </button>
        ))}
      </Card>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select value={op} onChange={(e) => setOp(e.target.value as DbMongoOp)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none focus:border-brand-strong">
            {MONGO_OPS.map((o) => <option key={o} value={o}>{o}{MONGO_WRITE_OPS.has(o) ? " ✎" : ""}</option>)}
          </select>
          {needsColl ? <Input value={collection} onChange={(e) => setCollection(e.target.value)} placeholder="coleção" className="w-40" /> : null}
        </div>
        <textarea
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          spellCheck={false}
          placeholder='{ "filter": {}, "limit": 50 }  ou  { "pipeline": [ { "$match": {} } ] }'
          className="h-36 w-full resize-y rounded-lg border border-border bg-surface p-3 font-mono text-[13px] text-text outline-none focus:border-brand-strong"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Executar
          </Button>
          {isWriteOp && !write ? <span className="text-xs text-text3">Operação de escrita — habilite a escrita.</span> : null}
        </div>
        <ResultView result={result} error={error} />
      </div>
    </div>
  );
}

function ResultView({ result, error }: { result: DbResult | null; error: string | null }) {
  if (error) {
    return <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 font-mono text-xs text-danger"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}</p>;
  }
  if (!result) return null;
  if (result.kind === "command") {
    return <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">OK{result.affectedRows != null ? ` — ${result.affectedRows} linha(s) afetada(s)` : ""}.</p>;
  }
  if (result.kind === "mongo") {
    let pretty = result.ejson;
    try { pretty = JSON.stringify(JSON.parse(result.ejson).result ?? JSON.parse(result.ejson), null, 2); } catch { /* keep raw */ }
    return (
      <Card className="max-h-[55vh] overflow-auto p-0">
        <pre className="p-3 font-mono text-[12.5px] text-text">{pretty}</pre>
      </Card>
    );
  }
  // rows
  if (result.columns.length === 0) return <p className="text-sm text-text3">Sem resultados.</p>;
  return (
    <Card className="max-h-[55vh] overflow-auto p-0">
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="sticky top-0 bg-surface">
          <tr>{result.columns.map((c, i) => <th key={i} className="border-b border-border px-2 py-1.5 text-left font-semibold text-text2">{c}</th>)}</tr>
        </thead>
        <tbody>
          {result.rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-bg">
              {row.map((cell, ci) => <td key={ci} className="border-b border-border-subtle px-2 py-1 align-top font-mono text-text">{renderCell(cell)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {result.truncated ? <p className="px-2 py-1 text-xs text-text3">Resultado truncado.</p> : null}
    </Card>
  );
}

function renderCell(cell: unknown): React.ReactNode {
  if (cell === null) return <span className="text-text3 italic">NULL</span>;
  if (typeof cell === "object" && cell && "b" in cell) return <span className="rounded bg-bg px-1 text-text3">0x{(cell as unknown as { hex: string }).hex.slice(0, 24)}{(cell as unknown as { hex: string }).hex.length > 24 ? "…" : ""}</span>;
  const s = String(cell);
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}

function SettingsDialog({ id, hasPassword, onClose }: { id: string; hasPassword: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pw, setPw] = React.useState("");
  const setPassword = useMutation({
    mutationFn: (v: string | null) => api.setStudioPassword(id, v),
    onSuccess: (c) => { qc.setQueryData(["studio", id], c); toast.show("success", "Atualizado."); setPw(""); },
    onError: (e) => toast.show("error", e instanceof ApiError ? e.message : "Falha"),
  });
  const disable = useMutation({
    mutationFn: () => api.setStudioEnabled(id, false),
    onSuccess: (c) => { qc.setQueryData(["studio", id], c); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} title="Configurações do Data Studio">
      <div className="flex flex-col gap-4 p-1">
        <div className="flex flex-col gap-2">
          <Label>Senha de acesso {hasPassword ? "(definida)" : "(sem senha)"}</Label>
          <p className="text-xs text-text3">Sem senha, qualquer pessoa com acesso a este ambiente abre o Data Studio. A senha é uma tranca extra opcional.</p>
          <div className="flex gap-2">
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Nova senha" />
            <Button size="sm" onClick={() => setPassword.mutate(pw)} disabled={!pw || setPassword.isPending}>Salvar</Button>
          </div>
          {hasPassword ? <Button variant="ghost" size="sm" onClick={() => setPassword.mutate(null)} disabled={setPassword.isPending} className="self-start text-danger">Remover senha</Button> : null}
        </div>
        <div className="border-t border-border pt-3">
          <Button variant="outline" size="sm" onClick={() => disable.mutate()} disabled={disable.isPending} className="text-danger">
            <Power size={15} /> Desativar Data Studio
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
