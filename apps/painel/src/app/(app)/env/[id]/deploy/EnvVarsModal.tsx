"use client";

/*
 * Modal de Variáveis de ambiente — mesma lógica da página /variaveis, embrulhada
 * num Dialog (com busca + lista rolável), para o padrão de edição do Modelo A.
 * Reaproveita getEnvVars/revealEnvVars/setEnvVars. Nenhuma API nova.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Eye, EyeOff, Lock, Save, Loader2, FileUp, Search, Info } from "lucide-react";
import { ENV_KEY_RE, RESERVED_ENV_KEYS } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

// hidden = flag persistida (escondida no servidor). available = temos o valor em
// texto no painel. valueDirty = valor editado (só então reenvia o valor ao salvar).
interface Row { key: string; value: string; hidden: boolean; available: boolean; valueDirty: boolean }

/** Parseia um .env (ignora vazias/comentadas, aceita export/aspas). */
function parseEnv(text: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    const key = m?.[1];
    if (!key) continue;
    let val = m?.[2] ?? "";
    const qc = val.charAt(0);
    if ((qc === '"' || qc === "'") && val.length >= 2 && val.charAt(val.length - 1) === qc) {
      val = val.slice(1, -1);
      if (qc === '"') val = val.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else {
      const h = val.indexOf(" #");
      if (h !== -1) val = val.slice(0, h);
      val = val.trim();
    }
    out.push({ key, value: val });
  }
  return out;
}

function keyError(key: string): string | null {
  const k = key.trim();
  if (!k) return null;
  if (!ENV_KEY_RE.test(k)) return "Use letras, números e _ (começa com letra ou _).";
  if (RESERVED_ENV_KEYS.includes(k) || k.startsWith("VP_")) return "Nome reservado pelo sistema.";
  return null;
}

export function EnvVarsModal({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["env-vars", id], queryFn: () => api.getEnvVars(id), enabled: open });
  const [rows, setRows] = React.useState<Row[]>([]);
  const [search, setSearch] = React.useState("");
  const [importMode, setImportMode] = React.useState(false);
  const [importText, setImportText] = React.useState("");

  React.useEffect(() => {
    if (!q.data) return;
    setRows(q.data.vars.map((v) => ({ key: v.key, value: "", hidden: v.hidden, available: false, valueDirty: false })));
    if (q.data.vars.length > 0) {
      (async () => {
        try {
          const r = await api.revealEnvVars(id);
          const byKey = new Map(r.vars.map((v) => [v.key, v]));
          setRows((rs) => rs.map((rr) => {
            if (rr.valueDirty) return rr;
            const got = byKey.get(rr.key);
            if (!got) return rr;
            return { ...rr, hidden: got.hidden, value: got.hidden ? "" : got.value, available: !got.hidden };
          }));
        } catch { /* mantém mascarado */ }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      api.setEnvVars(id, {
        vars: rows.filter((r) => r.key.trim()).map((r) => ({ key: r.key.trim(), buildTime: true, hidden: r.hidden, ...(r.valueDirty ? { value: r.value } : {}) })),
      }),
    onSuccess: (r) => { qc.setQueryData(["env-vars", id], r); toast.show("success", r.message ?? "Variáveis salvas."); onClose(); },
    onError: (e) => toast.show("error", e instanceof Error ? e.message : "Falha ao salvar."),
  });

  function toggleHidden(i: number) { setRows((rs) => rs.map((r, j) => (j === i && r.available ? { ...r, hidden: !r.hidden } : r))); }
  function update(i: number, patch: Partial<Row>) { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); }
  function addRow() { setRows((rs) => [...rs, { key: "", value: "", hidden: false, available: true, valueDirty: true }]); }
  function removeRow(i: number) { setRows((rs) => rs.filter((_, j) => j !== i)); }

  function mergeImport(base: Row[], parsed: { key: string; value: string }[]): Row[] {
    const idxByKey = new Map(base.map((r, i) => [r.key, i]));
    const out = [...base];
    for (const p of parsed) {
      const idx = idxByKey.get(p.key);
      const cur = idx !== undefined ? out[idx] : undefined;
      if (idx !== undefined && cur) out[idx] = { ...cur, value: p.value, available: true, valueDirty: true };
      else { out.push({ key: p.key, value: p.value, hidden: false, available: true, valueDirty: true }); idxByKey.set(p.key, out.length - 1); }
    }
    return out;
  }
  function doImport() {
    const parsed = parseEnv(importText);
    if (!parsed.length) { toast.show("error", "Nenhuma variável encontrada."); return; }
    setRows((rs) => mergeImport(rs, parsed));
    setImportMode(false);
    setImportText("");
    toast.show("success", `${parsed.length} variável(is) importada(s). Revise e salve.`);
  }

  const hasBadKey = rows.some((r) => keyError(r.key));
  const term = search.trim().toLowerCase();
  const visible = rows.map((r, i) => ({ r, i })).filter(({ r }) => !term || r.key.toLowerCase().includes(term));

  return (
    <Dialog open={open} onClose={onClose} title="Variáveis de ambiente"
      description="Chave de API, dados do banco… O olho esconde o valor (fica visível só dentro do app)."
      widthClass="w-[min(94vw,44rem)]">
      <div className="flex flex-col gap-3.5">
        {importMode ? (
          <div className="flex flex-col gap-2">
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={9} spellCheck={false}
              placeholder={"APP_ENV=production\nDATABASE_URL=postgres://…\n# comentários são ignorados"}
              className="w-full resize-y rounded-lg border border-border bg-bg p-3 font-mono text-sm text-text outline-none focus:border-brand-strong" />
            <div className="flex items-center justify-end gap-2">
              <span className="mr-auto text-xs text-text3">{parseEnv(importText).length} detectada(s)</span>
              <Button variant="ghost" onClick={() => { setImportMode(false); setImportText(""); }}>Cancelar</Button>
              <Button onClick={doImport} disabled={parseEnv(importText).length === 0}><FileUp size={16} /> Importar</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3.5">
              <Search size={16} className="shrink-0 text-text3" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar variável…"
                className="h-10 w-full bg-transparent text-sm text-text outline-none placeholder:text-text3" />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-text3"><strong className="text-text2">{rows.length}</strong> variáveis</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setImportText(""); setImportMode(true); }}><FileUp size={15} /> Importar .env</Button>
                <Button variant="ghost" size="sm" onClick={addRow}><Plus size={15} /> Adicionar</Button>
              </div>
            </div>

            <div className="flex max-h-[46vh] flex-col gap-2 overflow-y-auto pr-0.5">
              {visible.length === 0 ? (
                <p className="py-6 text-center text-sm text-text3">{rows.length ? "Nenhuma variável com esse nome." : "Nenhuma variável ainda."}</p>
              ) : visible.map(({ r, i }) => {
                const masked = r.hidden || !r.available;
                const err = keyError(r.key);
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input className={`min-w-[150px] flex-1 font-mono ${err ? "border-danger" : ""}`} placeholder="CHAVE" value={r.key} onChange={(e) => update(i, { key: e.target.value })} title={err ?? undefined} />
                    <Input type={masked ? "password" : "text"} className="min-w-[180px] flex-[2] font-mono" placeholder={masked ? "•••••••• (escondida)" : "valor"} value={r.value} onChange={(e) => update(i, { value: e.target.value, valueDirty: true, available: true })} />
                    {r.available ? (
                      <button type="button" onClick={() => toggleHidden(i)} aria-label={r.hidden ? "Mostrar valor" : "Esconder valor"} title={r.hidden ? "Mostrar valor" : "Esconder valor (some ao salvar)"} className="rounded p-1.5 text-text2 hover:bg-bg hover:text-brand-strong">
                        {r.hidden ? <Eye size={16} /> : <EyeOff size={16} />}
                      </button>
                    ) : (
                      <span title="Escondida — o valor só é visto de dentro do container" className="rounded p-1.5 text-text3"><Lock size={16} /></span>
                    )}
                    <button type="button" onClick={() => removeRow(i)} aria-label="Remover" className="rounded p-1.5 text-text2 hover:bg-bg hover:text-danger"><Trash2 size={16} /></button>
                  </div>
                );
              })}
            </div>

            <p className="flex items-start gap-2 text-xs text-text3">
              <Info size={14} className="mt-0.5 shrink-0 text-info" />
              <span><code>PORT</code>, <code>HOSTNAME</code> e <code>NODE_ENV</code> são gerenciadas automaticamente. Salvar aplica no container vivo (reinicia o app ~1s).</span>
            </p>

            <div className="flex justify-end gap-2 border-t border-border-subtle pt-3">
              <Button variant="ghost" onClick={onClose}>Cancelar</Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending || hasBadKey}>
                {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Salvar e aplicar
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
