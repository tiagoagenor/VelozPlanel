"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Table2, Play, Loader2, Lock, Power, AlertTriangle, Database, RefreshCw, Maximize2, Minimize2, KeyRound, Terminal, Radio, Send, Trash2, Search, ChevronRight, ChevronDown, Plus, Key, Copy, X, Clock, PanelLeftClose, PanelLeft, Code2, ArrowLeft, ListOrdered, Check, Pin } from "lucide-react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import type { DbResult, DbMongoOp, RedisValue, DbSchema, DbTableMeta, SqlCharset } from "@velozplanel/contracts";
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

  // 4) IDE completa (SQL) ou console simples (mongo/redis)
  if (cfg.engine === "mysql" || cfg.engine === "mariadb" || cfg.engine === "postgres") {
    return <StudioIDE id={id} engine={cfg.engine} engineLabel={engineLabel} hasPassword={cfg.hasPassword} />;
  }
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
      ) : (
        <MongoConsole id={id} write={write} />
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

/* ═══════════════════════════ Data Studio IDE (mysql/mariadb/postgres) ═══════════════════════════ */

type SqlEngine = "mysql" | "mariadb" | "postgres";
type IdeTab =
  | { key: string; kind: "table"; name: string; tableType: "table" | "view"; pinned?: boolean }
  | { key: string; kind: "query"; title: string };

const PAGE_SIZE = 100;
const nf = (n: number) => n.toLocaleString("pt-BR");
const CHARSETS: SqlCharset[] = ["utf8mb4", "utf8", "latin1", "binary", "ascii", "cp1252"];
const CHARSET_LABEL: Record<SqlCharset, string> = { utf8mb4: "UTF-8 (utf8mb4)", utf8: "utf8", latin1: "latin1", binary: "binary", ascii: "ascii", cp1252: "cp1252" };

/** Quoting de identificador por engine. */
function qi(engine: SqlEngine, name: string): string {
  return engine === "postgres" ? `"${name.replace(/"/g, '""')}"` : "`" + name.replace(/`/g, "``") + "`";
}
function isNumericType(type: string): boolean {
  return /(^|\b)(tiny|small|medium|big)?int\d?\b|\b(serial|bigserial|numeric|decimal|dec|real|double|float\d?|money)\b/i.test(type);
}
/** Literal SQL de um valor (string|null) conforme o tipo da coluna e o engine. */
function sqlLit(engine: SqlEngine, val: string | null, type: string): string {
  if (val === null) return "NULL";
  if (isNumericType(type) && /^-?\d+(\.\d+)?$/.test(val.trim())) return val.trim();
  let s = val.replace(/'/g, "''");
  if (engine !== "postgres") s = s.replace(/\\/g, "\\\\");
  return `'${s}'`;
}

/** Célula do DbResult → texto editável (binário/objeto vira null = não-editável). */
function cellToText(cell: unknown): string | null {
  if (cell === null) return null;
  if (typeof cell === "object") return null; // {b,hex}
  return String(cell);
}

function StudioIDE({ id, engine, engineLabel, hasPassword }: { id: string; engine: SqlEngine; engineLabel: string; hasPassword: boolean }) {
  const [tabs, setTabs] = React.useState<IdeTab[]>([]);
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [write, setWrite] = React.useState(false);
  const [confirmWrite, setConfirmWrite] = React.useState(false);
  const [modal, setModal] = React.useState<null | "settings" | "newtable">(null);
  const [charset, setCharsetState] = React.useState<SqlCharset>("utf8mb4");
  const queryCounter = React.useRef(0);

  React.useEffect(() => { try { const v = localStorage.getItem(`studio-charset-${id}`); if (v && (CHARSETS as string[]).includes(v)) setCharsetState(v as SqlCharset); } catch { /* ignore */ } }, [id]);
  const setCharset = React.useCallback((v: SqlCharset) => { setCharsetState(v); try { localStorage.setItem(`studio-charset-${id}`, v); } catch { /* ignore */ } }, [id]);
  const isMysql = engine === "mysql" || engine === "mariadb";

  const schemaQ = useQuery({ queryKey: ["studio-schema", id], queryFn: () => api.getStudioSchema(id) });
  const schema = schemaQ.data;

  // 1 clique = abre/reaproveita a aba de preview (não fixada); tabelas já abertas ganham foco.
  const openTable = React.useCallback((name: string, tableType: "table" | "view") => {
    const key = `t:${name}`;
    setTabs((prev) => {
      if (prev.some((t) => t.key === key)) return prev; // já aberta → só foca
      const tab: IdeTab = { key, kind: "table", name, tableType, pinned: false };
      const previewIdx = prev.findIndex((t) => t.kind === "table" && !t.pinned);
      if (previewIdx >= 0) { const next = [...prev]; next[previewIdx] = tab; return next; }
      return [...prev, tab];
    });
    setActiveKey(key);
  }, []);
  const togglePin = React.useCallback((key: string) => {
    setTabs((prev) => prev.map((t) => (t.key === key && t.kind === "table" ? { ...t, pinned: !t.pinned } : t)));
  }, []);
  const openQuery = React.useCallback(() => {
    queryCounter.current += 1;
    const n = queryCounter.current;
    const key = `q:${n}`;
    setTabs((prev) => [...prev, { key, kind: "query", title: `Consulta ${n}` }]);
    setActiveKey(key);
  }, []);
  const closeTab = React.useCallback((key: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.key === key);
      const next = prev.filter((t) => t.key !== key);
      setActiveKey((cur) => {
        if (cur !== key) return cur;
        if (next.length === 0) return null;
        return (next[Math.max(0, idx - 1)] ?? next[0]!).key;
      });
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // âncoras de modal na carga inicial (#nova-tabela, #configuracoes)
  React.useEffect(() => {
    const h = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (h === "nova-tabela") setModal("newtable");
    else if (h === "configuracoes") setModal("settings");
  }, []);

  function toggleWrite(v: boolean) {
    if (v) setConfirmWrite(true);
    else setWrite(false);
  }

  const active = tabs.find((t) => t.key === activeKey) ?? null;
  const version = schema?.version ?? null;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden bg-surface text-text", fullscreen && "fixed inset-0 z-50")}>
      <div className="flex min-h-0 flex-1">
        {collapsed ? (
          <button onClick={() => setCollapsed(false)} title="Mostrar objetos" className="flex w-9 shrink-0 items-start justify-center border-r border-border bg-surface pt-3 text-text3 hover:text-text2">
            <PanelLeft size={16} />
          </button>
        ) : (
          <SchemaSidebar
            id={id}
            engine={engine}
            engineLabel={engineLabel}
            schema={schema}
            loading={schemaQ.isLoading}
            activeTable={active?.kind === "table" ? active.name : null}
            onOpenTable={openTable}
            onNewTable={() => setModal("newtable")}
            onRefresh={() => schemaQ.refetch()}
            onCollapse={() => setCollapsed(true)}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <TabStrip tabs={tabs} activeKey={activeKey} onSelect={setActiveKey} onClose={closeTab} onNewQuery={openQuery} onTogglePin={togglePin} />
          <div className="min-h-0 flex-1 overflow-hidden">
            {tabs.length === 0 ? (
              <EmptyState onOpenQuery={openQuery} onNewTable={() => setModal("newtable")} />
            ) : (
              tabs.map((t) => (
                <div key={t.key} className={cn("h-full", t.key === activeKey ? "" : "hidden")}>
                  {t.kind === "table" ? (
                    <TablePane id={id} engine={engine} name={t.name} tableType={t.tableType} write={write} active={t.key === activeKey} onRequestWrite={() => setConfirmWrite(true)} onToggleWrite={toggleWrite} charset={charset} />
                  ) : (
                    <QueryPane id={id} engine={engine} schema={schema} write={write} active={t.key === activeKey} charset={charset} />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <StatusBar
        write={write}
        onToggleWrite={toggleWrite}
        fullscreen={fullscreen}
        onToggleFullscreen={() => setFullscreen((f) => !f)}
        onSettings={() => setModal("settings")}
        version={version}
        engineLabel={engineLabel}
        charset={isMysql ? charset : null}
        onCharset={setCharset}
      />

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

      {modal === "settings" ? (
        <IdeSettingsDialog id={id} hasPassword={hasPassword} engineLabel={engineLabel} version={version} onClose={() => setModal(null)} />
      ) : null}
      {modal === "newtable" ? (
        <NewTableDialog engine={engine} write={write} onRequestWrite={() => setConfirmWrite(true)} onClose={() => setModal(null)}
          onCreated={(name) => { setModal(null); schemaQ.refetch(); openTable(name, "table"); }}
          run={(sql) => api.studioExec(id, { sql: { sql, write: true } })} />
      ) : null}
    </div>
  );
}

/* ───────────────────────── Navegador de schema ───────────────────────── */

function SchemaSidebar({ id, engine, engineLabel, schema, loading, activeTable, onOpenTable, onNewTable, onRefresh, onCollapse }: {
  id: string; engine: SqlEngine; engineLabel: string; schema: DbSchema | undefined; loading: boolean;
  activeTable: string | null; onOpenTable: (name: string, type: "table" | "view") => void;
  onNewTable: () => void; onRefresh: () => void; onCollapse: () => void;
}) {
  const [filter, setFilter] = React.useState("");
  const [dbOpen, setDbOpen] = React.useState(true);
  const [tablesOpen, setTablesOpen] = React.useState(true);
  const [viewsOpen, setViewsOpen] = React.useState(true);

  const f = filter.trim().toLowerCase();
  const tables = (schema?.tables ?? []).filter((t) => t.type === "table" && (!f || t.name.toLowerCase().includes(f)));
  const views = (schema?.tables ?? []).filter((t) => t.type === "view" && (!f || t.name.toLowerCase().includes(f)));

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="px-3 pt-3">
        <Link href={`/env/${id}`} className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-text2 hover:bg-bg hover:text-text">
          <ChevronRight size={15} className="rotate-180" /> Voltar para ambiente
        </Link>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-strong"><Database size={14} /></span>
          <span className="truncate text-sm font-semibold text-text">{engineLabel}</span>
        </div>
        <div className="flex items-center gap-0.5 text-text3">
          <IconBtn title="Nova tabela" onClick={onNewTable}><Plus size={15} /></IconBtn>
          <IconBtn title="Recarregar" onClick={onRefresh}><RefreshCw size={14} /></IconBtn>
          <IconBtn title="Ocultar objetos" onClick={onCollapse}><PanelLeftClose size={14} /></IconBtn>
        </div>
      </div>
      <div className="px-3 pb-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-bg px-2">
          <Search size={13} className="text-text3" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar objetos…" className="w-full bg-transparent py-1.5 text-[13px] text-text outline-none placeholder:text-text3" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3 text-[13px]">
        {loading ? <p className="px-2 py-4 text-text3">Carregando schema…</p> : null}
        {schema ? (
          <>
            <TreeRow depth={0} open={dbOpen} onToggle={() => setDbOpen((o) => !o)} icon={<Database size={14} className="text-text3" />} label={schema.database} />
            {dbOpen ? (
              <>
                <TreeRow depth={1} open={tablesOpen} onToggle={() => setTablesOpen((o) => !o)}
                  icon={<Table2 size={14} className="text-text3" />}
                  label="Tabelas" count={tables.length}
                  action={<IconBtn title="Nova tabela" onClick={onNewTable}><Plus size={14} /></IconBtn>} />
                {tablesOpen ? tables.map((t) => (
                  <TableNode key={t.name} id={id} engine={engine} table={t} active={activeTable === t.name} onOpen={() => onOpenTable(t.name, "table")} />
                )) : null}
                {tablesOpen && tables.length === 0 ? <p className="px-2 py-1 pl-9 text-xs text-text3">Nenhuma tabela.</p> : null}

                {views.length > 0 || !f ? (
                  <TreeRow depth={1} open={viewsOpen} onToggle={() => setViewsOpen((o) => !o)}
                    icon={<Table2 size={14} className="text-text3" />} label="Views" count={views.length} />
                ) : null}
                {viewsOpen ? views.map((t) => (
                  <TableNode key={t.name} id={id} engine={engine} table={t} active={activeTable === t.name} onOpen={() => onOpenTable(t.name, "view")} />
                )) : null}
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </aside>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button type="button" title={title} onClick={onClick} className="flex h-6 w-6 items-center justify-center rounded-md text-text3 hover:bg-bg hover:text-text2">{children}</button>
  );
}

function TreeRow({ depth, open, onToggle, icon, label, count, action, selected }: {
  depth: number; open?: boolean; onToggle?: () => void; icon: React.ReactNode; label: string;
  count?: number; action?: React.ReactNode; selected?: boolean;
}) {
  const pad = 8 + depth * 14;
  return (
    <div className={cn("group flex items-center gap-1 rounded-md pr-1 hover:bg-bg", selected && "bg-brand-soft hover:bg-brand-soft")} style={{ paddingLeft: pad }}>
      {onToggle ? (
        <button onClick={onToggle} className="flex h-6 w-4 shrink-0 items-center justify-center text-text3">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      ) : <span className="w-4 shrink-0" />}
      <span className="shrink-0">{icon}</span>
      <span className={cn("flex-1 truncate py-1 text-left", selected ? "font-medium text-brand-strong" : "text-text2")}>{label}</span>
      {count != null ? <span className="shrink-0 pr-1 text-[11px] tabular-nums text-text3">{count}</span> : null}
      {action ? <span className="shrink-0 opacity-0 group-hover:opacity-100">{action}</span> : null}
    </div>
  );
}

function TableNode({ id, engine, table, active, onOpen }: {
  id: string; engine: SqlEngine; table: { name: string; type: "table" | "view"; rows: number | null };
  active: boolean; onOpen: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const metaQ = useQuery({ queryKey: ["studio-tablemeta", id, table.name], queryFn: () => api.getStudioTable(id, table.name), enabled: open });
  const meta = metaQ.data;

  return (
    <>
      <div className={cn("group flex items-center gap-1 rounded-md pr-1 hover:bg-bg", active && "bg-brand-soft hover:bg-brand-soft")} style={{ paddingLeft: 36 }}>
        <button onClick={() => setOpen((o) => !o)} className="flex h-6 w-4 shrink-0 items-center justify-center text-text3">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <Table2 size={14} className={cn("shrink-0", active ? "text-brand-strong" : "text-text3")} />
        <button onClick={onOpen} className={cn("flex-1 truncate py-1 text-left", active ? "font-medium text-brand-strong" : "text-text2")}>{table.name}</button>
      </div>
      {open ? (
        <div className="text-[12.5px]">
          {metaQ.isLoading ? <p className="py-1 text-text3" style={{ paddingLeft: 50 }}>…</p> : null}
          {meta ? (
            <>
              {meta.columns.map((c) => (
                <div key={c.name} className="flex items-center gap-1.5 rounded-md py-0.5 pr-2 hover:bg-bg" style={{ paddingLeft: 50 }}>
                  {c.isPrimaryKey ? <Key size={11} className="shrink-0 text-warning" /> : <span className="h-1 w-1 shrink-0 rounded-full bg-text3" />}
                  <span className="flex-1 truncate text-text2">{c.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-text3">{c.type}</span>
                </div>
              ))}
              <LeafRow label="Índices" count={meta.indexes.length} />
              <LeafRow label="Triggers" count={meta.triggers.length} />
              <LeafRow label="Chaves estrangeiras" count={meta.foreignKeys.length} />
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function LeafRow({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md py-0.5 pr-2 text-text3" style={{ paddingLeft: 50 }}>
      <ChevronRight size={12} className="shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[11px] tabular-nums">{count}</span>
    </div>
  );
}

/* ───────────────────────── Abas ───────────────────────── */

function TabStrip({ tabs, activeKey, onSelect, onClose, onNewQuery, onTogglePin }: {
  tabs: IdeTab[]; activeKey: string | null; onSelect: (k: string) => void; onClose: (k: string) => void; onNewQuery: () => void; onTogglePin: (k: string) => void;
}) {
  return (
    <div className="flex min-h-[38px] items-stretch gap-0 border-b border-border bg-bg/40">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((t) => {
          const activeT = t.key === activeKey;
          const isTable = t.kind === "table";
          const preview = isTable && !t.pinned;
          const pinned = isTable && !!t.pinned;
          return (
            <div key={t.key} className={cn("group flex items-center gap-1.5 border-r border-border px-3 py-2 text-[13px]", activeT ? "bg-surface text-text" : "text-text2 hover:bg-surface/60")}>
              {isTable ? <Table2 size={13} className="shrink-0 text-text3" /> : <Code2 size={13} className="shrink-0 text-text3" />}
              <button onClick={() => onSelect(t.key)} onDoubleClick={() => isTable && onTogglePin(t.key)} className={cn("max-w-[160px] truncate", preview && "italic")}>{isTable ? t.name : t.title}</button>
              {isTable ? (
                <button onClick={() => onTogglePin(t.key)} title={pinned ? "Desafixar aba" : "Fixar aba"} className={cn("flex h-4 w-4 items-center justify-center rounded", pinned ? "text-brand-strong" : "text-text3 opacity-0 hover:text-text2 group-hover:opacity-100")}>
                  <Pin size={11} className={pinned ? "fill-current" : ""} />
                </button>
              ) : null}
              <button onClick={() => onClose(t.key)} title="Fechar" className="flex h-4 w-4 items-center justify-center rounded text-text3 opacity-60 hover:bg-bg hover:text-text2 group-hover:opacity-100"><X size={12} /></button>
            </div>
          );
        })}
      </div>
      <button onClick={onNewQuery} title="Nova consulta" className="flex shrink-0 items-center gap-1.5 border-l border-border px-3 text-[13px] text-text2 hover:bg-surface hover:text-text"><Plus size={15} /> Nova consulta</button>
    </div>
  );
}

function EmptyState({ onOpenQuery, onNewTable }: { onOpenQuery: () => void; onNewTable: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-strong"><Table2 size={22} /></div>
      <p className="text-sm text-text2">Selecione uma tabela à esquerda para ver os dados,<br />ou abra uma consulta SQL.</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onOpenQuery}><Code2 size={15} /> Nova consulta</Button>
        <Button size="sm" variant="outline" onClick={onNewTable}><Plus size={15} /> Nova tabela</Button>
      </div>
    </div>
  );
}

/* ───────────────────────── Aba de tabela (Dados / Estrutura / SQL) ───────────────────────── */

type CellEdit = { row: number; col: string; value: string | null };
type InsertRow = { key: number; values: Map<string, string | null> };

function TablePane({ id, engine, name, tableType, write, active, onRequestWrite, onToggleWrite, charset }: {
  id: string; engine: SqlEngine; name: string; tableType: "table" | "view"; write: boolean; active: boolean; onRequestWrite: () => void; onToggleWrite: (v: boolean) => void; charset: SqlCharset;
}) {
  const [sub, setSub] = React.useState<"dados" | "estrutura" | "sql">("dados");
  const [page, setPage] = React.useState(0);
  const qc = useQueryClient();
  const runSql = React.useCallback((sql: string, wr = false) => api.studioExec(id, { sql: { sql, write: wr, charset } }), [id, charset]);

  const metaQ = useQuery({ queryKey: ["studio-tablemeta", id, name], queryFn: () => api.getStudioTable(id, name) });
  const meta = metaQ.data;

  const dataQ = useQuery({
    queryKey: ["studio-data", id, name, page, charset],
    queryFn: () => runSql(`SELECT * FROM ${qi(engine, name)} LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`),
  });
  const countQ = useQuery({
    queryKey: ["studio-count", id, name, charset],
    queryFn: async () => {
      const r = await runSql(`SELECT COUNT(*) AS c FROM ${qi(engine, name)}`);
      return r.kind === "rows" ? Number(cellToText(r.rows[0]?.[0]) ?? 0) : 0;
    },
  });

  // edições pendentes: chave `${row} ${col}`
  const [edits, setEdits] = React.useState<Map<string, CellEdit>>(new Map());
  const [inserts, setInserts] = React.useState<InsertRow[]>([]);
  const insertCounter = React.useRef(0);
  const [showReview, setShowReview] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [runErr, setRunErr] = React.useState<string | null>(null);

  // reflete a sub-aba na âncora quando esta aba está ativa
  React.useEffect(() => {
    if (active && typeof window !== "undefined") history.replaceState(null, "", `#${sub}`);
  }, [active, sub]);
  // limpa estado ao trocar de página/tabela
  React.useEffect(() => { setEdits(new Map()); setInserts([]); setSelected(new Set()); }, [page, name]);

  const rows = dataQ.data?.kind === "rows" ? dataQ.data.rows : [];
  const columns = dataQ.data?.kind === "rows" ? dataQ.data.columns : [];
  const total = countQ.data ?? null;
  const pk = meta?.primaryKey ?? [];
  const colType = React.useMemo(() => {
    const m = new Map<string, string>();
    (meta?.columns ?? []).forEach((c) => m.set(c.name, c.type));
    return m;
  }, [meta]);
  const pkSet = React.useMemo(() => new Set(pk), [pk]);
  const editable = write && tableType === "table" && pk.length > 0;

  function setCellEdit(row: number, col: string, value: string | null) {
    setEdits((prev) => {
      const next = new Map(prev);
      const key = `${row} ${col}`;
      const orig = cellToText(rows[row]?.[columns.indexOf(col)]);
      if (value === orig) next.delete(key);
      else next.set(key, { row, col, value });
      return next;
    });
  }
  function addInsert() {
    insertCounter.current += 1;
    setInserts((prev) => [...prev, { key: insertCounter.current, values: new Map() }]);
  }
  function setInsertCell(key: number, col: string, value: string | null) {
    setInserts((prev) => prev.map((r) => (r.key === key ? { key, values: new Map(r.values).set(col, value) } : r)));
  }
  function removeInsert(key: number) {
    setInserts((prev) => prev.filter((r) => r.key !== key));
  }
  const activeInserts = inserts.filter((r) => r.values.size > 0);
  const pendingCount = edits.size + activeInserts.length;

  // gera as instruções SQL das edições pendentes
  const statements = React.useMemo(() => {
    if (!meta) return [] as string[];
    const byRow = new Map<number, CellEdit[]>();
    for (const e of edits.values()) {
      const arr = byRow.get(e.row) ?? [];
      arr.push(e);
      byRow.set(e.row, arr);
    }
    const out: string[] = [];
    for (const [rowIdx, cellEdits] of byRow) {
      const row = rows[rowIdx];
      if (!row) continue;
      const sets = cellEdits.map((e) => `${qi(engine, e.col)} = ${sqlLit(engine, e.value, colType.get(e.col) ?? "")}`);
      const where = pk.map((c) => `${qi(engine, c)} = ${sqlLit(engine, cellToText(row[columns.indexOf(c)]), colType.get(c) ?? "")}`);
      out.push(`UPDATE ${qi(engine, name)} SET ${sets.join(", ")} WHERE ${where.join(" AND ")};`);
    }
    for (const ins of inserts) {
      const entries = [...ins.values.entries()];
      if (entries.length === 0) continue;
      const cols = entries.map(([c]) => qi(engine, c));
      const vals = entries.map(([c, v]) => sqlLit(engine, v, colType.get(c) ?? ""));
      out.push(`INSERT INTO ${qi(engine, name)} (${cols.join(", ")}) VALUES (${vals.join(", ")});`);
    }
    return out;
  }, [edits, inserts, meta, rows, columns, pk, colType, engine, name]);

  const save = useMutation({
    mutationFn: async () => {
      for (const s of statements) {
        await runSql(s, true);
      }
    },
    onSuccess: () => {
      setEdits(new Map()); setInserts([]); setShowReview(false); setRunErr(null);
      qc.invalidateQueries({ queryKey: ["studio-data", id, name] });
      qc.invalidateQueries({ queryKey: ["studio-count", id, name] });
    },
    onError: (e) => setRunErr(e instanceof ApiError ? e.message : "Falha ao salvar"),
  });

  const del = useMutation({
    mutationFn: async () => {
      const idxs = [...selected];
      for (const ri of idxs) {
        const row = rows[ri];
        if (!row) continue;
        const where = pk.map((c) => `${qi(engine, c)} = ${sqlLit(engine, cellToText(row[columns.indexOf(c)]), colType.get(c) ?? "")}`);
        await runSql(`DELETE FROM ${qi(engine, name)} WHERE ${where.join(" AND ")};`, true);
      }
    },
    onSuccess: () => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ["studio-data", id, name] }); qc.invalidateQueries({ queryKey: ["studio-count", id, name] }); },
    onError: (e) => setRunErr(e instanceof ApiError ? e.message : "Falha ao excluir"),
  });

  const start = page * PAGE_SIZE;
  const end = start + rows.length;
  const lastPage = total != null ? Math.max(0, Math.ceil(total / PAGE_SIZE) - 1) : null;

  return (
    <div className="flex h-full flex-col">
      {/* barra de sub-abas + ferramentas */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-2">
        <div className="flex items-stretch">
          {(["dados", "estrutura", "sql"] as const).map((s) => (
            <button key={s} onClick={() => setSub(s)} className={cn("relative px-3 py-2 text-[13px] capitalize", sub === s ? "font-medium text-brand-strong" : "text-text2 hover:text-text")}>
              {s === "sql" ? "SQL" : s}
              {sub === s ? <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-strong" /> : null}
            </button>
          ))}
        </div>
        {sub === "dados" ? (
          <div className="flex items-center gap-1.5 py-1.5 text-text3">
            <WriteSwitch write={write} onToggle={onToggleWrite} className="mr-1" />
            <span className="mr-1 h-4 w-px bg-border" />
            <Button size="sm" variant="outline" disabled={tableType !== "table"} onClick={() => { setRunErr(null); if (!write) onRequestWrite(); else addInsert(); }} className="h-7 px-2 text-xs"><Plus size={13} /> Nova linha</Button>
            <IconBtn title="Excluir selecionadas" onClick={() => { if (editable && selected.size) del.mutate(); }}><Trash2 size={14} /></IconBtn>
            <IconBtn title="Recarregar" onClick={() => { dataQ.refetch(); countQ.refetch(); }}><RefreshCw size={14} /></IconBtn>
            <span className="px-1 text-xs tabular-nums text-text3">{rows.length ? `${nf(start + 1)}–${nf(end)}` : "0"} de {total != null ? nf(total) : "…"}</span>
            <IconBtn title="Anterior" onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronRight size={15} className="rotate-180" /></IconBtn>
            <IconBtn title="Próxima" onClick={() => setPage((p) => (lastPage != null ? Math.min(lastPage, p + 1) : p + 1))}><ChevronRight size={15} /></IconBtn>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {sub === "dados" ? (
          dataQ.isLoading ? (
            <Loading />
          ) : dataQ.isError ? (
            <ErrorBox msg={dataQ.error instanceof ApiError ? dataQ.error.message : "Erro ao carregar"} />
          ) : (
            <DataGrid
              columns={columns} rows={rows} pkSet={pkSet} colType={colType}
              editable={editable} edits={edits} onEdit={setCellEdit}
              inserts={inserts} onInsertEdit={setInsertCell} onRemoveInsert={removeInsert}
              selectable={editable} selected={selected} onToggleRow={(i) => setSelected((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
              truncated={dataQ.data?.kind === "rows" ? dataQ.data.truncated : false}
            />
          )
        ) : null}
        {sub === "estrutura" ? <StructureTab meta={meta} loading={metaQ.isLoading} /> : null}
        {sub === "sql" ? <TableSqlTab meta={meta} loading={metaQ.isLoading} /> : null}
      </div>

      {sub === "dados" && write && tableType === "table" && pk.length === 0 ? (
        <div className="border-t border-border bg-warning/10 px-3 py-1.5 text-xs text-warning">Tabela sem chave primária — edição de célula desabilitada (inserção ainda funciona).</div>
      ) : null}

      {pendingCount > 0 ? (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface px-3 py-2 shadow-[0_-2px_8px_rgba(38,38,46,0.06)]">
          <span className="text-[13px] text-text2">{pendingCount} {pendingCount === 1 ? "alteração pendente" : "alterações pendentes"}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setEdits(new Map()); setInserts([]); }}>Descartar</Button>
            <Button size="sm" onClick={() => setShowReview(true)}><ListOrdered size={14} /> Salvar alterações ({pendingCount})</Button>
          </div>
        </div>
      ) : null}
      {runErr ? <div className="border-t border-border bg-danger/10 px-3 py-1.5 font-mono text-xs text-danger">{runErr}</div> : null}

      <ReviewQueryDialog open={showReview} onClose={() => setShowReview(false)} statements={statements} pending={pendingCount} saving={save.isPending} onRun={() => save.mutate()} />
    </div>
  );
}

function Loading() {
  return <div className="flex h-40 items-center justify-center text-text3"><Loader2 size={18} className="animate-spin" /></div>;
}
function ErrorBox({ msg }: { msg: string }) {
  return <p role="alert" className="m-3 flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 font-mono text-xs text-danger"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {msg}</p>;
}

/* ───────────────────────── Grade de dados ───────────────────────── */

function DataGrid({ columns, rows, pkSet, colType, editable, edits, onEdit, inserts, onInsertEdit, onRemoveInsert, selectable, selected, onToggleRow, truncated }: {
  columns: string[]; rows: unknown[][]; pkSet: Set<string>; colType: Map<string, string>;
  editable: boolean; edits: Map<string, CellEdit>; onEdit: (row: number, col: string, value: string | null) => void;
  inserts?: InsertRow[]; onInsertEdit?: (key: number, col: string, value: string | null) => void; onRemoveInsert?: (key: number) => void;
  selectable: boolean; selected: Set<number>; onToggleRow: (i: number) => void; truncated: boolean;
}) {
  const [editing, setEditing] = React.useState<{ row: number; col: string } | null>(null);
  void colType;

  if (columns.length === 0) return <p className="p-6 text-center text-sm text-text3">Tabela sem linhas.</p>;

  return (
    <table className="w-full border-collapse text-[12.5px]">
      <thead className="sticky top-0 z-10 bg-bg">
        <tr>
          <th className="w-10 border-b border-r border-border px-1 py-1.5 text-right font-normal text-text3">#</th>
          {columns.map((c) => (
            <th key={c} className="whitespace-nowrap border-b border-r border-border px-2.5 py-1.5 text-left font-semibold text-text2">
              <span className="inline-flex items-center gap-1">{pkSet.has(c) ? <Key size={11} className="text-warning" /> : null}{c}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(inserts ?? []).map((ins) => (
          <tr key={`ins-${ins.key}`} className="bg-success/5">
            <td className="border-b border-r border-border-subtle px-1 py-1 text-center">
              <button title="Remover" onClick={() => onRemoveInsert?.(ins.key)} className="text-text3 hover:text-danger"><X size={12} /></button>
            </td>
            {columns.map((c, ci) => (
              <td key={ci} className="border-b border-r border-border-subtle p-0">
                <input
                  value={ins.values.get(c) ?? ""}
                  placeholder="—"
                  onChange={(e) => onInsertEdit?.(ins.key, c, e.target.value)}
                  className="w-full bg-transparent px-2.5 py-1 font-mono text-[12.5px] text-text outline-none placeholder:text-text3 focus:bg-warning/10"
                />
              </td>
            ))}
          </tr>
        ))}
        {rows.map((row, ri) => (
          <tr key={ri} className={cn("hover:bg-bg/60", selected.has(ri) && "bg-brand-soft/50")}>
            <td onClick={() => selectable && onToggleRow(ri)} className={cn("border-b border-r border-border-subtle px-1 py-1 text-right tabular-nums text-text3", selectable && "cursor-pointer select-none hover:text-text2")}>{ri + 1}</td>
            {columns.map((c, ci) => {
              const key = `${ri} ${c}`;
              const edited = edits.get(key);
              const orig = cellToText(row[ci]);
              const val = edited ? edited.value : orig;
              const isEditing = editing?.row === ri && editing?.col === c;
              const isPk = pkSet.has(c);
              return (
                <td key={ci}
                  onDoubleClick={() => { if (editable && typeof row[ci] !== "object") setEditing({ row: ri, col: c }); }}
                  className={cn("max-w-[420px] truncate border-b border-r border-border-subtle px-2.5 py-1 align-top font-mono", edited && "bg-warning/15", isPk && "text-brand-strong")}>
                  {isEditing ? (
                    <CellEditor
                      initial={val}
                      onCommit={(v) => { onEdit(ri, c, v); setEditing(null); }}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <span title={val ?? "NULL"}>{renderDataCell(val === orig ? row[ci] : val)}</span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
      {truncated ? <tfoot><tr><td colSpan={columns.length + 1} className="px-2 py-1 text-xs text-text3">Resultado truncado (limite de 12 MiB).</td></tr></tfoot> : null}
    </table>
  );
}

function renderDataCell(cell: unknown): React.ReactNode {
  if (cell === null) return <span className="italic text-text3">NULL</span>;
  if (typeof cell === "object" && cell && "b" in cell) {
    const hex = (cell as unknown as { hex: string }).hex;
    return <span className="rounded bg-bg px-1 text-text3">0x{hex.slice(0, 24)}{hex.length > 24 ? "…" : ""}</span>;
  }
  const s = String(cell);
  if (s === "true") return <span className="text-success">true</span>;
  if (s === "false") return <span className="text-danger">false</span>;
  return s;
}

function CellEditor({ initial, onCommit, onCancel }: { initial: string | null; onCommit: (v: string | null) => void; onCancel: () => void }) {
  const [v, setV] = React.useState(initial ?? "");
  const [isNull, setIsNull] = React.useState(initial === null);
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <span className="flex items-center gap-1">
      <input
        ref={ref}
        value={isNull ? "" : v}
        disabled={isNull}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onCommit(isNull ? null : v); }
          else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        className="w-full rounded border border-brand-strong bg-surface px-1 py-0.5 font-mono text-[12.5px] text-text outline-none disabled:opacity-50"
      />
      <button title="NULL" onClick={() => setIsNull((n) => !n)} className={cn("shrink-0 rounded px-1 text-[10px] font-semibold", isNull ? "bg-brand-strong text-on-solid" : "bg-bg text-text3 hover:text-text2")}>∅</button>
    </span>
  );
}

/* ───────────────────────── Estrutura ───────────────────────── */

function StructureTab({ meta, loading }: { meta: DbTableMeta | undefined; loading: boolean }) {
  if (loading || !meta) return <Loading />;
  return (
    <div className="mx-auto max-w-5xl p-5">
      <SectionHead label="Colunas" />
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full border-collapse text-[13px]">
          <thead className="bg-bg text-left text-text2">
            <tr>
              <Th>Nome</Th><Th>Tipo</Th><Th>Nulável</Th><Th>Default</Th><Th>Chave</Th>
            </tr>
          </thead>
          <tbody>
            {meta.columns.map((c) => (
              <tr key={c.name} className="border-t border-border-subtle">
                <Td className="font-medium text-text">{c.name}</Td>
                <Td className="font-mono text-text2">{c.type}</Td>
                <Td>{c.nullable ? <span className="text-text3">NULL</span> : <span className="text-danger">NOT NULL</span>}</Td>
                <Td className="font-mono text-text3">{c.default ?? "—"}</Td>
                <Td>{c.isPrimaryKey ? <Pill tone="brand"><Key size={10} /> PK</Pill> : c.isUnique ? <Pill tone="neutral">UNIQUE</Pill> : <span className="text-text3">—</span>}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <SectionHead label="Índices" />
          <div className="flex flex-col gap-1.5">
            {meta.indexes.length === 0 ? <p className="text-sm text-text3">Nenhum índice.</p> : meta.indexes.map((i) => (
              <div key={i.name} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[13px]">
                <span className="truncate font-mono text-text2" title={i.columns.join(", ")}>{i.name}</span>
                {i.primary ? <Pill tone="brand">PRIMARY</Pill> : i.unique ? <Pill tone="neutral">UNIQUE</Pill> : <Pill tone="neutral">INDEX</Pill>}
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionHead label="Triggers" />
          <div className="flex flex-col gap-1.5">
            {meta.triggers.length === 0 ? <p className="text-sm text-text3">Nenhuma trigger.</p> : meta.triggers.map((t) => (
              <div key={t.name} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[13px]">
                <span className="truncate font-mono text-text2">{t.name}</span>
                <Pill tone="neutral">{t.timing} {t.event}</Pill>
              </div>
            ))}
          </div>
        </div>
      </div>

      {meta.foreignKeys.length > 0 ? (
        <div className="mt-6">
          <SectionHead label="Chaves estrangeiras" />
          <div className="flex flex-col gap-1.5">
            {meta.foreignKeys.map((fk) => (
              <div key={fk.name} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-mono text-[13px] text-text2">
                <span>{fk.columns.join(", ")}</span><ArrowLeft size={13} className="rotate-180 text-text3" /><span className="text-brand-strong">{fk.refTable}</span><span className="text-text3">({fk.refColumns.join(", ")})</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SectionHead({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text3">{label}</h3>
      {action}
    </div>
  );
}
function Th({ children }: { children: React.ReactNode }) { return <th className="px-3 py-2 font-semibold">{children}</th>; }
function Td({ children, className }: { children: React.ReactNode; className?: string }) { return <td className={cn("px-3 py-2 align-middle", className)}>{children}</td>; }
function Pill({ children, tone }: { children: React.ReactNode; tone: "brand" | "neutral" }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", tone === "brand" ? "bg-brand-soft text-brand-strong" : "bg-bg text-text2")}>{children}</span>;
}

function TableSqlTab({ meta, loading }: { meta: DbTableMeta | undefined; loading: boolean }) {
  const toast = useToast();
  if (loading || !meta) return <Loading />;
  const ddl = meta.createSql ?? "-- DDL indisponível para este objeto.";
  return (
    <div className="p-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text3">DDL da tabela</h3>
        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(ddl); toast.show("success", "DDL copiado."); }}><Copy size={13} /> Copiar</Button>
      </div>
      <CodeBlock code={ddl} />
    </div>
  );
}

function CodeBlock({ code, maxHeightClass }: { code: string; maxHeightClass?: string }) {
  const lines = code.split("\n");
  return (
    <div className={cn("overflow-auto rounded-xl border border-border bg-surface", maxHeightClass)}>
      <table className="w-full border-collapse font-mono text-[12.5px]">
        <tbody>
          {lines.map((ln, i) => (
            <tr key={i}>
              <td className="select-none border-r border-border-subtle px-3 py-0.5 text-right align-top tabular-nums text-text3">{i + 1}</td>
              <td className="whitespace-pre px-3 py-0.5 text-text">{highlightSql(ln)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SQL_KEYWORDS = /\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|VIEW|INDEX|TRIGGER|PRIMARY|KEY|FOREIGN|REFERENCES|CONSTRAINT|UNIQUE|NOT|NULL|DEFAULT|AND|OR|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|LIMIT|OFFSET|AS|COUNT|DISTINCT|GENERATED|ALWAYS|IDENTITY|AUTO_INCREMENT|BEFORE|AFTER|FOR|EACH|ROW|BEGIN|END|ADD|COLUMN|ALTER|DROP|IF|EXISTS)\b/gi;
function highlightSql(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0; let m: RegExpExecArray | null;
  SQL_KEYWORDS.lastIndex = 0;
  while ((m = SQL_KEYWORDS.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    parts.push(<span key={m.index} className="font-semibold text-brand-strong">{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

/* ───────────────────────── Aba de consulta ───────────────────────── */

function QueryPane({ id, engine, schema, write, active, charset }: { id: string; engine: SqlEngine; schema: DbSchema | undefined; write: boolean; active: boolean; charset: SqlCharset }) {
  void engine; void schema; // reservados para autocomplete de tabelas/colunas
  const [sql, setSql] = React.useState("");
  const [result, setResult] = React.useState<DbResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ms, setMs] = React.useState<number | null>(null);

  React.useEffect(() => { if (active && typeof window !== "undefined") history.replaceState(null, "", "#consulta"); }, [active]);

  const run = useMutation({
    mutationFn: async () => {
      const t0 = performance.now();
      const r = await api.studioExec(id, { sql: { sql, write, charset } });
      setMs(Math.round(performance.now() - t0));
      return r;
    },
    onSuccess: (r) => { setResult(r); setError(null); },
    onError: (e) => { setError(e instanceof ApiError ? e.message : "Erro"); setResult(null); },
  });
  function exec() { if (sql.trim()) run.mutate(); }

  const rows = result?.kind === "rows" ? result.rows : [];
  const columns = result?.kind === "rows" ? result.columns : [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={exec} disabled={run.isPending || !sql.trim()}>{run.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Executar</Button>
          <span className="text-xs text-text3">⌘/Ctrl + Enter</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-text3">
          {ms != null ? <span className="tabular-nums">{ms} ms</span> : null}
          {!write ? <span>somente leitura</span> : <span className="text-danger">escrita habilitada</span>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); exec(); } }}
          placeholder={"SELECT * FROM …"}
          spellCheck={false}
          className="min-h-[160px] w-full resize-none border-b border-border bg-surface p-3 font-mono text-[13px] leading-relaxed text-text outline-none"
          style={{ height: 180 }}
        />
        <div className="p-0">
          {error ? <ErrorBox msg={error} /> : null}
          {result && result.kind === "command" ? <p className="m-3 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">OK{result.affectedRows != null ? ` — ${result.affectedRows} linha(s) afetada(s)` : ""}.</p> : null}
          {result && result.kind === "rows" && columns.length > 0 ? (
            <DataGrid columns={columns} rows={rows} pkSet={new Set()} colType={new Map()} editable={false} edits={new Map()} onEdit={() => {}} selectable={false} selected={new Set()} onToggleRow={() => {}} truncated={result.truncated} />
          ) : null}
          {result && result.kind === "rows" && columns.length === 0 ? <p className="m-3 text-sm text-text3">Sem resultados.</p> : null}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Barra de status ───────────────────────── */

function WriteSwitch({ write, onToggle, className }: { write: boolean; onToggle: (v: boolean) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!write)}
      title={write ? "Escrita habilitada — clique para voltar a somente leitura" : "Somente leitura — clique para habilitar escrita"}
      className={cn("flex shrink-0 items-center gap-1.5 text-xs", className)}
    >
      <span className={cn("relative inline-flex h-4 w-7 items-center rounded-full transition-colors", write ? "bg-brand" : "bg-border")}>
        <span className={cn("inline-block h-3 w-3 transform rounded-full bg-surface transition-transform", write ? "translate-x-3.5" : "translate-x-0.5")} />
      </span>
      <span className={cn(write ? "font-medium text-danger" : "text-text2")}>{write ? "Escrita habilitada" : "Somente leitura"}</span>
    </button>
  );
}

function StatusBar({ write, onToggleWrite, fullscreen, onToggleFullscreen, onSettings, version, engineLabel, charset, onCharset }: {
  write: boolean; onToggleWrite: (v: boolean) => void; fullscreen: boolean; onToggleFullscreen: () => void;
  onSettings: () => void; version: string | null; engineLabel: string; charset: SqlCharset | null; onCharset: (v: SqlCharset) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border bg-surface px-3 py-1.5 text-xs text-text3">
      <div className="flex items-center gap-3">
        <WriteSwitch write={write} onToggle={onToggleWrite} />
        <button onClick={onToggleFullscreen} className="flex items-center gap-1 hover:text-text2">{fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />} {fullscreen ? "Sair" : "Tela cheia"}</button>
        <button onClick={onSettings} className="flex items-center gap-1 hover:text-text2"><Power size={13} /> Configurações</button>
      </div>
      <div className="flex items-center gap-3 tabular-nums">
        {charset ? (
          <label className="flex items-center gap-1.5" title="character_set_results da conexão">
            <span className="hidden text-text3 sm:inline">Charset</span>
            <select value={charset} onChange={(e) => onCharset(e.target.value as SqlCharset)} className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-text2 outline-none focus:border-brand-strong">
              {CHARSETS.map((c) => <option key={c} value={c}>{CHARSET_LABEL[c]}</option>)}
            </select>
          </label>
        ) : null}
        <span className="hidden items-center gap-1 sm:inline-flex"><Clock size={12} /> {engineLabel}</span>
        {version ? <span className="truncate text-text3">{version}</span> : null}
      </div>
    </div>
  );
}

/* ───────────────────────── Modais ───────────────────────── */

function ReviewQueryDialog({ open, onClose, statements, pending, saving, onRun }: {
  open: boolean; onClose: () => void; statements: string[]; pending: number; saving: boolean; onRun: () => void;
}) {
  if (!open) return null;
  return (
    <Dialog open onClose={onClose} title="Query a executar" description="Revise as instruções geradas a partir das suas alterações. Nada é executado até você confirmar.">
      <div className="flex flex-col gap-3">
        <span className="text-xs text-text3">{pending === 0 ? "Nenhuma alteração pendente" : `${pending} ${pending === 1 ? "alteração pendente" : "alterações pendentes"}`}</span>
        <CodeBlock code={statements.length ? statements.join("\n") : "-- Nenhuma alteração pendente"} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Fechar</Button>
          <Button size="sm" disabled={saving || statements.length === 0} onClick={onRun}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Executar e salvar</Button>
        </div>
      </div>
    </Dialog>
  );
}

type NewCol = { name: string; type: string; nullable: boolean; pk: boolean };
const PG_TYPES = ["int4", "int8", "text", "varchar(255)", "boolean", "timestamptz", "date", "numeric", "jsonb", "uuid"];
const MY_TYPES = ["INT", "BIGINT", "VARCHAR(255)", "TEXT", "TINYINT(1)", "DATETIME", "DATE", "DECIMAL(10,2)", "JSON"];

function NewTableDialog({ engine, write, onRequestWrite, onClose, onCreated, run }: {
  engine: SqlEngine; write: boolean; onRequestWrite: () => void; onClose: () => void;
  onCreated: (name: string) => void; run: (sql: string) => Promise<DbResult>;
}) {
  const types = engine === "postgres" ? PG_TYPES : MY_TYPES;
  const [name, setName] = React.useState("");
  const [cols, setCols] = React.useState<NewCol[]>([
    { name: "id", type: types[0]!, nullable: false, pk: true },
    { name: "nome", type: types.find((t) => /char|text/i.test(t)) ?? types[2]!, nullable: false, pk: false },
  ]);
  const [err, setErr] = React.useState<string | null>(null);

  function setCol(i: number, patch: Partial<NewCol>) { setCols((c) => c.map((x, j) => (j === i ? { ...x, ...patch } : x))); }
  function addCol() { setCols((c) => [...c, { name: "", type: types[0]!, nullable: true, pk: false }]); }
  function delCol(i: number) { setCols((c) => c.filter((_, j) => j !== i)); }

  const tableName = name.trim() || "nova_tabela";
  const ddl = React.useMemo(() => {
    const valid = cols.filter((c) => c.name.trim());
    const lines = valid.map((c) => `  ${qi(engine, c.name.trim())} ${c.type}${c.nullable ? "" : " NOT NULL"}`);
    const pks = valid.filter((c) => c.pk).map((c) => qi(engine, c.name.trim()));
    if (pks.length) lines.push(`  PRIMARY KEY (${pks.join(", ")})`);
    return `CREATE TABLE ${qi(engine, tableName)} (\n${lines.join(",\n")}\n);`;
  }, [cols, engine, tableName]);

  const create = useMutation({
    mutationFn: () => run(ddl),
    onSuccess: () => onCreated(tableName),
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Falha ao criar"),
  });

  function submit() {
    if (!name.trim()) { setErr("Informe o nome da tabela."); return; }
    if (!cols.some((c) => c.name.trim())) { setErr("Adicione ao menos uma coluna."); return; }
    if (!write) { onRequestWrite(); setErr("Habilite a escrita para criar a tabela."); return; }
    setErr(null); create.mutate();
  }

  return (
    <Dialog open onClose={onClose} title="Nova tabela" widthClass="w-[min(94vw,44rem)]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Nome da tabela</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="nova_tabela" autoFocus />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label>Colunas</Label>
            <Button size="sm" variant="outline" onClick={addCol}><Plus size={13} /> Adicionar coluna</Button>
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto_auto_auto] items-center gap-2 px-1 pb-1 pr-3 text-[11px] font-semibold uppercase tracking-wide text-text3">
            <span>Nome</span><span>Tipo</span><span>Nulável</span><span>PK</span><span />
          </div>
          {/* só a lista de colunas rola */}
          <div className="flex max-h-[38vh] flex-col gap-1.5 overflow-y-auto pr-1">
            {cols.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto_auto] items-center gap-2">
                <Input value={c.name} onChange={(e) => setCol(i, { name: e.target.value })} placeholder="coluna" />
                <select value={c.type} onChange={(e) => setCol(i, { type: e.target.value })} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none focus:border-brand-strong">
                  {types.map((t) => <option key={t} value={t}>{t}</option>)}
                  {!types.includes(c.type) ? <option value={c.type}>{c.type}</option> : null}
                </select>
                <input type="checkbox" checked={c.nullable} onChange={(e) => setCol(i, { nullable: e.target.checked })} className="mx-auto h-4 w-4 accent-[var(--vp-brand)]" />
                <input type="checkbox" checked={c.pk} onChange={(e) => setCol(i, { pk: e.target.checked, nullable: e.target.checked ? false : c.nullable })} className="mx-auto h-4 w-4 accent-[var(--vp-brand)]" />
                <button onClick={() => delCol(i)} className="flex h-7 w-7 items-center justify-center rounded text-text3 hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Label>Preview do DDL</Label>
          <div className="mt-1.5"><CodeBlock code={ddl} maxHeightClass="max-h-32" /></div>
        </div>

        {err ? <p className="text-xs text-danger">{err}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={submit} disabled={create.isPending}>{create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Criar tabela</Button>
        </div>
      </div>
    </Dialog>
  );
}

function IdeSettingsDialog({ id, hasPassword, engineLabel, version, onClose }: {
  id: string; hasPassword: boolean; engineLabel: string; version: string | null; onClose: () => void;
}) {
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
      <div className="flex flex-col gap-4">
        <ToggleRow label="Bloqueio por senha" desc="Pede uma senha extra para abrir o Studio. Sessão de 30 min." checked={hasPassword} readOnly />
        <div className="flex flex-col gap-2">
          <p className="text-xs text-text3">Sem senha, qualquer pessoa com acesso a este ambiente abre o Data Studio.</p>
          <div className="flex gap-2">
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Nova senha do Studio" />
            <Button size="sm" onClick={() => setPassword.mutate(pw)} disabled={!pw || setPassword.isPending}>Salvar</Button>
          </div>
          {hasPassword ? <Button variant="ghost" size="sm" onClick={() => setPassword.mutate(null)} disabled={setPassword.isPending} className="self-start text-danger">Remover senha</Button> : null}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3 text-sm">
          <Info label="Timeout de statement" value="25 s" />
          <Info label="Limite de resultado" value="12 MiB" />
          <Info label="Engine" value={version ?? engineLabel} />
          <Info label="Consultas simultâneas" value="1 (lock por ambiente)" />
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <div>
            <p className="text-sm font-medium text-text">Desativar Data Studio</p>
            <p className="text-xs text-text3">Encerra as sessões e esconde o console deste ambiente.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => disable.mutate()} disabled={disable.isPending} className="text-danger">Desativar</Button>
        </div>
      </div>
    </Dialog>
  );
}

function ToggleRow({ label, desc, checked, readOnly }: { label: string; desc: string; checked: boolean; readOnly?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-text">{label}</p>
        <p className="text-xs text-text3">{desc}</p>
      </div>
      <span className={cn("relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full", checked ? "bg-brand" : "bg-border", readOnly && "opacity-90")}>
        <span className={cn("inline-block h-4 w-4 transform rounded-full bg-surface transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </span>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-text3">{label}</p><p className="font-medium text-text">{value}</p></div>;
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
