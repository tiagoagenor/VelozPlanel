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
  ChevronDown,
  ChevronLeft,
  FolderPlus,
  FilePlus,
  Upload,
  UploadCloud,
  RefreshCw,
  RotateCw,
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
  Check,
  FileArchive,
  FolderInput,
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

/** Teto padrão de upload (MB) enquanto o limite real (super admin) não carrega. */
const DEFAULT_MAX_UPLOAD_MB = 200;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Arquivo compactado que o painel sabe descompactar (.zip/.rar). */
function isArchive(name: string): boolean {
  const e = extOf(name);
  return e === "zip" || e === "rar";
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
  onExtract: () => void;
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
  onExtract,
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
      {entry.type === "file" && isArchive(entry.name) ? (
        <Tooltip label="Descompactar">
          <button
            type="button"
            onClick={onExtract}
            aria-label={`Descompactar ${entry.name}`}
            className={btn}
          >
            <FileArchive size={16} aria-hidden="true" />
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

/* ─────────────── Modal de envio (dropzone + pasta de destino) ─────────────── */

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  id: string;
  root: string;
  initialDir: string;
  onUploaded: (destDir: string) => void;
}

interface Chosen {
  file: File;
  id: string; // chave estável para a lista/remoção
}

/** Move o foco para o `treeitem` visível anterior/seguinte (navegação por setas). */
function focusTreeItem(current: HTMLElement, delta: number) {
  const tree = current.closest('[role="tree"]');
  if (!tree) return;
  const items = Array.from(
    tree.querySelectorAll<HTMLElement>('[role="treeitem"]'),
  );
  const idx = items.indexOf(current);
  const next = items[idx + delta];
  if (next) next.focus();
}

/* ─────────────── Nó da árvore de pastas (lazy) ─────────────── */

interface TreeNodeProps {
  id: string; // env id
  path: string; // caminho absoluto desta pasta
  name: string; // rótulo exibido
  level: number; // profundidade (indentação)
  selectedDir: string;
  onSelect: (path: string) => void;
  autoExpandTo: string; // pasta inicial: expande a árvore até ela
  disabled: boolean;
}

/**
 * Um nó de pasta na árvore. Carrega as subpastas SOB DEMANDA (só quando
 * expandido) via `listFiles(path)` filtrando `type==='dir'`. Confinado à raiz
 * porque só descemos por caminhos retornados pela própria API.
 */
function TreeNode({
  id,
  path,
  name,
  level,
  selectedDir,
  onSelect,
  autoExpandTo,
  disabled,
}: TreeNodeProps) {
  // Expande automaticamente se esta pasta é ancestral (estrita) da pasta inicial.
  const isStrictAncestor =
    autoExpandTo === path ? false : autoExpandTo.startsWith(path + "/");
  const [expanded, setExpanded] = React.useState(isStrictAncestor);

  const childrenQuery = useQuery({
    queryKey: ["files", id, path],
    queryFn: () => api.listFiles(id, path),
    enabled: expanded,
    retry: false,
  });
  const childDirs = React.useMemo(
    () => (childrenQuery.data?.entries ?? []).filter((e) => e.type === "dir"),
    [childrenQuery.data?.entries],
  );

  const selected = selectedDir === path;
  const FolderIco = expanded ? FolderOpen : Folder;

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case "ArrowRight":
        if (!expanded) {
          e.preventDefault();
          setExpanded(true);
        }
        break;
      case "ArrowLeft":
        if (expanded) {
          e.preventDefault();
          setExpanded(false);
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        focusTreeItem(e.currentTarget, 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusTreeItem(e.currentTarget, -1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        onSelect(path);
        break;
    }
  }

  return (
    <li role="none">
      <div
        role="treeitem"
        aria-expanded={expanded}
        aria-selected={selected}
        aria-level={level + 1}
        aria-label={name}
        tabIndex={selected ? 0 : -1}
        onKeyDown={onKeyDown}
        onClick={() => onSelect(path)}
        style={{ paddingLeft: 8 + level * 16 }}
        className={`flex cursor-pointer items-center gap-1 rounded-lg py-1.5 pr-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-strong ${
          selected
            ? "bg-brand-soft font-medium text-brand-strong"
            : "text-text hover:bg-bg"
        }`}
      >
        <span
          role="button"
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-text3 hover:text-brand-strong"
        >
          {expanded ? (
            <ChevronDown size={15} />
          ) : (
            <ChevronRight size={15} />
          )}
        </span>
        <FolderIco size={16} aria-hidden="true" className="shrink-0 text-brand-strong" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {selected ? (
          <Check size={15} aria-hidden="true" className="shrink-0 text-brand-strong" />
        ) : null}
      </div>
      {expanded ? (
        childrenQuery.isPending ? (
          <div
            className="flex items-center gap-2 py-1 text-xs text-text3"
            style={{ paddingLeft: 8 + (level + 1) * 16 }}
          >
            <Loader2 size={13} className="animate-spin" aria-label="Carregando" />
            Carregando…
          </div>
        ) : childDirs.length > 0 ? (
          <ul role="group">
            {childDirs.map((d) => (
              <TreeNode
                key={d.name}
                id={id}
                path={joinPath(path, d.name)}
                name={d.name}
                level={level + 1}
                selectedDir={selectedDir}
                onSelect={onSelect}
                autoExpandTo={autoExpandTo}
                disabled={disabled}
              />
            ))}
          </ul>
        ) : (
          <p
            className="py-1 text-xs text-text3"
            style={{ paddingLeft: 8 + (level + 1) * 16 }}
          >
            (sem subpastas)
          </p>
        )
      ) : null}
    </li>
  );
}

/**
 * Modal de envio de arquivos (layout de 2 colunas):
 *  - ESQUERDA: árvore de pastas navegável a partir da raiz, carregando subpastas
 *    sob demanda; clicar seleciona a pasta como destino (destaque + check).
 *  - DIREITA: caminho de destino em destaque + dropzone (drag&drop / clique) +
 *    lista dos arquivos escolhidos + progresso. Upload binário via base64.
 */
function UploadModal({
  open,
  onClose,
  id,
  root,
  initialDir,
  onUploaded,
}: UploadModalProps) {
  const toast = useToast();
  // Limite de upload configurado pelo super admin (MB). Vale para a validação e
  // os avisos. Enquanto carrega, usa o padrão.
  const limitQuery = useQuery({ queryKey: ["upload-limit"], queryFn: api.getUploadLimit });
  const maxMb = limitQuery.data?.maxUploadMb ?? DEFAULT_MAX_UPLOAD_MB;
  const maxBytes = maxMb * 1024 * 1024;
  const [destDir, setDestDir] = React.useState(initialDir);
  const [chosen, setChosen] = React.useState<Chosen[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  // Progresso do envio: arquivo atual (index/total), nome e % por bytes.
  const [progress, setProgress] = React.useState<
    { index: number; total: number; name: string; pct: number } | null
  >(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const seq = React.useRef(0);

  // Ao (re)abrir, reseta o destino para a pasta atual e limpa a seleção.
  React.useEffect(() => {
    if (open) {
      setDestDir(initialDir);
      setChosen([]);
      setDragOver(false);
      setBusy(false);
      setProgress(null);
    }
  }, [open, initialDir]);

  function selectDir(path: string) {
    if (!busy) setDestDir(path);
  }

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    if (arr.length === 0) return;
    setChosen((prev) => [
      ...prev,
      ...arr.map((file) => ({ file, id: `f${seq.current++}` })),
    ]);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }

  function removeChosen(cid: string) {
    setChosen((prev) => prev.filter((c) => c.id !== cid));
  }

  const oversized = chosen.filter((c) => c.file.size > maxBytes);
  const hasOversized = oversized.length > 0;
  const canSend = chosen.length > 0 && !hasOversized && !busy;

  async function startUpload() {
    if (!canSend) return;
    setBusy(true);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < chosen.length; i++) {
      const entry = chosen[i];
      if (!entry) continue;
      const { file } = entry;
      setProgress({ index: i + 1, total: chosen.length, name: file.name, pct: 0 });
      try {
        // Envio binário com progresso real por bytes (XHR).
        const { promise } = api.uploadFileWithProgress(
          id,
          destDir,
          file.name,
          file,
          (frac) =>
            setProgress((p) =>
              p ? { ...p, pct: Math.min(100, Math.round(frac * 100)) } : p,
            ),
        );
        await promise;
        ok++;
      } catch {
        fail++;
      }
    }
    setBusy(false);
    setProgress(null);
    if (fail === 0) {
      toast.show("success", `${ok} arquivo(s) enviado(s).`);
    } else if (ok === 0) {
      toast.show("error", `Falha ao enviar ${fail} arquivo(s).`);
    } else {
      toast.show("error", `${ok} enviado(s), ${fail} falha(s).`);
    }
    onUploaded(destDir);
    onClose();
  }

  const rootName = root.slice(root.lastIndexOf("/") + 1) || root;

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Enviar arquivo"
      description="Escolha a pasta de destino na árvore e arraste ou selecione os arquivos."
      className="w-[min(96vw,60rem)]"
    >
      <div className="grid min-h-[24rem] gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        {/* ESQUERDA — árvore de pastas */}
        <div className="flex min-h-0 flex-col gap-2">
          <Label>Pasta de destino</Label>
          <div className="h-[20rem] max-h-[50vh] overflow-y-auto overscroll-contain rounded-lg border border-border-subtle bg-bg p-1">
            <ul role="tree" aria-label="Árvore de pastas do ambiente" className="flex flex-col">
              <TreeNode
                id={id}
                path={root}
                name={rootName || root}
                level={0}
                selectedDir={destDir}
                onSelect={selectDir}
                autoExpandTo={initialDir}
                disabled={busy}
              />
            </ul>
          </div>
        </div>

        {/* DIREITA — envio */}
        <div className="flex min-h-0 flex-col gap-3">
          {/* Pasta selecionada em destaque */}
          <div className="flex items-center gap-2 rounded-lg border border-brand-strong/30 bg-brand-soft px-3 py-2">
            <FolderOpen size={16} aria-hidden="true" className="shrink-0 text-brand-strong" />
            <span className="shrink-0 text-xs font-medium text-brand-strong">
              Enviar para:
            </span>
            <span
              aria-live="polite"
              className="truncate font-mono text-sm font-medium text-brand-strong"
              title={destDir}
            >
              {destDir}
            </span>
          </div>

          {/* Dropzone */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Arraste arquivos aqui ou clique para selecionar"
            onClick={() => !busy && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !busy) {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragOver(false);
            }}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
              dragOver
                ? "border-brand-strong bg-brand-soft"
                : "border-border bg-bg hover:border-brand-strong"
            } ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            <UploadCloud size={32} aria-hidden="true" className="text-brand-strong" />
            <p className="text-sm font-medium text-text">
              Arraste arquivos aqui ou clique para selecionar
            </p>
            <p className="text-xs text-text3">
              Vários arquivos, incluindo binários (imagens, zip). Máx. {maxMb} MB por arquivo.
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={onInputChange}
            />
          </div>

          {/* Lista dos arquivos escolhidos */}
          {chosen.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-text2">
                {chosen.length} arquivo(s) selecionado(s)
              </span>
              <ul className="max-h-44 flex-1 divide-y divide-border-subtle overflow-y-auto rounded-lg border border-border-subtle">
                {chosen.map((c) => {
                  const big = c.file.size > maxBytes;
                  return (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 px-3 py-2 text-sm"
                    >
                      <FileIcon size={16} aria-hidden="true" className="shrink-0 text-text3" />
                      <span className="min-w-0 flex-1 truncate text-text" title={c.file.name}>
                        {c.file.name}
                      </span>
                      <span
                        className={`shrink-0 text-xs ${big ? "font-medium text-danger" : "text-text3"}`}
                      >
                        {formatSize(c.file.size)}
                      </span>
                      {big ? (
                        <AlertTriangle
                          size={14}
                          aria-label={`Acima do limite de ${maxMb} MB`}
                          className="shrink-0 text-danger"
                        />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removeChosen(c.id)}
                        disabled={busy}
                        aria-label={`Remover ${c.file.name}`}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-text3 hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {hasOversized ? (
                <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
                  <AlertTriangle size={13} aria-hidden="true" />
                  {oversized.length} arquivo(s) acima de {maxMb} MB. Remova-os para enviar.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Rodapé: barra de progresso (por arquivo) + ações */}
          <div className="mt-auto flex flex-col gap-2 pt-1">
            {progress ? (
              <div className="flex flex-col gap-1" aria-live="polite">
                <div className="flex items-center justify-between gap-2 text-xs text-text2">
                  <span className="min-w-0 flex-1 truncate" title={progress.name}>
                    Enviando {progress.index}/{progress.total}: {progress.name}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums text-text">
                    {progress.pct}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-border-subtle">
                  <div
                    className="h-full rounded-full bg-brand-strong transition-[width] duration-150"
                    style={{ width: `${progress.pct}%` }}
                  />
                </div>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void startUpload()} disabled={!canSend}>
                {busy ? (
                  <Loader2 size={16} aria-hidden="true" className="animate-spin" />
                ) : (
                  <UploadCloud size={16} aria-hidden="true" />
                )}
                {busy ? "Enviando…" : "Enviar"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ─────────────── Editor de código com numeração de linhas ───────────────
 * Textarea simples + calha de números à esquerda, com rolagem sincronizada e
 * mesma métrica de linha (leading-6 / py-3). `wrap="off"` mantém 1 linha lógica
 * por linha visual, então a numeração nunca desalinha. */
function CodeEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const gutterRef = React.useRef<HTMLDivElement>(null);
  const lineCount = React.useMemo(() => Math.max(1, value.split("\n").length), [value]);

  const syncScroll = () => {
    if (gutterRef.current && taRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
    }
  };

  // Tab insere indentação em vez de trocar o foco (comportamento de editor).
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = value.slice(0, start) + "  " + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + 2;
    });
  };

  return (
    <div className="flex h-[60vh] overflow-hidden rounded-lg border border-border bg-surface font-mono text-sm">
      <div
        ref={gutterRef}
        aria-hidden="true"
        className="select-none overflow-hidden border-r border-border-subtle bg-bg px-3 py-3 text-right leading-6 tabular-nums text-text3"
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
        spellCheck={false}
        wrap="off"
        aria-label="Conteúdo do arquivo"
        className="flex-1 resize-none overflow-auto whitespace-pre bg-transparent px-3 py-3 leading-6 text-text outline-none"
      />
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
  const [toExtract, setToExtract] = React.useState<FileEntry | null>(null);
  const [downloadingName, setDownloadingName] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState("");
  const [page, setPage] = React.useState(1);
  // Seleção em massa (por nome, único dentro do diretório atual).
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkChmodOpen, setBulkChmodOpen] = React.useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
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

  // Sinaliza que arquivos foram alterados desde o último reinício (apps Node/
  // compilados só pegam a mudança ao reiniciar o processo).
  const [changed, setChanged] = React.useState(false);
  const restartMutation = useMutation({
    mutationFn: () => api.restartEnvironment(id),
    onSuccess: () => {
      toast.show("success", "Reiniciando — as alterações de arquivo serão aplicadas.");
      setChanged(false);
    },
    onError: (err) =>
      toast.show("error", err instanceof ApiError && err.message ? err.message : "Não foi possível reiniciar. O ambiente precisa estar em execução."),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { path: string; content: string }) =>
      api.writeFile(id, payload.path, payload.content),
    onSuccess: () => {
      toast.show("success", "Arquivo salvo.");
      setChanged(true);
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
      setChanged(true);
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
      setChanged(true);
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
      setChanged(true);
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

  const extractMutation = useMutation({
    mutationFn: (payload: { entry: FileEntry; mode: "here" | "folder" }) =>
      api.extractFile(id, joinPath(currentPath, payload.entry.name), payload.mode),
    onSuccess: (result) => {
      toast.show("success", `${result.files} arquivo(s) extraído(s).`);
      setChanged(true);
      setToExtract(null);
      refresh();
    },
    onError: (err) =>
      toast.show("error", err instanceof Error ? err.message : "Falha ao descompactar."),
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
            onClick={() => setUploadOpen(true)}
            disabled={!root}
          >
            <Upload size={16} aria-hidden="true" />
            Enviar arquivo
          </Button>
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

      {/* Aviso: arquivos alterados → reiniciar para aplicar (apps Node/compilados) */}
      {changed ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3">
          <p className="flex items-center gap-2 text-sm text-text">
            <AlertTriangle size={16} aria-hidden="true" className="shrink-0 text-warning" />
            <span>
              Você alterou arquivos. Em apps <strong>Node/compilados</strong> a mudança só vale depois de <strong>reiniciar</strong> o ambiente.
            </span>
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setChanged(false)}>Dispensar</Button>
            <Button size="sm" onClick={() => restartMutation.mutate()} disabled={restartMutation.isPending}>
              <RotateCw size={15} aria-hidden="true" className={restartMutation.isPending ? "animate-spin" : undefined} />
              {restartMutation.isPending ? "Reiniciando…" : "Reiniciar agora"}
            </Button>
          </div>
        </div>
      ) : null}

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
              <CodeEditor value={content} onChange={setContent} />
            </>
          )}
        </Card>
      ) : null}

      {/* Filtro por nome */}
      {!editing && root && !notRunning && !listQuery.isError ? (
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
      {!editing && root && !notRunning && !listQuery.isError ? (
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

      {/* Listagem (escondida enquanto um arquivo está aberto no editor) */}
      {!editing && (listQuery.isPending ? (
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
                      onExtract={() => setToExtract(entry)}
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
      ))}

      {/* Modal: enviar arquivo (dropzone + pasta de destino) */}
      {root ? (
        <UploadModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          id={id}
          root={root}
          initialDir={currentPath}
          onUploaded={() => { setChanged(true); refresh(); }}
        />
      ) : null}

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

      {/* Dialog: descompactar (.zip/.rar) — escolher o destino */}
      <Dialog
        open={toExtract !== null}
        onClose={() => {
          if (!extractMutation.isPending) setToExtract(null);
        }}
        title="Descompactar"
        description={
          toExtract
            ? `Extrair "${toExtract.name}". O arquivo original é mantido.`
            : ""
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text2">Onde você quer extrair o conteúdo?</p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={extractMutation.isPending}
              onClick={() =>
                toExtract && extractMutation.mutate({ entry: toExtract, mode: "here" })
              }
              className="flex items-start gap-3 rounded-lg border border-border p-3 text-left hover:border-brand-strong hover:bg-brand-soft disabled:opacity-60"
            >
              <FolderInput
                size={18}
                className="mt-0.5 shrink-0 text-brand-strong"
                aria-hidden="true"
              />
              <span>
                <span className="block text-sm font-medium text-text">Extrair aqui</span>
                <span className="block text-xs text-text3">
                  Coloca os arquivos direto na pasta atual.
                </span>
              </span>
            </button>
            <button
              type="button"
              disabled={extractMutation.isPending}
              onClick={() =>
                toExtract && extractMutation.mutate({ entry: toExtract, mode: "folder" })
              }
              className="flex items-start gap-3 rounded-lg border border-border p-3 text-left hover:border-brand-strong hover:bg-brand-soft disabled:opacity-60"
            >
              <FolderPlus
                size={18}
                className="mt-0.5 shrink-0 text-brand-strong"
                aria-hidden="true"
              />
              <span>
                <span className="block text-sm font-medium text-text">
                  Em uma nova pasta
                </span>
                <span className="block text-xs text-text3">
                  Cria uma pasta com o nome do arquivo e extrai dentro.
                </span>
              </span>
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-text3" aria-live="polite">
              {extractMutation.isPending ? "Descompactando…" : ""}
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={() => setToExtract(null)}
              disabled={extractMutation.isPending}
            >
              Cancelar
            </Button>
          </div>
        </div>
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
