"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Table2, Play, Loader2, Lock, Power, AlertTriangle, Database, RefreshCw, Maximize2, Minimize2, KeyRound, Terminal, Radio, Send, Trash2, Search } from "lucide-react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import type { DbResult, DbMongoOp, RedisValue } from "@velozplanel/contracts";
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
  const [fullscreen, setFullscreen] = React.useState(false);

  React.useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  return (
    <div className={cn("flex flex-col gap-3", fullscreen && "fixed inset-0 z-50 overflow-auto bg-bg p-4 lg:p-6")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Table2 size={18} className="text-text3" />
          <h2 className="text-base font-semibold text-text">Jamees Studio</h2>
          <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-medium text-text2">{engineLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <WriteToggle write={write} onToggle={(v) => (v ? setConfirmWrite(true) : setWrite(false))} />
          <Button variant="ghost" size="sm" onClick={() => setFullscreen((f) => !f)}>
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />} {fullscreen ? "Sair" : "Tela cheia"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>Configurações</Button>
        </div>
      </div>

      {engine === "redis" ? (
        <RedisConsole id={id} write={write} />
      ) : isMongo ? (
        <MongoConsole id={id} write={write} />
      ) : (
        <SqlConsole id={id} engine={engine} write={write} />
      )}

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
  if (result.kind === "redis") {
    return (
      <Card className="max-h-[55vh] overflow-auto p-0">
        <div className={cn("p-3 font-mono text-[12.5px]", result.replyType === "error" ? "text-danger" : "text-text")}>
          <RedisReply value={result.value} replyType={result.replyType} />
        </div>
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

/* ───────────────────────── Redis ───────────────────────── */

function tokenizeRedis(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"' && i + 1 < line.length) {
        const n = line[++i]!;
        const m: Record<string, string> = { n: "\n", t: "\t", r: "\r" };
        cur += m[n] ?? n;
      } else cur += c;
    } else if (c === " " || c === "\t") {
      if (has) { out.push(cur); cur = ""; has = false; }
    } else if (c === '"' || c === "'") { q = c; has = true; }
    else { cur += c; has = true; }
  }
  if (has) out.push(cur);
  return out;
}

function RedisReply({ value, replyType }: { value: RedisValue; replyType?: string }) {
  if (replyType === "nil") return <span className="text-text3 italic">(nil)</span>;
  if (replyType === "error") return <span>{String(value)}</span>;
  return <RedisVal v={value} />;
}
function RedisVal({ v }: { v: RedisValue }) {
  if (v === null) return <span className="text-text3 italic">(nil)</span>;
  if (typeof v === "boolean") return <span>{v ? "(true)" : "(false)"}</span>;
  if (typeof v === "number") return <span className="text-text2">(integer) {v}</span>;
  if (typeof v === "object" && "b" in v) return <span className="rounded bg-bg px-1 text-text3">0x{v.hex.slice(0, 40)}{v.hex.length > 40 ? "…" : ""}</span>;
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="text-text3 italic">(empty)</span>;
    return <ol className="ml-5 list-decimal space-y-0.5">{v.map((it, i) => <li key={i}><RedisVal v={it} /></li>)}</ol>;
  }
  return <span>&quot;{v}&quot;</span>;
}

function RedisConsole({ id, write }: { id: string; write: boolean }) {
  const [tab, setTab] = React.useState<"keys" | "cmd" | "pubsub">("keys");
  const [db, setDb] = React.useState(0);
  const tabs: [typeof tab, string, React.ReactNode][] = [
    ["keys", "Chaves", <KeyRound key="k" size={14} />],
    ["cmd", "Comando", <Terminal key="c" size={14} />],
    ["pubsub", "Pub/Sub", <Radio key="p" size={14} />],
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex gap-1">
          {tabs.map(([k, l, ic]) => (
            <button key={k} onClick={() => setTab(k)} className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium", tab === k ? "bg-brand-soft text-brand-strong" : "text-text2 hover:bg-bg")}>{ic} {l}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-text2">DB
          <select value={db} onChange={(e) => setDb(Number(e.target.value))} className="rounded-lg border border-border bg-surface px-2 py-1 text-sm text-text outline-none focus:border-brand-strong">
            {Array.from({ length: 16 }, (_, i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>
      </div>
      <div className={tab === "keys" ? "" : "hidden"}><RedisKeys id={id} db={db} write={write} /></div>
      <div className={tab === "cmd" ? "" : "hidden"}><RedisCmd id={id} db={db} write={write} /></div>
      <div className={tab === "pubsub" ? "" : "hidden"}><RedisPubSub id={id} db={db} write={write} /></div>
    </div>
  );
}

async function redisRun(id: string, command: string[], db: number, write = false): Promise<DbResult> {
  return api.studioExec(id, { redis: { command, db, write } });
}
function asArray(r: DbResult): RedisValue[] {
  return r.kind === "redis" && Array.isArray(r.value) ? r.value : [];
}
function asScalar(r: DbResult): string {
  return r.kind === "redis" && r.value != null && typeof r.value !== "object" ? String(r.value) : "";
}

function RedisKeys({ id, db, write }: { id: string; db: number; write: boolean }) {
  const [pattern, setPattern] = React.useState("*");
  const [keys, setKeys] = React.useState<string[]>([]);
  const [cursor, setCursor] = React.useState<string | null>("0");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const scan = React.useCallback(async (reset: boolean) => {
    setBusy(true); setErr(null);
    try {
      const cur = reset ? "0" : (cursor ?? "0");
      const r = await redisRun(id, ["SCAN", cur, "MATCH", pattern || "*", "COUNT", "200"], db);
      const arr = asArray(r);
      const next = String(arr[0] ?? "0");
      const batch = (Array.isArray(arr[1]) ? arr[1] : []).map((k) => String(k));
      setKeys(reset ? batch : (prev) => [...prev, ...batch] as string[]);
      setCursor(next === "0" ? null : next);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "erro"); }
    finally { setBusy(false); }
  }, [id, db, pattern, cursor]);

  React.useEffect(() => { setSelected(null); void scan(true); /* eslint-disable-next-line */ }, [db]);

  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
      <Card className="max-h-[65vh] overflow-auto p-2">
        <form className="mb-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); void scan(true); }}>
          <div className="flex flex-1 items-center gap-1 rounded-lg border border-border bg-surface px-2">
            <Search size={13} className="text-text3" />
            <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="padrão (ex.: user:*)" className="w-full bg-transparent py-1.5 text-sm text-text outline-none" />
          </div>
          <Button size="sm" variant="outline" type="submit">Scan</Button>
        </form>
        {err ? <p className="px-1 text-xs text-danger">{err}</p> : null}
        {keys.map((k) => (
          <button key={k} onClick={() => setSelected(k)} className={cn("flex w-full items-center gap-1.5 truncate rounded px-1.5 py-1 text-left text-[13px]", selected === k ? "bg-brand-soft text-brand-strong" : "text-text2 hover:bg-bg")}>
            <KeyRound size={12} className="shrink-0 text-text3" /> <span className="truncate">{k}</span>
          </button>
        ))}
        {cursor ? <button onClick={() => void scan(false)} disabled={busy} className="mt-1 w-full rounded px-1.5 py-1 text-center text-xs text-brand-strong hover:bg-bg">Carregar mais</button> : null}
        {!keys.length && !busy ? <p className="px-1 py-2 text-xs text-text3">Nenhuma chave.</p> : null}
      </Card>
      <div>{selected ? <RedisKeyView id={id} db={db} write={write} keyName={selected} onGone={() => { setSelected(null); void scan(true); }} /> : <p className="p-4 text-sm text-text3">Selecione uma chave para inspecionar.</p>}</div>
    </div>
  );
}

function RedisKeyView({ id, db, write, keyName, onGone }: { id: string; db: number; write: boolean; keyName: string; onGone: () => void }) {
  const [type, setType] = React.useState("");
  const [ttl, setTtl] = React.useState<number | null>(null);
  const [result, setResult] = React.useState<DbResult | null>(null);
  const [strVal, setStrVal] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setErr(null); setResult(null);
    try {
      const t = asScalar(await redisRun(id, ["TYPE", keyName], db));
      setType(t);
      setTtl(Number(asScalar(await redisRun(id, ["TTL", keyName], db))));
      const cmd: Record<string, string[]> = {
        string: ["GET", keyName],
        hash: ["HGETALL", keyName],
        list: ["LRANGE", keyName, "0", "499"],
        set: ["SMEMBERS", keyName],
        zset: ["ZRANGE", keyName, "0", "499", "WITHSCORES"],
        stream: ["XRANGE", keyName, "-", "+", "COUNT", "200"],
      };
      const r = await redisRun(id, cmd[t] ?? ["TYPE", keyName], db);
      setResult(r);
      if (t === "string" && r.kind === "redis" && typeof r.value === "string") setStrVal(r.value);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "erro"); }
  }, [id, db, keyName]);
  React.useEffect(() => { void load(); }, [load]);

  const save = useMutation({ mutationFn: () => redisRun(id, ["SET", keyName, strVal], db, true), onSuccess: () => void load() });
  const del = useMutation({ mutationFn: () => redisRun(id, ["DEL", keyName], db, true), onSuccess: onGone });

  return (
    <Card className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {type ? <span className="rounded bg-bg px-1.5 py-0.5 text-[11px] font-medium text-text2">{type}</span> : null}
          <span className="break-all font-mono text-sm text-text">{keyName}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-text3">
          <span>TTL: {ttl == null || ttl < 0 ? "∞" : `${ttl}s`}</span>
          <button onClick={() => void load()} className="text-text3 hover:text-text2"><RefreshCw size={13} /></button>
          <Button size="sm" variant="ghost" disabled={!write || del.isPending} onClick={() => del.mutate()} className="text-danger"><Trash2 size={13} /> Excluir</Button>
        </div>
      </div>
      {err ? <p className="text-xs text-danger">{err}</p> : null}
      {type === "string" ? (
        <div className="flex flex-col gap-2">
          <textarea value={strVal} onChange={(e) => setStrVal(e.target.value)} disabled={!write} className="h-32 w-full resize-y rounded-lg border border-border bg-surface p-2 font-mono text-[13px] text-text outline-none focus:border-brand-strong disabled:opacity-70" />
          {write ? <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} className="self-start">Salvar</Button> : <span className="text-xs text-text3">Habilite a escrita para editar.</span>}
        </div>
      ) : result ? (
        <div className="max-h-[45vh] overflow-auto font-mono text-[12.5px] text-text"><RedisReply value={result.kind === "redis" ? result.value : null} /></div>
      ) : <Loader2 size={15} className="animate-spin text-text3" />}
    </Card>
  );
}

function RedisCmd({ id, db, write }: { id: string; db: number; write: boolean }) {
  const [line, setLine] = React.useState("");
  const [log, setLog] = React.useState<{ cmd: string; res: DbResult | null; err: string | null }[]>([]);
  const [pending, setPending] = React.useState(false);

  async function run() {
    const command = tokenizeRedis(line);
    if (!command.length) return;
    setPending(true);
    try {
      const r = await redisRun(id, command, db, write);
      setLog((l) => [{ cmd: line, res: r, err: null }, ...l].slice(0, 100));
    } catch (e) {
      setLog((l) => [{ cmd: line, res: null, err: e instanceof ApiError ? e.message : "erro" }, ...l].slice(0, 100));
    }
    setLine(""); setPending(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-text3">redis:{db}&gt;</span>
        <input value={line} onChange={(e) => setLine(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void run(); } }} placeholder="GET chave    ·    HSET h campo valor" spellCheck={false} className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[13px] text-text outline-none focus:border-brand-strong" />
        <Button size="sm" onClick={() => void run()} disabled={pending || !line.trim()}>{pending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Executar</Button>
      </div>
      {!write ? <span className="text-xs text-text3">Somente leitura — habilite a escrita para comandos que alteram dados.</span> : null}
      <Card className="max-h-[50vh] overflow-auto p-0">
        <div className="divide-y divide-border-subtle font-mono text-[12.5px]">
          {log.map((e, i) => (
            <div key={i} className="p-2">
              <div className="text-text3">redis:{db}&gt; <span className="text-text2">{e.cmd}</span></div>
              <div className={cn("mt-0.5", e.err ? "text-danger" : "text-text")}>{e.err ? `(error) ${e.err}` : e.res ? <RedisReply value={e.res.kind === "redis" ? e.res.value : null} replyType={e.res.kind === "redis" ? e.res.replyType : undefined} /> : null}</div>
            </div>
          ))}
          {!log.length ? <p className="p-3 text-text3">Rode um comando para ver a saída.</p> : null}
        </div>
      </Card>
    </div>
  );
}

function RedisPubSub({ id, db, write }: { id: string; db: number; write: boolean }) {
  const [target, setTarget] = React.useState("");
  const [mode, setMode] = React.useState<"channel" | "pattern">("channel");
  const [status, setStatus] = React.useState<"idle" | "live" | "error">("idle");
  const [msgs, setMsgs] = React.useState<{ channel?: string; pattern?: string; payload?: string; time: string }[]>([]);
  const [pubMsg, setPubMsg] = React.useState("");
  const abortRef = React.useRef<AbortController | null>(null);

  const start = React.useCallback(async () => {
    if (!target.trim()) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setMsgs([]); setStatus("live");
    try {
      const res = await fetch(api.redisSubscribeUrl(id, mode, target, db), { credentials: "include", cache: "no-store", signal: ac.signal });
      if (!res.ok || !res.body) { setStatus("error"); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const evt of events) {
          for (const raw of evt.split("\n")) {
            if (!raw.startsWith("data: ")) continue;
            try {
              const m = JSON.parse(raw.slice(6));
              if (m.type === "message" || m.type === "pmessage") {
                setMsgs((prev) => [...prev.slice(-500), { channel: m.channel, pattern: m.pattern, payload: m.payload, time: new Date().toLocaleTimeString() }]);
              }
            } catch { /* ignore */ }
          }
        }
      }
      if (!ac.signal.aborted) setStatus("idle");
    } catch { if (!ac.signal.aborted) setStatus("error"); }
  }, [id, db, mode, target]);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const publish = useMutation({ mutationFn: (ch: string) => redisRun(id, ["PUBLISH", ch, pubMsg], db, true) });

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={mode} onChange={(e) => setMode(e.target.value as "channel" | "pattern")} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none">
            <option value="channel">Canal</option>
            <option value="pattern">Padrão</option>
          </select>
          <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={mode === "pattern" ? "news.*" : "chat:room1"} className="w-48" />
          {status === "live" ? (
            <Button size="sm" variant="outline" onClick={() => { abortRef.current?.abort(); setStatus("idle"); }} className="text-danger">Parar</Button>
          ) : (
            <Button size="sm" onClick={() => void start()}><Radio size={15} /> Ouvir</Button>
          )}
          <span className={cn("inline-flex items-center gap-1.5 text-xs", status === "live" ? "text-success" : status === "error" ? "text-danger" : "text-text3")}>
            {status === "live" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> : null}
            {status === "live" ? "ao vivo" : status === "error" ? "erro" : "parado"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2">
          <span className="text-xs font-medium text-text3">Publicar:</span>
          <Input value={pubMsg} onChange={(e) => setPubMsg(e.target.value)} placeholder="mensagem" className="flex-1 min-w-40" />
          <Button size="sm" variant="outline" disabled={!write || !target.trim() || !pubMsg} onClick={() => publish.mutate(target)}><Send size={14} /> Publicar em {target || "…"}</Button>
        </div>
        {!write ? <span className="text-xs text-text3">Habilite a escrita para publicar.</span> : null}
      </Card>
      <Card className="max-h-[45vh] overflow-auto p-0">
        <div className="divide-y divide-border-subtle font-mono text-[12px]">
          {msgs.map((m, i) => (
            <div key={i} className="flex gap-2 px-2 py-1">
              <span className="text-text3">{m.time}</span>
              <span className="text-brand-strong">{m.channel}{m.pattern ? ` (${m.pattern})` : ""}</span>
              <span className="break-all text-text">{m.payload}</span>
            </div>
          ))}
          {!msgs.length ? <p className="p-3 text-text3">Nenhuma mensagem ainda. Ouça um canal para ver o feed ao vivo.</p> : null}
        </div>
      </Card>
    </div>
  );
}
