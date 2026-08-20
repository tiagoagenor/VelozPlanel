"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderOpen,
  Folder,
  File as FileIcon,
  FileCode,
  Home,
  ChevronRight,
  ChevronLeft,
  FolderPlus,
  FilePlus,
  Upload,
  RefreshCw,
  Save,
  Trash2,
  X,
  AlertTriangle,
  PlayCircle,
  Loader2,
  Download,
  Pencil,
  Lock,
  Search,
} from "lucide-react";
import type { FileEntry } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

const CODE_EXT = new Set([
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "php", "json", "css", "scss",
  "html", "htm", "xml", "yml", "yaml", "md", "py", "rb", "go", "rs",
  "sh", "bash", "sql", "env", "ini", "conf", "toml", "vue", "svelte",
]);

const PAGE_SIZE = 50;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function iconFor(entry: FileEntry) {
  if (entry.type === "dir") return Folder;
  return CODE_EXT.has(extOf(entry.name)) ? FileCode : FileIcon;
}

function joinPath(base: string, name: string): string {
  return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMtime(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ─────────────── Permissões (octal <-> checkboxes) ─────────────── */

type Triplet = { r: boolean; w: boolean; x: boolean };
type PermClass = "owner" | "group" | "other";

function digitToTriplet(d: string): Triplet {
  const n = Number.parseInt(d, 10) || 0;
  return { r: (n & 4) !== 0, w: (n & 2) !== 0, x: (n & 1) !== 0 };
}

function tripletToDigit(t: Triplet): number {
  return (t.r ? 4 : 0) + (t.w ? 2 : 0) + (t.x ? 1 : 0);
}

/** Os 3 últimos dígitos (dono/grupo/outros) do modo, garantindo 3 chars. */
function lastThree(mode: string): string {
  const digits = mode.replace(/[^0-7]/g, "");
  return digits.slice(-3).padStart(3, "0");
}

/** Prefixo especial (setuid/setgid/sticky) se o modo tiver 4 dígitos. */
function specialPrefix(mode: string): string {
  const digits = mode.replace(/[^0-7]/g, "");
  return digits.length >= 4 ? digits.slice(-4, -3) : "";
}

/* ─────────────── Tooltip próprio (hover + foco por teclado) ─────────────── */

/**
 * Tooltip leve (sem lib): aparece em `group-hover` e `group-focus-within`
 * (ou seja, também no foco por teclado). `role="tooltip"`. Posicionado acima e
 * alinhado à direita por padrão para não ser cortado pela borda do card.
 */
function Tooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 z-30 mb-1.5 whitespace-nowrap rounded-md bg-brand-strong px-2 py-1 text-xs font-medium text-on-solid opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

/* ─────────────── Ações inline por linha ─────────────── */

interface RowActionsProps {
  entry: FileEntry;
  onDownload: () => void;
  onRename: () => void;
  onChmod: () => void;
  onDelete: () => void;
  downloading: boolean;
}

/**
 * Botões de ação sempre visíveis na própria linha (sem dropdown, que era
 * cortado pela borda do card). Ícones com aria-label + tooltip próprio.
 */
function RowActions({
  entry,
  onDownload,
  onRename,
  onChmod,
  onDelete,
  downloading,
}: RowActionsProps) {
  const btn =
    "grid h-8 w-8 place-items-center rounded-lg text-text3 hover:bg-brand-soft hover:text-brand-strong";
  return (
    <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
      {entry.type === "file" ? (
        <Tooltip label="Baixar">
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading}
            aria-label={`Baixar ${entry.name}`}
            className={btn}
          >
            {downloading ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Download size={16} aria-hidden="true" />
            )}
          </button>
        </Tooltip>
      ) : null}
      <Tooltip label="Renomear">
        <button
          type="button"
          onClick={onRename}
          aria-label={`Renomear ${entry.name}`}
          className={btn}
        >
          <Pencil size={16} aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip label="Permissões">
        <button
          type="button"
          onClick={onChmod}
          aria-label={`Permissões de ${entry.name}`}
          className={btn}
        >
          <Lock size={16} aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip label="Excluir">
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Excluir ${entry.name}`}
          className="grid h-8 w-8 place-items-center rounded-lg text-text3 hover:bg-danger-soft hover:text-danger"
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}

export default function EnvArquivosPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const toast = useToast();

  const [dir, setDir] = React.useState<string | null>(null); // null => raiz
  const [editing, setEditing] = React.useState<{ path: string; name: string } | null>(null);
  const [content, setContent] = React.useState("");
  const [dialog, setDialog] = React.useState<null | "mkdir" | "newfile">(null);
  const [dialogName, setDialogName] = React.useState("");
  const [toDelete, setToDelete] = React.useState<FileEntry | null>(null);
  const [toRename, setToRename] = React.useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [toChmod, setToChmod] = React.useState<FileEntry | null>(null);
  const [modeInput, setModeInput] = React.useState("");
  const [downloadingName, setDownloadingName] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");
  const [page, setPage] = React.useState(1);
  // Seleção em massa (por nome, único dentro do diretório atual).
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkChmodOpen, setBulkChmodOpen] = React.useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const uploadRef = React.useRef<HTMLInputElement>(null);
  const selectAllRef = React.useRef<HTMLInputElement>(null);

  const listQuery = useQuery({
    queryKey: ["files", id, dir],
    queryFn: () => api.listFiles(id, dir ?? undefined),
    retry: false,
  });

  const root = listQuery.data?.root ?? null;
  const currentPath = listQuery.data?.path ?? dir ?? root ?? "";

  function clearSelection() {
    setSelected(new Set());
  }

  // Ao trocar de pasta, volta para a página 1 e limpa a seleção.
  React.useEffect(() => {
    setPage(1);
    clearSelection();
  }, [dir]);

  // Query do conteúdo do arquivo em edição.
  const fileQuery = useQuery({
    queryKey: ["file", id, editing?.path],
    queryFn: () => api.readFile(id, editing!.path),
    enabled: Boolean(editing),
    retry: false,
  });
  React.useEffect(() => {
    if (fileQuery.data) setContent(fileQuery.data.content);
  }, [fileQuery.data]);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["files", id] });
  }

  const saveMutation = useMutation({
    mutationFn: (payload: { path: string; content: string }) =>
      api.writeFile(id, payload.path, payload.content),
    onSuccess: () => {
      toast.show("success", "Arquivo salvo.");
      qc.invalidateQueries({ queryKey: ["file", id, editing?.path] });
      refresh();
    },
    onError: (err) =>
      toast.show("error", err instanceof Error ? err.message : "Falha ao salvar."),
  });

  const mkdirMutation = useMutation({
    mutationFn: (name: string) => api.mkdirFile(id, joinPath(currentPath, name)),
    onSuccess: () => {
      toast.show("success", "Pasta criada.");
      closeDialog();
      refresh();
    },
    onError: (err) =>
      toast.show("error", err instanceof Error ? err.message : "Falha ao criar pasta."),
  });

  const newFileMutation = useMutation({
    mutationFn: (name: string) => api.writeFile(id, joinPath(currentPath, name), ""),
    onSuccess: () => {
      toast.show("success", "Arquivo criado.");
      closeDialog();
      refresh();
    },
    onError: (err) =>
      toast.show("error", err instanceof Error ? err.message : "Falha ao criar arquivo."),
  });

  const deleteMutation = useMutation({
    mutationFn: (entry: FileEntry) => api.deleteFile(id, joinPath(currentPath, entry.name)),
    onSuccess: (_data, entry) => {
      toast.show("success", `"${entry.name}" excluído.`);
      if (editing && editing.name === entry.name) setEditing(null);
      setToDelete(null);
      refresh();
    },
    onError: (err) =>
      toast.show("error", err instanceof Error ? err.message : "Falha ao excluir."),
  });

  const renameMutation = useMutation({
    mutationFn: (payload: { entry: FileEntry; newName: string }) =>
      api.renameFile(id, joinPath(currentPath, payload.entry.name), payload.newName),
    onSuccess: (_data, payload) => {
      toast.show("success", `Renomeado para "${payload.newName}".`);
      if (editing && editing.name === payload.entry.name) setEditing(null);
      setToRename(null);
      refresh();
    },
    onError: (err) =>
      toast.show("error", err instanceof Error ? err.message : "Falha ao renomear."),
  });

  const chmodMutation = useMutation({
    mutationFn: (payload: { entry: FileEntry; mode: string }) =>
      api.chmodFile(id, joinPath(currentPath, payload.entry.name), payload.mode),
    onSuccess: (_data, payload) => {
      toast.show("success", `Permissões alteradas para ${payload.mode}.`);
      setToChmod(null);
      refresh();
    },
    onError: (err) =>
      toast.show("error", err instanceof Error ? err.message : "Falha ao alterar permissões."),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      return api.writeFile(id, joinPath(currentPath, file.name), text);
    },
    onSuccess: () => {
      toast.show("success", "Arquivo enviado.");
      refresh();
    },
    onError: (err) =>
      toast.show("error", err instanceof Error ? err.message : "Falha ao enviar arquivo."),
  });

  async function handleDownload(entry: FileEntry) {
    setDownloadingName(entry.name);
    try {
      const blob = await api.downloadFile(id, joinPath(currentPath, entry.name));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = entry.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.show("error", err instanceof Error ? err.message : "Falha ao baixar.");
    } finally {
      setDownloadingName(null);
    }
  }

  function closeDialog() {
    setDialog(null);
    setDialogName("");
  }

  function openRename(entry: FileEntry) {
    setToRename(entry);
    setRenameValue(entry.name);
  }

  function openChmod(entry: FileEntry) {
    setToChmod(entry);
    setModeInput(lastThree(entry.mode));
  }

  function openEntry(entry: FileEntry) {
    const full = joinPath(currentPath, entry.name);
    if (entry.type === "dir") {
      setDir(full);
      setEditing(null);
    } else {
      setEditing({ path: full, name: entry.name });
      setContent("");
    }
  }

  function navigateTo(path: string) {
    setDir(path);
    setEditing(null);
  }

  function submitDialog(e: React.FormEvent) {
    e.preventDefault();
    const name = dialogName.trim();
    if (!name || name.includes("/")) {
      toast.show("error", "Nome inválido (sem barras).");
      return;
    }
    if (dialog === "mkdir") mkdirMutation.mutate(name);
    else if (dialog === "newfile") newFileMutation.mutate(name);
  }

  function submitRename(e: React.FormEvent) {
    e.preventDefault();
    const name = renameValue.trim();
    if (!name || name.includes("/")) {
      toast.show("error", "Nome inválido (sem barras).");
      return;
    }
    if (toRename && name !== toRename.name) {
      renameMutation.mutate({ entry: toRename, newName: name });
    } else {
      setToRename(null);
    }
  }

  function submitChmod(e: React.FormEvent) {
    e.preventDefault();
    const mode = modeInput.trim();
    if (!/^[0-7]{3,4}$/.test(mode)) {
      toast.show("error", "Modo octal inválido (ex.: 644 ou 755).");
      return;
    }
    if (bulkChmodOpen) {
      void runBulkChmod(mode);
      return;
    }
    if (toChmod) chmodMutation.mutate({ entry: toChmod, mode });
  }

  // Alterna um bit de permissão (r/w/x) de uma classe (dono/grupo/outros).
  function togglePerm(cls: PermClass, bit: keyof Triplet) {
    const three = lastThree(modeInput);
    const idx = cls === "owner" ? 0 : cls === "group" ? 1 : 2;
    const trip = digitToTriplet(three[idx] ?? "0");
    trip[bit] = !trip[bit];
    const digits = three.split("");
    digits[idx] = String(tripletToDigit(trip));
    setModeInput(specialPrefix(modeInput) + digits.join(""));
  }

  function onUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    e.target.value = "";
  }

  // Segmentos do breadcrumb (relativos à raiz).
  const segments: { label: string; path: string }[] = [];
  if (root) {
    let acc = root;
    const rest = currentPath === root ? "" : currentPath.slice(root.length + 1);
    for (const part of rest.split("/").filter(Boolean)) {
      acc = joinPath(acc, part);
      segments.push({ label: part, path: acc });
    }
  }

  const notRunning =
    listQuery.error instanceof ApiError && listQuery.error.status === 409;

  // Ordenação (pastas primeiro, alfabético) + filtro + paginação client-side.
  const allEntries = React.useMemo(() => {
    const list = [...(listQuery.data?.entries ?? [])];
    list.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    return list;
  }, [listQuery.data?.entries]);

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return allEntries;
    return allEntries.filter((e) => e.name.toLowerCase().includes(q));
  }, [allEntries, filter]);

  // Mantém a seleção coerente com os itens realmente existentes.
  React.useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const names = new Set(allEntries.map((e) => e.name));
      let changed = false;
      const next = new Set<string>();
      for (const n of prev) {
        if (names.has(n)) next.add(n);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [allEntries]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageEntries = filtered.slice(start, start + PAGE_SIZE);
  const rangeFrom = total === 0 ? 0 : start + 1;
  const rangeTo = Math.min(start + PAGE_SIZE, total);

  // Seleção sobre o conjunto filtrado (todos os itens mostrados/filtrados).
  const allSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.name));
  const someSelected = filtered.some((e) => selected.has(e.name));

  React.useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  function toggleOne(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      if (filtered.length > 0 && filtered.every((e) => prev.has(e.name))) {
        return new Set();
      }
      return new Set(filtered.map((e) => e.name));
    });
  }

  const selectedEntries = React.useMemo(
    () => allEntries.filter((e) => selected.has(e.name)),
    [allEntries, selected],
  );

  function reportBulk(action: string, ok: number, fail: number) {
    if (fail === 0) toast.show("success", `${action}: ${ok} item(ns).`);
    else if (ok === 0) toast.show("error", `${action}: falhou em ${fail} item(ns).`);
    else toast.show("error", `${action}: ${ok} ok, ${fail} falha(s).`);
  }

  function openBulkChmod() {
    setModeInput("644");
    setBulkChmodOpen(true);
  }

  async function runBulkChmod(mode: string) {
    const entries = selectedEntries;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const entry of entries) {
      try {
        await api.chmodFile(id, joinPath(currentPath, entry.name), mode);
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkBusy(false);
    setBulkChmodOpen(false);
    clearSelection();
    refresh();
    reportBulk(`Permissões (${mode})`, ok, fail);
  }

  async function runBulkDelete() {
    const entries = selectedEntries;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const entry of entries) {
      try {
        await api.deleteFile(id, joinPath(currentPath, entry.name));
        if (editing && editing.name === entry.name) setEditing(null);
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkBusy(false);
    setBulkDeleteOpen(false);
    clearSelection();
    refresh();
    reportBulk("Exclusão", ok, fail);
  }

  const chmodThree = lastThree(modeInput);
  const permClasses: { key: PermClass; label: string }[] = [
    { key: "owner", label: "Dono" },
    { key: "group", label: "Grupo" },
    { key: "other", label: "Outros" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-text">
            <FolderOpen size={20} aria-hidden="true" className="text-brand-strong" />
            Arquivos
          </h1>
          <p className="mt-1 text-sm text-text2">
            Navegue, edite, crie e envie arquivos do seu ambiente.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialog("mkdir")}
            disabled={!root}
          >
            <FolderPlus size={16} aria-hidden="true" />
            Nova pasta
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialog("newfile")}
            disabled={!root}
          >
            <FilePlus size={16} aria-hidden="true" />
            Novo arquivo
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => uploadRef.current?.click()}
            disabled={!root || uploadMutation.isPending}
          >
            <Upload size={16} aria-hidden="true" />
            Enviar arquivo
          </Button>
          <input
            ref={uploadRef}
            type="file"
            className="hidden"
            onChange={onUploadChange}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={refresh}
            aria-label="Recarregar"
            disabled={listQuery.isFetching}
          >
            <RefreshCw
              size={16}
              aria-hidden="true"
              className={listQuery.isFetching ? "animate-spin" : ""}
            />
          </Button>
        </div>
      </header>

      {/* Breadcrumb */}
      {root ? (
        <nav
          aria-label="Caminho"
          className="flex flex-wrap items-center gap-1 text-sm text-text2"
        >
          <button
            type="button"
            onClick={() => navigateTo(root)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-link hover:bg-brand-soft"
          >
            <Home size={14} aria-hidden="true" />
            {root}
          </button>
          {segments.map((seg) => (
            <React.Fragment key={seg.path}>
              <ChevronRight size={14} aria-hidden="true" className="text-text3" />
              <button
                type="button"
                onClick={() => navigateTo(seg.path)}
                className="rounded px-1.5 py-0.5 font-medium text-link hover:bg-brand-soft"
              >
                {seg.label}
              </button>
            </React.Fragment>
          ))}
        </nav>
      ) : null}

      {/* Editor de arquivo */}
      {editing ? (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold text-text">
              <FileCode size={16} aria-hidden="true" className="text-brand-strong" />
              {editing.name}
            </h2>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => saveMutation.mutate({ path: editing.path, content })}
                disabled={saveMutation.isPending || fileQuery.isPending}
              >
                <Save size={16} aria-hidden="true" />
                {saveMutation.isPending ? "Salvando…" : "Salvar"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                <X size={16} aria-hidden="true" />
                Fechar
              </Button>
            </div>
          </div>
          {fileQuery.isPending ? (
            <div className="grid h-40 place-items-center">
              <Loader2 size={22} className="animate-spin text-brand-strong" aria-label="Carregando" />
            </div>
          ) : fileQuery.isError ? (
            <p role="alert" className="flex items-center gap-2 text-sm text-danger">
              <AlertTriangle size={16} aria-hidden="true" />
              {fileQuery.error instanceof Error
                ? fileQuery.error.message
                : "Não foi possível abrir o arquivo."}
            </p>
          ) : (
            <>
              {fileQuery.data?.truncated ? (
                <p className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg p-2.5 text-xs text-text2">
                  <AlertTriangle size={14} aria-hidden="true" className="text-warning" />
                  Arquivo grande — exibindo apenas o começo. Salvar aqui pode truncar o conteúdo.
                </p>
              ) : null}
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                className="h-[50vh] w-full resize-y rounded-lg border border-border bg-surface p-3 font-mono text-sm text-text focus:border-brand-strong"
              />
            </>
          )}
        </Card>
      ) : null}

      {/* Filtro por nome */}
      {root && !notRunning && !listQuery.isError ? (
        <div className="relative max-w-xs">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text3"
          />
          <Input
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
              clearSelection();
            }}
            placeholder="Filtrar por nome…"
            aria-label="Filtrar por nome"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-9 pl-9"
          />
        </div>
      ) : null}

      {/* Barra de ações em massa — sempre renderizada (altura estável) */}
      {root && !notRunning && !listQuery.isError ? (
        <div
          className={`flex min-h-[3rem] flex-wrap items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
            selected.size > 0
              ? "border-brand-strong/30 bg-brand-soft"
              : "border-border-subtle bg-bg"
          }`}
        >
          <span
            aria-live="polite"
            className={`text-sm font-medium ${
              selected.size > 0 ? "text-brand-strong" : "text-text3"
            }`}
          >
            {selected.size > 0
              ? `${selected.size} selecionado${selected.size > 1 ? "s" : ""}`
              : "Selecione arquivos para ações em massa"}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={openBulkChmod}
              disabled={selected.size === 0 || bulkBusy}
              aria-disabled={selected.size === 0 || bulkBusy}
            >
              <Lock size={16} aria-hidden="true" />
              Alterar permissões
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => setBulkDeleteOpen(true)}
              disabled={selected.size === 0 || bulkBusy}
              aria-disabled={selected.size === 0 || bulkBusy}
            >
              <Trash2 size={16} aria-hidden="true" />
              Excluir selecionados
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={clearSelection}
              disabled={selected.size === 0 || bulkBusy}
              aria-disabled={selected.size === 0 || bulkBusy}
            >
              <X size={16} aria-hidden="true" />
              Limpar seleção
            </Button>
          </div>
        </div>
      ) : null}

      {/* Listagem */}
      {listQuery.isPending ? (
        <div className="grid h-40 place-items-center">
          <Loader2 size={24} className="animate-spin text-brand-strong" aria-label="Carregando" />
        </div>
      ) : notRunning ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <PlayCircle size={40} aria-hidden="true" className="text-text3" />
          <p className="max-w-sm text-sm text-text2">
            Inicie o ambiente para ver os arquivos.
          </p>
        </Card>
      ) : listQuery.isError ? (
        <Card className="flex items-start gap-3">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <p role="alert" className="font-medium text-text">
            {listQuery.error instanceof Error
              ? listQuery.error.message
              : "Não foi possível carregar os arquivos."}
          </p>
        </Card>
      ) : total === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <FolderOpen size={40} aria-hidden="true" className="text-text3" />
          <p className="text-sm text-text2">
            {filter.trim()
              ? "Nenhum arquivo corresponde ao filtro."
              : "Esta pasta está vazia."}
          </p>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            {/* Cabeçalho: selecionar todos */}
            <div className="flex items-center gap-3 border-b border-border-subtle bg-bg px-4 py-2">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Selecionar todos"
                className="h-4 w-4 shrink-0 accent-brand"
              />
              <span className="text-xs font-medium text-text2">
                {selected.size > 0
                  ? `${selected.size} selecionado${selected.size > 1 ? "s" : ""}`
                  : "Selecionar todos"}
              </span>
            </div>
            <ul className="divide-y divide-border-subtle">
              {pageEntries.map((entry) => {
                const Icon = iconFor(entry);
                const checked = selected.has(entry.name);
                return (
                  <li
                    key={entry.name}
                    className={`flex items-center gap-3 px-4 py-2.5 hover:bg-bg ${
                      checked ? "bg-brand-soft/40" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(entry.name)}
                      aria-label={`Selecionar ${entry.name}`}
                      className="h-4 w-4 shrink-0 accent-brand"
                    />
                    <button
                      type="button"
                      onClick={() => openEntry(entry)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <Icon
                        size={18}
                        aria-hidden="true"
                        className={entry.type === "dir" ? "text-brand-strong" : "text-text3"}
                      />
                      <span className="truncate font-medium text-text">{entry.name}</span>
                    </button>
                    <span
                      className="hidden shrink-0 rounded border border-border-subtle bg-bg px-1.5 py-0.5 font-mono text-[11px] text-text3 sm:inline"
                      title={`Permissões ${entry.mode}`}
                    >
                      {entry.mode}
                    </span>
                    <span className="hidden w-24 shrink-0 text-right text-xs text-text3 sm:block">
                      {entry.type === "file" ? formatSize(entry.size) : "—"}
                    </span>
                    <span className="hidden w-40 shrink-0 text-right text-xs text-text3 md:block">
                      {formatMtime(entry.mtime)}
                    </span>
                    <RowActions
                      entry={entry}
                      downloading={downloadingName === entry.name}
                      onDownload={() => handleDownload(entry)}
                      onRename={() => openRename(entry)}
                      onChmod={() => openChmod(entry)}
                      onDelete={() => setToDelete(entry)}
                    />
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* Paginação */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text2">
            <span>
              Mostrando {rangeFrom}–{rangeTo} de {total}
            </span>
            {pageCount > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  aria-label="Página anterior"
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                  Anterior
                </Button>
                <span className="tabular-nums text-text3">
                  {safePage} / {pageCount}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={safePage >= pageCount}
                  aria-label="Próxima página"
                >
                  Próxima
                  <ChevronRight size={16} aria-hidden="true" />
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}

      {/* Dialog: nova pasta / novo arquivo */}
      <Dialog
        open={dialog !== null}
        onClose={closeDialog}
        title={dialog === "mkdir" ? "Nova pasta" : "Novo arquivo"}
        description={`Será criado em ${currentPath || "/"}`}
      >
        <form onSubmit={submitDialog} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-name">Nome</Label>
            <Input
              id="new-name"
              value={dialogName}
              onChange={(e) => setDialogName(e.target.value)}
              placeholder={dialog === "mkdir" ? "minha-pasta" : "arquivo.txt"}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={closeDialog}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={mkdirMutation.isPending || newFileMutation.isPending}
            >
              Criar
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Dialog: renomear */}
      <Dialog
        open={toRename !== null}
        onClose={() => setToRename(null)}
        title="Renomear"
        description={toRename ? `Renomear "${toRename.name}"` : ""}
      >
        <form onSubmit={submitRename} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rename-name">Novo nome</Label>
            <Input
              id="rename-name"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setToRename(null)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={renameMutation.isPending}>
              <Pencil size={16} aria-hidden="true" />
              {renameMutation.isPending ? "Renomeando…" : "Renomear"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Dialog: permissões (chmod) — item único ou em massa */}
      <Dialog
        open={toChmod !== null || bulkChmodOpen}
        onClose={() => {
          setToChmod(null);
          setBulkChmodOpen(false);
        }}
        title="Permissões"
        description={
          bulkChmodOpen
            ? `Aplicar permissões a ${selected.size} item(ns) selecionado(s)`
            : toChmod
              ? `Alterar permissões de "${toChmod.name}" (atual: ${toChmod.mode})`
              : ""
        }
      >
        <form onSubmit={submitChmod} className="flex flex-col gap-4">
          {/* Grade de checkboxes r/w/x por classe */}
          <div className="overflow-hidden rounded-lg border border-border-subtle">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg text-text2">
                  <th className="px-3 py-2 text-left font-medium">Classe</th>
                  <th className="px-2 py-2 font-medium">Leitura</th>
                  <th className="px-2 py-2 font-medium">Escrita</th>
                  <th className="px-2 py-2 font-medium">Execução</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {permClasses.map((cls, i) => {
                  const trip = digitToTriplet(chmodThree[i] ?? "0");
                  return (
                    <tr key={cls.key}>
                      <td className="px-3 py-2 font-medium text-text">{cls.label}</td>
                      {(["r", "w", "x"] as (keyof Triplet)[]).map((bit) => (
                        <td key={bit} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={trip[bit]}
                            onChange={() => togglePerm(cls.key, bit)}
                            aria-label={`${cls.label} ${
                              bit === "r" ? "leitura" : bit === "w" ? "escrita" : "execução"
                            }`}
                            className="h-4 w-4 accent-brand"
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Campo octal direto */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mode-octal">Modo octal</Label>
            <Input
              id="mode-octal"
              value={modeInput}
              onChange={(e) =>
                setModeInput(e.target.value.replace(/[^0-7]/g, "").slice(0, 4))
              }
              placeholder="644"
              inputMode="numeric"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-24 font-mono"
            />
            <p className="text-xs text-text3">Ex.: 644 (arquivo), 755 (pasta/executável).</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setToChmod(null);
                setBulkChmodOpen(false);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={chmodMutation.isPending || bulkBusy}>
              <Lock size={16} aria-hidden="true" />
              {chmodMutation.isPending || bulkBusy ? "Aplicando…" : "Aplicar"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Dialog: confirmar exclusão (item único) */}
      <Dialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Excluir"
        description={
          toDelete
            ? `Tem certeza que deseja excluir "${toDelete.name}"?${
                toDelete.type === "dir" ? " A pasta e todo o conteúdo serão removidos." : ""
              }`
            : ""
        }
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setToDelete(null)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={() => toDelete && deleteMutation.mutate(toDelete)}
            disabled={deleteMutation.isPending}
          >
            <Trash2 size={16} aria-hidden="true" />
            {deleteMutation.isPending ? "Excluindo…" : "Excluir"}
          </Button>
        </div>
      </Dialog>

      {/* Dialog: confirmar exclusão em massa */}
      <Dialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title="Excluir selecionados"
        description={`Excluir ${selected.size} item(ns) selecionado(s)? Esta ação não pode ser desfeita e pastas serão removidas com todo o conteúdo.`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setBulkDeleteOpen(false)} disabled={bulkBusy}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={() => void runBulkDelete()} disabled={bulkBusy}>
            <Trash2 size={16} aria-hidden="true" />
            {bulkBusy ? "Excluindo…" : `Excluir ${selected.size}`}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
