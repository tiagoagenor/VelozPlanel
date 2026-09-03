"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Table2, Play, Loader2, Lock, Power, AlertTriangle, Database, RefreshCw, Maximize2, Minimize2, KeyRound, Terminal, Radio, Send, Trash2, Search, ChevronRight, ChevronDown, Plus, Key, Copy, X, Clock, PanelLeftClose, PanelLeft, Code2, ArrowLeft, ListOrdered, Check, Pin, Boxes, Pencil, List, Braces, Upload, FileUp, CircleStop } from "lucide-react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import type { DbResult, RedisValue, DbSchema, DbTableMeta, SqlCharset, DbImportEvent } from "@velozplanel/contracts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

const ENGINE_LABEL: Record<string, string> = { mysql: "MySQL", mariadb: "MariaDB", postgres: "PostgreSQL", mongodb: "MongoDB" };

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

  // 4) IDE completa (SQL / MongoDB) ou console simples (redis)
  if (cfg.engine === "mysql" || cfg.engine === "mariadb" || cfg.engine === "postgres") {
    return <StudioIDE id={id} engine={cfg.engine} engineLabel={engineLabel} hasPassword={cfg.hasPassword} />;
  }
  if (cfg.engine === "mongodb") {
    return <MongoStudio id={id} engineLabel={engineLabel} hasPassword={cfg.hasPassword} />;
  }
  return <Console id={id} engineLabel={engineLabel} hasPassword={cfg.hasPassword} />;
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

function Console({ id, engineLabel, hasPassword }: { id: string; engineLabel: string; hasPassword: boolean }) {
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

      <RedisConsole id={id} write={write} />

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
  | { key: string; kind: "query"; title: string }
  | { key: string; kind: "import"; title: string };

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
  // Importação: uma única aba reaproveitável (não faz sentido abrir várias).
  const openImport = React.useCallback(() => {
    const key = "import:1";
    setTabs((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, { key, kind: "import", title: "Importar SQL" }]));
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
          <TabStrip tabs={tabs} activeKey={activeKey} onSelect={setActiveKey} onClose={closeTab} onNewQuery={openQuery} onNewImport={openImport} onTogglePin={togglePin} />
          <div className="min-h-0 flex-1 overflow-hidden">
            {tabs.length === 0 ? (
              <EmptyState onOpenQuery={openQuery} onNewTable={() => setModal("newtable")} onImport={openImport} />
            ) : (
              tabs.map((t) => (
                <div key={t.key} className={cn("h-full", t.key === activeKey ? "" : "hidden")}>
                  {t.kind === "table" ? (
                    <TablePane id={id} engine={engine} name={t.name} tableType={t.tableType} write={write} active={t.key === activeKey} onRequestWrite={() => setConfirmWrite(true)} onToggleWrite={toggleWrite} charset={charset} />
                  ) : t.kind === "import" ? (
                    <ImportPane id={id} engine={engine} onDone={() => schemaQ.refetch()} />
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

function TabStrip({ tabs, activeKey, onSelect, onClose, onNewQuery, onNewImport, onTogglePin }: {
  tabs: IdeTab[]; activeKey: string | null; onSelect: (k: string) => void; onClose: (k: string) => void; onNewQuery: () => void; onNewImport: () => void; onTogglePin: (k: string) => void;
}) {
  return (
    <div className="flex min-h-[38px] items-stretch gap-0 border-b border-border bg-bg/40">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((t) => {
          const activeT = t.key === activeKey;
          const isTable = t.kind === "table";
          const isImport = t.kind === "import";
          const preview = isTable && !t.pinned;
          const pinned = isTable && !!t.pinned;
          return (
            <div key={t.key} className={cn("group flex items-center gap-1.5 border-r border-border px-3 py-2 text-[13px]", activeT ? "bg-surface text-text" : "text-text2 hover:bg-surface/60")}>
              {isTable ? <Table2 size={13} className="shrink-0 text-text3" /> : isImport ? <FileUp size={13} className="shrink-0 text-text3" /> : <Code2 size={13} className="shrink-0 text-text3" />}
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
      <button onClick={onNewImport} title="Importar arquivo SQL" className="flex shrink-0 items-center gap-1.5 border-l border-border px-3 text-[13px] text-text2 hover:bg-surface hover:text-text"><Upload size={15} /> Importar</button>
      <button onClick={onNewQuery} title="Nova consulta" className="flex shrink-0 items-center gap-1.5 border-l border-border px-3 text-[13px] text-text2 hover:bg-surface hover:text-text"><Plus size={15} /> Nova consulta</button>
    </div>
  );
}

function EmptyState({ onOpenQuery, onNewTable, onImport }: { onOpenQuery: () => void; onNewTable: () => void; onImport: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-strong"><Table2 size={22} /></div>
      <p className="text-sm text-text2">Selecione uma tabela à esquerda para ver os dados,<br />abra uma consulta SQL ou importe um dump.</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onOpenQuery}><Code2 size={15} /> Nova consulta</Button>
        <Button size="sm" variant="outline" onClick={onNewTable}><Plus size={15} /> Nova tabela</Button>
        <Button size="sm" variant="outline" onClick={onImport}><Upload size={15} /> Importar SQL</Button>
      </div>
    </div>
  );
}

/* ───────────────────────── Aba de importação de dump SQL ───────────────────────── */

type ImportPhase = "idle" | "uploading" | "running" | "done";
type ImportLogRow = { i: number; preview: string; status: "ok" | "error"; error?: string };
type ImportSummary = { ok: boolean; total: number; done: number; failed: number; elapsedMs: number; aborted?: boolean };

function ImportPane({ id, engine, onDone }: { id: string; engine: SqlEngine; onDone: () => void }) {
  const engineLabel = ENGINE_LABEL[engine] ?? engine;
  const [source, setSource] = React.useState<"file" | "paste">("file");
  const [file, setFile] = React.useState<File | null>(null);
  const [text, setText] = React.useState("");
  const [stopOnError, setStopOnError] = React.useState(true);
  const [confirm, setConfirm] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);

  const [phase, setPhase] = React.useState<ImportPhase>("idle");
  const [uploadPct, setUploadPct] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [cur, setCur] = React.useState(0); // maior i visto (execução é sequencial)
  const [failCount, setFailCount] = React.useState(0);
  const [current, setCurrent] = React.useState(""); // preview do statement em execução
  const [log, setLog] = React.useState<ImportLogRow[]>([]);
  const [summary, setSummary] = React.useState<ImportSummary | null>(null);
  const [fatal, setFatal] = React.useState<string | null>(null);

  const abortRef = React.useRef<AbortController | null>(null);
  const uploadRef = React.useRef<{ abort: () => void } | null>(null);
  const logEndRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => () => { abortRef.current?.abort(); uploadRef.current?.abort(); }, []);
  React.useEffect(() => { logEndRef.current?.scrollIntoView({ block: "end" }); }, [log.length]);

  const hasInput = source === "file" ? !!file : text.trim().length > 0;
  const busy = phase === "uploading" || phase === "running";

  function reset() {
    setPhase("idle"); setUploadPct(0); setTotal(0); setCur(0); setFailCount(0);
    setCurrent(""); setLog([]); setSummary(null); setFatal(null);
  }

  function pickFile(f: File | null) {
    if (!f) return;
    setFile(f);
    reset();
  }

  async function run() {
    setConfirm(false);
    reset();
    const blob: Blob = source === "file" ? file! : new Blob([text], { type: "application/sql" });
    if (!blob || (source === "file" && !file)) return;
    setPhase("uploading");
    let importId: string;
    try {
      const up = api.studioImportUpload(id, blob, (frac) => setUploadPct(frac));
      uploadRef.current = up;
      ({ importId } = await up.promise);
    } catch (e) {
      uploadRef.current = null;
      setPhase("done");
      setFatal(e instanceof ApiError ? e.message : "Falha ao enviar o arquivo.");
      return;
    }
    uploadRef.current = null;
    setPhase("running");

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(api.studioImportStreamUrl(id, importId, stopOnError), { credentials: "include", cache: "no-store", signal: ac.signal });
      if (!res.ok || !res.body) { setPhase("done"); setFatal(`Falha ao iniciar a importação (${res.status}).`); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          for (const raw of frame.split("\n")) {
            if (!raw.startsWith("data: ")) continue;
            let evt: DbImportEvent;
            try { evt = JSON.parse(raw.slice(6)) as DbImportEvent; } catch { continue; }
            if (evt.type === "start") { setTotal(evt.total); }
            else if (evt.type === "stmt") {
              const e = evt;
              setCur((c) => Math.max(c, e.i));
              setCurrent(e.preview);
              if (e.status === "error") setFailCount((n) => n + 1);
              setLog((prev) => [...prev.slice(-400), { i: e.i, preview: e.preview, status: e.status, error: e.error }]);
            }
            else if (evt.type === "done") { setSummary({ ok: evt.ok, total: evt.total, done: evt.done, failed: evt.failed, elapsedMs: evt.elapsedMs, aborted: evt.aborted }); setCurrent(""); }
            else if (evt.type === "fatal") { setFatal(evt.message); }
          }
        }
      }
    } catch {
      if (!ac.signal.aborted) setFatal("Conexão com o servidor interrompida.");
    } finally {
      abortRef.current = null;
      setPhase("done");
      onDone();
    }
  }

  function cancel() {
    abortRef.current?.abort();
    uploadRef.current?.abort();
    setPhase("done");
  }

  const pct = total > 0 ? Math.round((cur / total) * 100) : 0;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto bg-bg/40 p-4">
      {/* Configuração */}
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <FileUp size={16} className="text-brand-strong" />
          <h3 className="text-sm font-semibold text-text">Importar dump SQL para {engineLabel}</h3>
        </div>
        <p className="text-[13px] text-text2">
          Envie um arquivo <code className="rounded bg-bg px-1">.sql</code> (ou cole o conteúdo). Os comandos rodam na ordem do arquivo,
          numa única sessão. O progresso aparece abaixo, statement a statement.
        </p>

        <div className="flex w-fit gap-1 rounded-lg border border-border bg-bg p-0.5 text-[13px]">
          {(["file", "paste"] as const).map((s) => (
            <button key={s} disabled={busy} onClick={() => setSource(s)}
              className={cn("rounded-md px-3 py-1", source === s ? "bg-surface text-text shadow-sm" : "text-text2 hover:text-text", busy && "opacity-50")}>
              {s === "file" ? "Arquivo" : "Colar SQL"}
            </button>
          ))}
        </div>

        {source === "file" ? (
          <label
            onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!busy) pickFile(e.dataTransfer.files?.[0] ?? null); }}
            className={cn("flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-8 text-center", dragOver ? "border-brand-strong bg-brand-soft/40" : "border-border bg-bg hover:border-text3", busy && "pointer-events-none opacity-60")}>
            <Upload size={22} className="text-text3" />
            {file ? (
              <span className="text-[13px] text-text">{file.name} <span className="text-text3">· {fmtBytes(file.size)}</span></span>
            ) : (
              <span className="text-[13px] text-text2">Arraste um arquivo <b>.sql</b> aqui ou <span className="text-brand-strong">clique para escolher</span></span>
            )}
            <input type="file" accept=".sql,.txt,text/plain,application/sql" className="hidden" disabled={busy}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </label>
        ) : (
          <textarea value={text} disabled={busy} onChange={(e) => setText(e.target.value)} spellCheck={false}
            placeholder={"-- cole aqui o SQL a importar\nCREATE TABLE ...;\nINSERT INTO ...;"}
            className="h-40 w-full resize-y rounded-lg border border-border bg-bg p-3 font-mono text-[12.5px] text-text outline-none focus:border-brand-strong" />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[13px] text-text2">
            <input type="checkbox" checked={stopOnError} disabled={busy} onChange={(e) => setStopOnError(e.target.checked)} className="accent-[var(--brand-strong)]" />
            Parar no primeiro erro
          </label>
          <div className="flex items-center gap-2">
            {busy ? (
              <Button size="sm" variant="outline" onClick={cancel}><CircleStop size={15} /> Cancelar</Button>
            ) : null}
            <Button size="sm" variant="danger" disabled={!hasInput || busy} onClick={() => setConfirm(true)}>
              {phase === "uploading" ? <><Loader2 size={15} className="animate-spin" /> Enviando…</> : phase === "running" ? <><Loader2 size={15} className="animate-spin" /> Importando…</> : <><Play size={15} /> Importar</>}
            </Button>
          </div>
        </div>

        {phase === "uploading" ? (
          <div className="flex items-center gap-2 text-[12px] text-text2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg"><div className="h-full rounded-full bg-brand-strong transition-all" style={{ width: `${Math.round(uploadPct * 100)}%` }} /></div>
            <span className="tabular-nums">{Math.round(uploadPct * 100)}%</span>
          </div>
        ) : null}
      </Card>

      {/* Progresso da execução */}
      {phase === "running" || phase === "done" || summary || fatal ? (
        <Card className="flex min-h-0 flex-1 flex-col gap-2 p-4">
          {fatal ? (
            <div className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger"><AlertTriangle size={15} /> {fatal}</div>
          ) : null}

          {total > 0 || phase !== "idle" ? (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Check size={14} /> {nf(Math.max(0, cur - failCount))} feitos</span>
                {failCount > 0 ? <span className="flex items-center gap-1 text-danger"><X size={14} /> {nf(failCount)} com erro</span> : null}
                <span className="text-text3">{nf(cur)} / {nf(total)} statements</span>
                <span className="ml-auto tabular-nums text-text2">{pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-bg">
                <div className={cn("h-full rounded-full transition-all", failCount > 0 ? "bg-amber-500" : "bg-brand-strong")} style={{ width: `${pct}%` }} />
              </div>
              {phase === "running" && current ? (
                <div className="flex items-center gap-2 truncate text-[12px] text-text2"><Loader2 size={13} className="shrink-0 animate-spin" /> <span className="truncate font-mono">{current}</span></div>
              ) : null}
            </>
          ) : null}

          {summary ? (
            <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]",
              summary.aborted || !summary.ok ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400")}>
              {summary.aborted || !summary.ok ? <AlertTriangle size={15} /> : <Check size={15} />}
              {summary.aborted
                ? `Importação interrompida — ${nf(summary.done)} executados, ${nf(summary.failed)} com erro.`
                : summary.ok
                  ? `Importação concluída — ${nf(summary.done)} statements em ${(summary.elapsedMs / 1000).toFixed(1)}s.`
                  : `Concluída com erros — ${nf(summary.done)} ok, ${nf(summary.failed)} com erro.`}
            </div>
          ) : null}

          {/* Log rolável do que já foi feito */}
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-bg font-mono text-[12px]">
            {log.length === 0 ? (
              <p className="p-3 text-text3">O que for sendo executado aparece aqui…</p>
            ) : (
              <div className="divide-y divide-border/60">
                {log.map((r, k) => (
                  <div key={k} className={cn("flex items-start gap-2 px-3 py-1", r.status === "error" ? "bg-danger/5" : "")}>
                    {r.status === "ok" ? <Check size={13} className="mt-0.5 shrink-0 text-emerald-500" /> : <X size={13} className="mt-0.5 shrink-0 text-danger" />}
                    <span className="min-w-0 flex-1">
                      <span className="text-text3">#{r.i}</span> <span className={cn("break-all", r.status === "error" ? "text-danger" : "text-text2")}>{r.preview}</span>
                      {r.error ? <span className="mt-0.5 block break-all text-danger/90">↳ {r.error}</span> : null}
                    </span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        </Card>
      ) : null}

      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Executar importação?"
        description={`Os comandos do arquivo serão executados no banco (${engineLabel}) e PODEM criar, alterar ou apagar dados de forma irreversível. Continuar?`}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Cancelar</Button>
          <Button variant="danger" size="sm" onClick={run}><Play size={15} /> Importar agora</Button>
        </div>
      </Dialog>
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

/* ═══════════════════════════ MongoDB Data Studio (IDE estilo Compass) ═══════════════════════════ */

const MONGO_PAGE_SIZE = 25;
type MongoTab = "documentos" | "consulta" | "indices";
type MongoActive = { db: string | null; coll: string | null };
const MONGO_BANNED_STAGES = ["$out", "$merge", "$function", "$accumulator", "$where"];

/** Executa uma operação Mongo pelo endpoint do Studio (fila FIFO por ambiente).
 *  Só `op`/`collection`/`database`/`write` são de topo; os parâmetros da operação
 *  (filter/sort/projection/pipeline/doc/update/keys/options…) vão dentro de `args`. */
function mongoExec(
  id: string,
  input: { op: string; database?: string; collection?: string; write?: boolean; args?: Record<string, unknown> },
): Promise<DbResult> {
  return api.studioExec(id, { mongo: input } as Parameters<typeof api.studioExec>[1]);
}
/** Extrai o campo `.result` do EJSON canônico devolvido pelo wrapper. */
function parseMongoResult(r: DbResult | undefined): unknown {
  if (!r || r.kind !== "mongo") return undefined;
  try {
    const o = JSON.parse(r.ejson) as { result?: unknown };
    return "result" in o ? o.result : o;
  } catch {
    return undefined;
  }
}
/** Reconhece um "wrapper" escalar do Extended JSON canônico ({$oid}, {$numberInt}, {$date}…). */
function scalarEjson(v: unknown): { text: string; kind: "oid" | "num" | "date" | "bin" | "regex" | "ts" } | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if ("$oid" in o) return { text: String(o.$oid), kind: "oid" };
  if ("$numberInt" in o) return { text: String(o.$numberInt), kind: "num" };
  if ("$numberLong" in o) return { text: String(o.$numberLong), kind: "num" };
  if ("$numberDouble" in o) return { text: String(o.$numberDouble), kind: "num" };
  if ("$numberDecimal" in o) return { text: String(o.$numberDecimal), kind: "num" };
  if ("$date" in o) {
    const d = o.$date;
    if (typeof d === "string") return { text: d, kind: "date" };
    if (d && typeof d === "object" && "$numberLong" in (d as object)) {
      const ms = Number((d as { $numberLong: string }).$numberLong);
      return { text: Number.isFinite(ms) ? new Date(ms).toISOString() : String(d), kind: "date" };
    }
    return { text: String(d), kind: "date" };
  }
  if ("$binary" in o) return { text: "binary", kind: "bin" };
  if ("$timestamp" in o) return { text: "Timestamp", kind: "ts" };
  if ("$regularExpression" in o) {
    const re = o.$regularExpression as { pattern?: string; options?: string };
    return { text: `/${re?.pattern ?? ""}/${re?.options ?? ""}`, kind: "regex" };
  }
  return null;
}
/** Converte um número EJSON (ou nativo) em number; null se não for numérico. */
function toMongoNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  const s = scalarEjson(v);
  if (s?.kind === "num") { const n = Number(s.text); return Number.isFinite(n) ? n : null; }
  return null;
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Renderiza um valor EJSON com realce de sintaxe (recursivo). */
function MongoValue({ value, depth = 0 }: { value: unknown; depth?: number }): React.ReactElement {
  const scalar = scalarEjson(value);
  if (scalar) {
    if (scalar.kind === "oid") return <span className="rounded bg-brand-soft px-1.5 py-0.5 text-brand-strong">ObjectId(&#39;{scalar.text}&#39;)</span>;
    if (scalar.kind === "num") return <span className="text-warning">{scalar.text}</span>;
    if (scalar.kind === "date") return <span className="text-text2">ISODate(&#39;{scalar.text}&#39;)</span>;
    if (scalar.kind === "regex") return <span className="text-success">{scalar.text}</span>;
    return <span className="rounded bg-bg px-1 text-text3">{scalar.text}</span>;
  }
  if (value === null || value === undefined) return <span className="italic text-text3">null</span>;
  if (typeof value === "string") return <span className="text-success">&quot;{value}&quot;</span>;
  if (typeof value === "number") return <span className="text-warning">{String(value)}</span>;
  if (typeof value === "boolean") return <span className={value ? "text-success" : "text-danger"}>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-text3">[]</span>;
    return (
      <span>
        <span className="text-text3">[</span>
        {value.map((item, i) => (
          <div key={i} className="pl-4">
            <MongoValue value={item} depth={depth + 1} />
            {i < value.length - 1 ? <span className="text-text3">,</span> : null}
          </div>
        ))}
        <span className="text-text3">]</span>
      </span>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-text3">{"{}"}</span>;
    return (
      <span>
        <span className="text-text3">{"{"}</span>
        {entries.map(([k, val], i) => (
          <div key={k} className="pl-4">
            <span className="text-brand-strong">{k}</span>
            <span className="text-text3">: </span>
            <MongoValue value={val} depth={depth + 1} />
            {i < entries.length - 1 ? <span className="text-text3">,</span> : null}
          </div>
        ))}
        <span className="text-text3">{"}"}</span>
      </span>
    );
  }
  return <span>{String(value)}</span>;
}

function MongoStudio({ id, engineLabel, hasPassword }: { id: string; engineLabel: string; hasPassword: boolean }) {
  const [active, setActive] = React.useState<MongoActive>({ db: null, coll: null });
  const [tab, setTab] = React.useState<MongoTab>("documentos");
  const [collapsed, setCollapsed] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [write, setWrite] = React.useState(false);
  const [confirmWrite, setConfirmWrite] = React.useState(false);
  const [modal, setModal] = React.useState<null | "settings" | "newcoll">(null);
  const [activeCount, setActiveCount] = React.useState<number | null>(null);
  const qc = useQueryClient();

  // restaura banco/coleção ativos por ambiente
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(`mongo-active-${id}`);
      if (raw) { const v = JSON.parse(raw) as MongoActive; if (v && typeof v === "object") setActive(v); }
    } catch { /* ignore */ }
  }, [id]);
  const persist = React.useCallback((v: MongoActive) => {
    setActive(v);
    try { localStorage.setItem(`mongo-active-${id}`, JSON.stringify(v)); } catch { /* ignore */ }
  }, [id]);

  React.useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const dbsQ = useQuery({
    queryKey: ["mongo-dbs", id],
    queryFn: async () => {
      const r = await mongoExec(id, { op: "listDatabases", write: false });
      const res = parseMongoResult(r) as { databases?: { name?: string }[] } | undefined;
      return (res?.databases ?? []).map((d) => d.name).filter((n): n is string => !!n);
    },
  });

  // auto-seleciona o 1º banco quando a lista chega (ou quando o banco salvo não existe mais)
  React.useEffect(() => {
    const dbs = dbsQ.data;
    if (!dbs || dbs.length === 0) return;
    setActive((cur) => {
      if (cur.db && dbs.includes(cur.db)) return cur;
      const next: MongoActive = { db: dbs[0]!, coll: null };
      try { localStorage.setItem(`mongo-active-${id}`, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [dbsQ.data, id]);

  function toggleWrite(v: boolean) { if (v) setConfirmWrite(true); else setWrite(false); }
  function selectColl(db: string, coll: string) { persist({ db, coll }); setTab("documentos"); setActiveCount(null); }

  return (
    <div className={cn("flex h-full flex-col overflow-hidden bg-surface text-text", fullscreen && "fixed inset-0 z-50")}>
      <div className="flex min-h-0 flex-1">
        {collapsed ? (
          <button onClick={() => setCollapsed(false)} title="Mostrar coleções" className="flex w-9 shrink-0 items-start justify-center border-r border-border bg-surface pt-3 text-text3 hover:text-text2">
            <PanelLeft size={16} />
          </button>
        ) : (
          <MongoSidebar
            id={id} engineLabel={engineLabel} dbsQ={dbsQ} active={active}
            onSelectDb={(db) => persist({ db, coll: active.db === db ? active.coll : null })}
            onSelectColl={selectColl}
            onNewColl={() => setModal("newcoll")}
            onRefresh={() => { dbsQ.refetch(); qc.invalidateQueries({ queryKey: ["mongo-colls", id] }); }}
            onCollapse={() => setCollapsed(true)}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {!active.db || !active.coll ? (
            <MongoEmptyState hasDb={!!active.db} />
          ) : (
            <>
              <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
                <Boxes size={17} className="shrink-0 text-brand-strong" />
                <span className="truncate font-mono text-[15px] font-semibold text-text">{active.db}.{active.coll}</span>
                {activeCount != null ? <span className="shrink-0 rounded-full bg-bg px-2 py-0.5 font-mono text-xs text-text2">{nf(activeCount)} documentos</span> : null}
                <IconBtn title="Recarregar" onClick={() => qc.invalidateQueries({ queryKey: ["mongo-docs", id, active.db, active.coll] })}><RefreshCw size={15} /></IconBtn>
              </div>
              <div className="flex items-stretch gap-1 border-b border-border-subtle px-3">
                {([["documentos", "Documentos"], ["consulta", "Consulta"], ["indices", "Índices"]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)} className={cn("relative px-3 py-2.5 text-[13px]", tab === k ? "font-medium text-brand-strong" : "text-text2 hover:text-text")}>
                    {label}
                    {tab === k ? <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand-strong" /> : null}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {tab === "documentos" ? (
                  <MongoDocumentsPane id={id} db={active.db} coll={active.coll} write={write} onRequestWrite={() => setConfirmWrite(true)} onCount={setActiveCount} />
                ) : tab === "consulta" ? (
                  <MongoQueryPane id={id} db={active.db} coll={active.coll} />
                ) : (
                  <MongoIndexesPane id={id} db={active.db} coll={active.coll} write={write} onRequestWrite={() => setConfirmWrite(true)} />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <StatusBar
        write={write} onToggleWrite={toggleWrite}
        fullscreen={fullscreen} onToggleFullscreen={() => setFullscreen((f) => !f)}
        onSettings={() => setModal("settings")}
        version={null} engineLabel={engineLabel} charset={null} onCharset={() => {}}
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
        <IdeSettingsDialog id={id} hasPassword={hasPassword} engineLabel={engineLabel} version={null} onClose={() => setModal(null)} />
      ) : null}
      {modal === "newcoll" ? (
        <NewCollectionDialog id={id} db={active.db} write={write} onRequestWrite={() => { setModal(null); setConfirmWrite(true); }} onClose={() => setModal(null)}
          onCreated={(name) => { setModal(null); qc.invalidateQueries({ queryKey: ["mongo-colls", id] }); if (active.db) selectColl(active.db, name); }} />
      ) : null}
    </div>
  );
}

function MongoEmptyState({ hasDb }: { hasDb: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-strong"><Boxes size={22} /></div>
      <p className="text-sm text-text2">{hasDb ? "Selecione uma coleção à esquerda para ver os documentos." : "Selecione um banco à esquerda e depois uma coleção."}</p>
    </div>
  );
}

/* ───────────────────────── Navegador de bancos/coleções ───────────────────────── */

function MongoSidebar({ id, engineLabel, dbsQ, active, onSelectDb, onSelectColl, onNewColl, onRefresh, onCollapse }: {
  id: string; engineLabel: string; dbsQ: { data?: string[]; isLoading: boolean; isError: boolean }; active: MongoActive;
  onSelectDb: (db: string) => void; onSelectColl: (db: string, coll: string) => void;
  onNewColl: () => void; onRefresh: () => void; onCollapse: () => void;
}) {
  const [filter, setFilter] = React.useState("");
  const f = filter.trim().toLowerCase();
  const dbs = (dbsQ.data ?? []).filter((d) => !f || d.toLowerCase().includes(f));

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
          <IconBtn title="Nova coleção" onClick={onNewColl}><Plus size={15} /></IconBtn>
          <IconBtn title="Recarregar" onClick={onRefresh}><RefreshCw size={14} /></IconBtn>
          <IconBtn title="Ocultar coleções" onClick={onCollapse}><PanelLeftClose size={14} /></IconBtn>
        </div>
      </div>
      <div className="px-3 pb-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-bg px-2">
          <Search size={13} className="text-text3" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar…" className="w-full bg-transparent py-1.5 text-[13px] text-text outline-none placeholder:text-text3" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3 text-[13px]">
        {dbsQ.isLoading ? <p className="px-2 py-4 text-text3">Carregando bancos…</p> : null}
        {dbsQ.isError ? <p className="mx-1 my-2 rounded-lg bg-danger/10 px-2 py-2 text-xs text-danger">Falha ao listar bancos.</p> : null}
        {!dbsQ.isLoading && dbs.length === 0 ? <p className="px-2 py-4 text-text3">Nenhum banco.</p> : null}
        {dbs.map((db) => (
          <MongoDbNode key={db} id={id} db={db} active={active} filter={f} onSelectDb={onSelectDb} onSelectColl={onSelectColl} />
        ))}
      </div>

      <div className="px-3 py-2 border-t border-border-subtle">
        <button onClick={onNewColl} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-brand-strong hover:bg-bg">
          <Plus size={14} /> Nova coleção
        </button>
      </div>
    </aside>
  );
}

function MongoDbNode({ id, db, active, filter, onSelectDb, onSelectColl }: {
  id: string; db: string; active: MongoActive; filter: string;
  onSelectDb: (db: string) => void; onSelectColl: (db: string, coll: string) => void;
}) {
  const [open, setOpen] = React.useState(active.db === db);
  React.useEffect(() => { if (active.db === db) setOpen(true); }, [active.db, db]);

  const collsQ = useQuery({
    queryKey: ["mongo-colls", id, db],
    enabled: open,
    queryFn: async () => {
      const r = await mongoExec(id, { op: "listCollections", database: db, write: false });
      const res = parseMongoResult(r);
      return (Array.isArray(res) ? res : []).map((c) => {
        const o = c as { name?: string; type?: string };
        return { name: o.name ?? "", type: o.type === "view" ? "view" : "collection" };
      }).filter((c) => c.name);
    },
  });
  const colls = (collsQ.data ?? []).filter((c) => !filter || c.name.toLowerCase().includes(filter));
  const isActiveDb = active.db === db;

  return (
    <>
      <div className={cn("group flex items-center gap-1 rounded-md pr-1 hover:bg-bg", isActiveDb && !active.coll && "bg-brand-soft hover:bg-brand-soft")} style={{ paddingLeft: 8 }}>
        <button onClick={() => setOpen((o) => !o)} className="flex h-6 w-4 shrink-0 items-center justify-center text-text3">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <Database size={14} className={cn("shrink-0", isActiveDb ? "text-brand-strong" : "text-text3")} />
        <button onClick={() => { setOpen(true); onSelectDb(db); }} className={cn("flex-1 truncate py-1 text-left", isActiveDb ? "font-medium text-brand-strong" : "text-text2")}>{db}</button>
        {collsQ.data ? <span className="shrink-0 pr-1 text-[11px] tabular-nums text-text3">{collsQ.data.length}</span> : null}
      </div>
      {open ? (
        <>
          {collsQ.isLoading ? <p className="py-1 text-text3" style={{ paddingLeft: 36 }}>Carregando…</p> : null}
          {!collsQ.isLoading && colls.length === 0 ? <p className="py-1 text-xs text-text3" style={{ paddingLeft: 36 }}>Nenhuma coleção.</p> : null}
          {colls.map((c) => {
            const on = active.db === db && active.coll === c.name;
            return (
              <div key={c.name} className={cn("group flex items-center gap-1.5 rounded-md py-0.5 pr-1 hover:bg-bg", on && "bg-brand-soft hover:bg-brand-soft")} style={{ paddingLeft: 30 }}>
                <Boxes size={14} className={cn("shrink-0", on ? "text-brand-strong" : "text-text3")} />
                <button onClick={() => onSelectColl(db, c.name)} className={cn("flex-1 truncate py-0.5 text-left", on ? "font-medium text-brand-strong" : "text-text2")}>
                  {c.name}{c.type === "view" ? <span className="ml-1 text-[10px] text-text3">view</span> : null}
                </button>
              </div>
            );
          })}
        </>
      ) : null}
    </>
  );
}

/* ───────────────────────── Aba Documentos ───────────────────────── */

function MongoDocumentsPane({ id, db, coll, write, onRequestWrite, onCount }: {
  id: string; db: string; coll: string; write: boolean; onRequestWrite: () => void; onCount: (n: number | null) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [filterText, setFilterText] = React.useState("{}");
  const [sortText, setSortText] = React.useState("");
  const [projText, setProjText] = React.useState("");
  const [showOpts, setShowOpts] = React.useState(false);
  const [applied, setApplied] = React.useState<{ filter: unknown; sort?: unknown; projection?: unknown }>({ filter: {} });
  const [page, setPage] = React.useState(0);
  const [view, setView] = React.useState<"lista" | "json">("lista");
  const [formErr, setFormErr] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<null | { mode: "edit" | "new"; text: string }>(null);
  const [deleting, setDeleting] = React.useState<Record<string, unknown> | null>(null);

  React.useEffect(() => {
    setFilterText("{}"); setSortText(""); setProjText(""); setApplied({ filter: {} }); setPage(0); setFormErr(null);
  }, [db, coll]);

  const appliedKey = JSON.stringify(applied);

  const countQ = useQuery({
    queryKey: ["mongo-count", id, db, coll, JSON.stringify(applied.filter)],
    queryFn: async () => {
      const r = await mongoExec(id, { op: "count", database: db, collection: coll, args: { filter: applied.filter } });
      return toMongoNumber(parseMongoResult(r)) ?? 0;
    },
  });
  const total = countQ.data ?? null;
  React.useEffect(() => { onCount(total); }, [total, onCount]);

  const docsQ = useQuery({
    queryKey: ["mongo-docs", id, db, coll, page, appliedKey],
    queryFn: async () => {
      const r = await mongoExec(id, {
        op: "find", database: db, collection: coll,
        args: { filter: applied.filter, sort: applied.sort, projection: applied.projection, skip: page * MONGO_PAGE_SIZE, limit: MONGO_PAGE_SIZE },
      });
      const res = parseMongoResult(r);
      return (Array.isArray(res) ? res : []) as Record<string, unknown>[];
    },
  });

  function applyFind() {
    try {
      const filter = filterText.trim() ? JSON.parse(filterText) : {};
      const sort = sortText.trim() ? JSON.parse(sortText) : undefined;
      const projection = projText.trim() ? JSON.parse(projText) : undefined;
      setApplied({ filter, sort, projection }); setPage(0); setFormErr(null);
    } catch { setFormErr("JSON inválido em filtro, ordenação ou projeção."); }
  }
  function resetFind() { setFilterText("{}"); setSortText(""); setProjText(""); setApplied({ filter: {} }); setPage(0); setFormErr(null); }
  function requireWrite(fn: () => void) { if (!write) onRequestWrite(); else fn(); }

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const parsed = JSON.parse(editing.text) as Record<string, unknown>;
      if (editing.mode === "new") {
        await mongoExec(id, { op: "insertOne", database: db, collection: coll, write: true, args: { doc: parsed } });
      } else {
        const { _id, ...rest } = parsed;
        if (_id === undefined) throw new ApiError(400, "sem_id", "O documento precisa manter o campo _id.");
        await mongoExec(id, { op: "updateOne", database: db, collection: coll, write: true, args: { filter: { _id }, update: { $set: rest } } });
      }
    },
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["mongo-docs", id, db, coll] });
      qc.invalidateQueries({ queryKey: ["mongo-count", id, db, coll] });
      toast.show("success", "Documento salvo.");
    },
    onError: (e) => toast.show("error", e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Falha ao salvar"),
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!deleting) return;
      await mongoExec(id, { op: "deleteOne", database: db, collection: coll, write: true, args: { filter: { _id: deleting._id } } });
    },
    onSuccess: () => {
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["mongo-docs", id, db, coll] });
      qc.invalidateQueries({ queryKey: ["mongo-count", id, db, coll] });
      toast.show("success", "Documento excluído.");
    },
    onError: (e) => toast.show("error", e instanceof ApiError ? e.message : "Falha ao excluir"),
  });

  const rows = docsQ.data ?? [];
  const start = page * MONGO_PAGE_SIZE;
  const lastPage = total != null ? Math.max(0, Math.ceil(total / MONGO_PAGE_SIZE) - 1) : null;

  return (
    <div className="flex h-full flex-col">
      {/* barra de filtro */}
      <div className="flex flex-col gap-2 border-b border-border-subtle px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-bg px-3">
            <span className="font-mono text-[13px] font-semibold text-text3">Filter</span>
            <input value={filterText} onChange={(e) => setFilterText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyFind(); }}
              placeholder={'{ "role": "admin" }'} spellCheck={false}
              className="w-full bg-transparent py-2 font-mono text-[13px] text-text outline-none placeholder:text-text3" />
          </div>
          <Button size="sm" onClick={applyFind} disabled={docsQ.isFetching}><Play size={14} /> Find</Button>
          <Button size="sm" variant="outline" onClick={resetFind}>Reset</Button>
          <span className="h-5 w-px bg-border" />
          <Button size="sm" variant="outline" onClick={() => setShowOpts((o) => !o)}>Opções</Button>
          <Button size="sm" variant="outline" onClick={() => requireWrite(() => setEditing({ mode: "new", text: "{\n  \n}" }))}><Plus size={14} /> Novo documento</Button>
        </div>
        {showOpts ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-text3">Ordenação (sort)
              <input value={sortText} onChange={(e) => setSortText(e.target.value)} placeholder={'{ "created_at": -1 }'} spellCheck={false} className="rounded-lg border border-border bg-bg px-2 py-1.5 font-mono text-[12.5px] text-text outline-none placeholder:text-text3" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text3">Projeção (projection)
              <input value={projText} onChange={(e) => setProjText(e.target.value)} placeholder={'{ "senha": 0 }'} spellCheck={false} className="rounded-lg border border-border bg-bg px-2 py-1.5 font-mono text-[12.5px] text-text outline-none placeholder:text-text3" />
            </label>
          </div>
        ) : null}
        {formErr ? <p className="text-xs text-danger">{formErr}</p> : null}
      </div>

      {/* lista */}
      <div className="min-h-0 flex-1 overflow-auto bg-bg/40 p-3">
        {docsQ.isLoading ? <Loading /> : docsQ.isError ? (
          <ErrorBox msg={docsQ.error instanceof ApiError ? docsQ.error.message : "Erro ao carregar documentos"} />
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-text3">Nenhum documento.</p>
        ) : view === "json" ? (
          <Card className="overflow-auto p-3"><div className="font-mono text-[12.5px] leading-relaxed"><MongoValue value={rows} /></div></Card>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((doc, i) => {
              const idScalar = scalarEjson(doc._id);
              const others = Object.entries(doc).filter(([k]) => k !== "_id");
              return (
                <div key={i} className="overflow-hidden rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(38,38,46,0.04)]">
                  <div className="flex items-center gap-2 border-b border-border-subtle bg-bg/50 px-3.5 py-2">
                    <span className="font-mono text-xs text-text3">_id:</span>
                    {idScalar?.kind === "oid" ? (
                      <span className="rounded-md bg-brand-soft px-2 py-0.5 font-mono text-xs text-brand-strong">ObjectId(&#39;{idScalar.text}&#39;)</span>
                    ) : (
                      <span className="font-mono text-xs text-text2"><MongoValue value={doc._id} /></span>
                    )}
                    <span className="ml-auto flex items-center gap-1 text-text3">
                      <IconBtn title="Copiar documento" onClick={() => { navigator.clipboard?.writeText(JSON.stringify(doc, null, 2)); toast.show("success", "Documento copiado."); }}><Copy size={14} /></IconBtn>
                      <IconBtn title={write ? "Editar documento" : "Habilite a escrita para editar"} onClick={() => requireWrite(() => setEditing({ mode: "edit", text: JSON.stringify(doc, null, 2) }))}><Pencil size={14} /></IconBtn>
                      <IconBtn title={write ? "Excluir documento" : "Habilite a escrita para excluir"} onClick={() => requireWrite(() => setDeleting(doc))}><Trash2 size={14} /></IconBtn>
                    </span>
                  </div>
                  <div className="px-4 py-3 font-mono text-[12.5px] leading-relaxed">
                    {others.length === 0 ? <span className="text-text3">— sem outros campos —</span> : others.map(([k, v]) => (
                      <div key={k}><span className="text-brand-strong">{k}</span><span className="text-text3">: </span><MongoValue value={v} /></div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* rodapé: view toggle + paginação */}
      <div className="flex items-center gap-3 border-t border-border px-3 py-1.5">
        <div className="flex items-center gap-0.5 rounded-lg bg-bg p-0.5">
          <button onClick={() => setView("lista")} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs", view === "lista" ? "bg-surface font-medium text-brand-strong shadow-sm" : "text-text2")}><List size={13} /> Lista</button>
          <button onClick={() => setView("json")} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs", view === "json" ? "bg-surface font-medium text-brand-strong shadow-sm" : "text-text2")}><Braces size={13} /> JSON</button>
        </div>
        <span className="ml-auto px-1 font-mono text-xs tabular-nums text-text3">
          {rows.length ? `${nf(start + 1)}–${nf(start + rows.length)}` : "0"} de {total != null ? nf(total) : "…"}
        </span>
        <IconBtn title="Anterior" onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronRight size={15} className="rotate-180" /></IconBtn>
        <IconBtn title="Próxima" onClick={() => setPage((p) => (lastPage != null ? Math.min(lastPage, p + 1) : p + 1))}><ChevronRight size={15} /></IconBtn>
      </div>

      {editing ? (
        <MongoDocDialog
          title={editing.mode === "new" ? "Novo documento" : "Editar documento"}
          text={editing.text}
          onChange={(t) => setEditing({ ...editing, text: t })}
          saving={save.isPending}
          hint={editing.mode === "edit" ? "Os campos são gravados via $set. Mantenha o _id." : "Documento inserido via insertOne."}
          onClose={() => setEditing(null)}
          onSave={() => save.mutate()}
        />
      ) : null}

      <Dialog open={!!deleting} onClose={() => setDeleting(null)} title="Excluir documento?" description="Esta ação remove o documento pelo _id e não pode ser desfeita.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>Cancelar</Button>
          <Button variant="danger" size="sm" disabled={del.isPending} onClick={() => del.mutate()}>{del.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Excluir</Button>
        </div>
      </Dialog>
    </div>
  );
}

function MongoDocDialog({ title, text, onChange, saving, hint, onClose, onSave }: {
  title: string; text: string; onChange: (t: string) => void; saving: boolean; hint: string; onClose: () => void; onSave: () => void;
}) {
  return (
    <Dialog open onClose={onClose} title={title} description={hint}>
      <div className="flex flex-col gap-3">
        <textarea value={text} onChange={(e) => onChange(e.target.value)} spellCheck={false}
          className="h-64 w-full resize-y rounded-lg border border-border bg-bg p-3 font-mono text-[12.5px] text-text outline-none focus:border-brand-strong" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={saving} onClick={onSave}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Salvar</Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ───────────────────────── Aba Consulta (find/aggregate bruto) ───────────────────────── */

function MongoQueryPane({ id, db, coll }: { id: string; db: string; coll: string }) {
  const [mode, setMode] = React.useState<"find" | "aggregate">("find");
  const [text, setText] = React.useState('{\n  "filter": {},\n  "limit": 50\n}');
  const [result, setResult] = React.useState<DbResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ms, setMs] = React.useState<number | null>(null);

  function setModeTemplate(m: "find" | "aggregate") {
    setMode(m);
    setText(m === "aggregate" ? '[\n  { "$match": {} }\n]' : '{\n  "filter": {},\n  "limit": 50\n}');
    setResult(null); setError(null); setMs(null);
  }

  const run = useMutation({
    mutationFn: async () => {
      let parsed: unknown;
      try { parsed = text.trim() ? JSON.parse(text) : mode === "aggregate" ? [] : {}; }
      catch { throw new ApiError(400, "json", "JSON inválido."); }
      const t0 = performance.now();
      let r: DbResult;
      if (mode === "aggregate") {
        if (!Array.isArray(parsed)) throw new ApiError(400, "pipe", "O pipeline deve ser um array de estágios.");
        for (const stage of parsed) {
          for (const k of Object.keys((stage ?? {}) as object)) {
            if (MONGO_BANNED_STAGES.includes(k)) throw new ApiError(400, "stage", `O estágio ${k} não é permitido.`);
          }
        }
        r = await mongoExec(id, { op: "aggregate", database: db, collection: coll, args: { pipeline: parsed } });
      } else {
        const spec = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
        r = await mongoExec(id, {
          op: "find", database: db, collection: coll,
          args: { filter: spec.filter ?? {}, projection: spec.projection, sort: spec.sort, skip: spec.skip, limit: spec.limit ?? 50 },
        });
      }
      setMs(Math.round(performance.now() - t0));
      return r;
    },
    onSuccess: (r) => { setResult(r); setError(null); },
    onError: (e) => { setError(e instanceof ApiError ? e.message : "Erro"); setResult(null); },
  });
  function exec() { if (text.trim()) run.mutate(); }

  const parsed = parseMongoResult(result ?? undefined);
  const count = Array.isArray(parsed) ? parsed.length : parsed != null ? 1 : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <select value={mode} onChange={(e) => setModeTemplate(e.target.value as "find" | "aggregate")} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none focus:border-brand-strong">
            <option value="find">find</option>
            <option value="aggregate">aggregate</option>
          </select>
          <Button size="sm" onClick={exec} disabled={run.isPending || !text.trim()}>{run.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Executar</Button>
          <span className="text-xs text-text3">⌘/Ctrl + Enter · somente leitura</span>
        </div>
        {ms != null ? <span className="font-mono text-xs tabular-nums text-text3">{ms} ms · {count} doc(s)</span> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); exec(); } }}
          placeholder={mode === "aggregate" ? '[ { "$match": {} }, { "$group": { "_id": "$role", "n": { "$sum": 1 } } } ]' : '{ "filter": { "active": true }, "sort": { "created_at": -1 }, "limit": 50 }'}
          spellCheck={false}
          className="w-full resize-none border-b border-border bg-surface p-3 font-mono text-[13px] leading-relaxed text-text outline-none"
          style={{ height: 180 }}
        />
        <div className="p-3">
          {error ? <ErrorBox msg={error} /> : null}
          {result && parsed !== undefined ? (
            Array.isArray(parsed) && parsed.length === 0
              ? <p className="text-sm text-text3">Sem resultados.</p>
              : <Card className="overflow-auto p-3"><div className="font-mono text-[12.5px] leading-relaxed"><MongoValue value={parsed} /></div></Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Aba Índices ───────────────────────── */

function MongoIndexesPane({ id, db, coll, write, onRequestWrite }: {
  id: string; db: string; coll: string; write: boolean; onRequestWrite: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [showCreate, setShowCreate] = React.useState(false);

  const idxQ = useQuery({
    queryKey: ["mongo-indexes", id, db, coll],
    queryFn: async () => {
      const r = await mongoExec(id, { op: "listIndexes", database: db, collection: coll, write: false });
      const res = parseMongoResult(r);
      return (Array.isArray(res) ? res : []) as { name?: string; key?: Record<string, unknown>; unique?: boolean }[];
    },
  });
  const statsQ = useQuery({
    queryKey: ["mongo-collstats", id, db, coll],
    queryFn: async () => {
      const r = await mongoExec(id, { op: "aggregate", database: db, collection: coll, args: { pipeline: [{ $collStats: { storageStats: {} } }] } });
      const res = parseMongoResult(r);
      const first = Array.isArray(res) ? (res[0] as { storageStats?: { indexSizes?: Record<string, unknown> } }) : undefined;
      return first?.storageStats?.indexSizes ?? {};
    },
  });

  const create = useMutation({
    mutationFn: async (v: { field: string; unique: boolean }) => {
      await mongoExec(id, { op: "createIndex", database: db, collection: coll, write: true, args: { keys: { [v.field]: 1 }, options: v.unique ? { unique: true } : {} } });
    },
    onSuccess: () => { setShowCreate(false); qc.invalidateQueries({ queryKey: ["mongo-indexes", id, db, coll] }); qc.invalidateQueries({ queryKey: ["mongo-collstats", id, db, coll] }); toast.show("success", "Índice criado."); },
    onError: (e) => toast.show("error", e instanceof ApiError ? e.message : "Falha ao criar índice"),
  });

  const sizes = statsQ.data ?? {};

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
        <span className="text-[13px] font-medium text-text2">Índices</span>
        <Button size="sm" variant="outline" onClick={() => { if (!write) onRequestWrite(); else setShowCreate(true); }}><Plus size={14} /> Criar índice</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {idxQ.isLoading ? <Loading /> : idxQ.isError ? (
          <ErrorBox msg={idxQ.error instanceof ApiError ? idxQ.error.message : "Erro ao carregar índices"} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-bg text-left text-text2">
                <tr><Th>Nome</Th><Th>Campos</Th><Th>Tipo</Th><Th>Tamanho</Th></tr>
              </thead>
              <tbody>
                {(idxQ.data ?? []).map((ix) => {
                  const keys = Object.entries(ix.key ?? {});
                  const type = ix.unique || ix.name === "_id_" ? "UNIQUE" : keys.length > 1 ? "COMPOSTO" : "SIMPLES";
                  const tone = type === "UNIQUE" ? "brand" : "neutral";
                  const sz = toMongoNumber(sizes[ix.name ?? ""]);
                  return (
                    <tr key={ix.name} className="border-t border-border-subtle">
                      <Td className="font-mono text-text">{ix.name}</Td>
                      <Td className="font-mono text-text2">{keys.map(([k, v]) => `${k}: ${toMongoNumber(v) ?? String(v)}`).join(", ")}</Td>
                      <Td><Pill tone={tone as "brand" | "neutral"}>{type}</Pill></Td>
                      <Td className="font-mono text-text3">{sz != null ? fmtBytes(sz) : statsQ.isLoading ? "…" : "—"}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate ? <MongoCreateIndexDialog saving={create.isPending} onClose={() => setShowCreate(false)} onCreate={(v) => create.mutate(v)} /> : null}
    </div>
  );
}

function MongoCreateIndexDialog({ saving, onClose, onCreate }: { saving: boolean; onClose: () => void; onCreate: (v: { field: string; unique: boolean }) => void }) {
  const [field, setField] = React.useState("");
  const [unique, setUnique] = React.useState(false);
  return (
    <Dialog open onClose={onClose} title="Criar índice" description="Índice ascendente ({ campo: 1 }) sobre um campo.">
      <div className="flex flex-col gap-3">
        <Label>Campo</Label>
        <Input value={field} onChange={(e) => setField(e.target.value)} placeholder="ex.: email" autoFocus />
        <label className="flex items-center gap-2 text-sm text-text2">
          <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} /> Único (unique)
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={saving || !field.trim()} onClick={() => onCreate({ field: field.trim(), unique })}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Criar</Button>
        </div>
      </div>
    </Dialog>
  );
}

function NewCollectionDialog({ id, db, write, onRequestWrite, onClose, onCreated }: {
  id: string; db: string | null; write: boolean; onRequestWrite: () => void; onClose: () => void; onCreated: (name: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState("");
  React.useEffect(() => { if (!write) onRequestWrite(); }, [write, onRequestWrite]);
  const create = useMutation({
    mutationFn: async () => {
      if (!db) throw new ApiError(400, "sem_db", "Selecione um banco primeiro.");
      await mongoExec(id, { op: "createCollection", database: db, collection: name.trim(), write: true });
    },
    onSuccess: () => { toast.show("success", "Coleção criada."); onCreated(name.trim()); },
    onError: (e) => toast.show("error", e instanceof ApiError ? e.message : "Falha ao criar coleção"),
  });
  return (
    <Dialog open onClose={onClose} title="Nova coleção" description={db ? `No banco ${db}.` : "Selecione um banco primeiro."}>
      <div className="flex flex-col gap-3">
        <Label>Nome da coleção</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: usuarios" autoFocus disabled={!write} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={!write || !db || !name.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Criar</Button>
        </div>
      </div>
    </Dialog>
  );
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
