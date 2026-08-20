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
  const uploadRef = React.useRef<HTMLInputElement>(null);

  const listQuery = useQuery({
    queryKey: ["files", id, dir],
    queryFn: () => api.listFiles(id, dir ?? undefined),
    retry: false,
  });

  const root = listQuery.data?.root ?? null;
  const currentPath = listQuery.data?.path ?? dir ?? root ?? "";

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

  function closeDialog() {
    setDialog(null);
    setDialogName("");
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
      ) : listQuery.data && listQuery.data.entries.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <FolderOpen size={40} aria-hidden="true" className="text-text3" />
          <p className="text-sm text-text2">Esta pasta está vazia.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-border-subtle">
            {listQuery.data?.entries.map((entry) => {
              const Icon = iconFor(entry);
              return (
                <li
                  key={entry.name}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg"
                >
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
                  <span className="hidden w-24 shrink-0 text-right text-xs text-text3 sm:block">
                    {entry.type === "file" ? formatSize(entry.size) : "—"}
                  </span>
                  <span className="hidden w-40 shrink-0 text-right text-xs text-text3 md:block">
                    {formatMtime(entry.mtime)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setToDelete(entry)}
                    aria-label={`Excluir ${entry.name}`}
                    className="shrink-0 rounded p-1.5 text-text3 hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
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

      {/* Dialog: confirmar exclusão */}
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
    </div>
  );
}
