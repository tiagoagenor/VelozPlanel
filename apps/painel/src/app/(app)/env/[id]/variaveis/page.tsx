"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Braces, Plus, Trash2, Eye, EyeOff, Save, Loader2, Info, FileUp } from "lucide-react";
import * as api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

interface Row { key: string; value: string; dirty: boolean; shown: boolean }

/** Parseia um .env: ignora linhas em branco e comentadas (#), aceita `export`,
 *  aspas simples/duplas e comentário no fim de valor sem aspas. */
function parseEnv(text: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue; // ignora comentários e vazias
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    const key = m?.[1];
    if (!key) continue;
    let val = m?.[2] ?? "";
    const q = val.charAt(0);
    if ((q === '"' || q === "'") && val.length >= 2 && val.charAt(val.length - 1) === q) {
      val = val.slice(1, -1);
      if (q === '"') val = val.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else {
      const h = val.indexOf(" #"); // comentário inline só em valor sem aspas
      if (h !== -1) val = val.slice(0, h);
      val = val.trim();
    }
    out.push({ key, value: val });
  }
  return out;
}

export default function EnvVarsPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["env-vars", id], queryFn: () => api.getEnvVars(id) });
  const [rows, setRows] = React.useState<Row[]>([]);
  const [revealed, setRevealed] = React.useState(false); // já buscamos os valores em texto?
  const [importOpen, setImportOpen] = React.useState(false);
  const [importText, setImportText] = React.useState("");
  const [importing, setImporting] = React.useState(false);

  // Valores EXIBIDOS por padrão: ao carregar, busca os valores em texto. O olho
  // de cada linha esconde/mostra; escondido = só se vê de dentro do container.
  React.useEffect(() => {
    if (!q.data) return;
    setRows(q.data.vars.map((v) => ({ key: v.key, value: "", dirty: false, shown: true })));
    setRevealed(false);
    if (q.data.vars.length > 0) {
      (async () => {
        try {
          const r = await api.revealEnvVars(id);
          const byKey = new Map(r.vars.map((v) => [v.key, v.value]));
          setRows((rs) => rs.map((rr) => (rr.dirty ? rr : { ...rr, value: byKey.get(rr.key) ?? "" })));
          setRevealed(true);
        } catch { /* mantém mascarado se falhar */ }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const save = useMutation({
    // value só das linhas EDITADAS; as intocadas vão sem value → o backend mantém
    // o segredo atual (nunca zera nem precisa revelar pra salvar).
    mutationFn: () =>
      api.setEnvVars(id, {
        vars: rows.filter((r) => r.key.trim()).map((r) => ({ key: r.key.trim(), buildTime: true, ...(r.dirty ? { value: r.value } : {}) })),
      }),
    onSuccess: (r) => {
      qc.setQueryData(["env-vars", id], r);
      setRows(r.vars.map((v) => ({ key: v.key, value: "", dirty: false, shown: false })));
      setRevealed(false);
      toast.show("success", r.message ?? "Salvo.");
    },
    onError: (e) => toast.show("error", e instanceof Error ? e.message : "Falha ao salvar."),
  });

  /** Mostra/esconde o valor de UMA linha. Ao mostrar, busca os valores em texto
   *  uma vez (revealEnvVars) — sem marcar dirty, então salvar não os reenvia. */
  async function toggleShow(i: number) {
    const row = rows[i];
    if (!row) return;
    if (row.shown) { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, shown: false } : r))); return; }
    if (!revealed) {
      try {
        const r = await api.revealEnvVars(id);
        const byKey = new Map(r.vars.map((v) => [v.key, v.value]));
        setRows((rs) => rs.map((rr) => (rr.dirty ? rr : { ...rr, value: byKey.get(rr.key) ?? rr.value })));
        setRevealed(true);
      } catch { toast.show("error", "Não foi possível revelar."); return; }
    }
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, shown: true } : r)));
  }

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch, dirty: true } : r)));
  }
  function addRow() { setRows((rs) => [...rs, { key: "", value: "", dirty: true, shown: true }]); }
  function removeRow(i: number) { setRows((rs) => rs.filter((_, j) => j !== i)); }

  /** Mescla as variáveis do .env colado nas linhas atuais (sobrescreve chaves iguais). */
  function mergeImport(base: Row[], parsed: { key: string; value: string }[]): Row[] {
    const idxByKey = new Map(base.map((r, i) => [r.key, i]));
    const out = [...base];
    for (const p of parsed) {
      const idx = idxByKey.get(p.key);
      const cur = idx !== undefined ? out[idx] : undefined;
      if (idx !== undefined && cur) {
        out[idx] = { ...cur, value: p.value, dirty: true, shown: true };
      } else {
        out.push({ key: p.key, value: p.value, dirty: true, shown: true });
        idxByKey.set(p.key, out.length - 1);
      }
    }
    return out;
  }

  async function doImport() {
    const parsed = parseEnv(importText);
    if (!parsed.length) {
      toast.show("error", "Nenhuma variável encontrada. Linhas comentadas (#) e em branco são ignoradas.");
      return;
    }
    setImporting(true);
    try {
      setRows(mergeImport(rows, parsed));
      setImportOpen(false);
      setImportText("");
      toast.show("success", `${parsed.length} variável(is) importada(s). Revise e clique em Salvar e aplicar.`);
    } finally {
      setImporting(false);
    }
  }

  if (q.isPending) return <div className="flex min-h-40 items-center justify-center"><Loader2 className="animate-spin text-brand-strong" /></div>;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-col gap-4">
          <h2 className="vp-accent-bar flex items-center gap-2 text-base font-semibold text-text">
            <Braces size={18} className="text-brand-strong" /> Variáveis de ambiente
          </h2>
          <p className="text-sm text-text2">
            Variáveis <strong>reais</strong> do processo. Ao salvar, aplicam no container vivo
            (reinicia o app ~1s) e são reaplicadas se o container for recriado. Ficam disponíveis
            no <strong>build</strong> e no runtime, guardadas criptografadas. O valor é
            <strong> exibido</strong> — clique no olho da linha para <strong>esconder</strong>;
            escondido, ele só é visto de dentro do container.
          </p>

          <div className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input className="min-w-[160px] flex-1 font-mono" placeholder="CHAVE" value={r.key} onChange={(e) => update(i, { key: e.target.value })} />
                <Input
                  type={r.shown ? "text" : "password"}
                  className="min-w-[200px] flex-[2] font-mono"
                  placeholder={r.shown ? "valor" : "••••••••"}
                  value={r.value}
                  onChange={(e) => update(i, { value: e.target.value, shown: true })}
                />
                <button
                  type="button"
                  onClick={() => toggleShow(i)}
                  aria-label={r.shown ? "Esconder valor" : "Revelar valor"}
                  title={r.shown ? "Esconder valor" : "Revelar valor"}
                  className="rounded p-1.5 text-text2 hover:bg-bg hover:text-brand-strong"
                >
                  {r.shown ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button type="button" onClick={() => removeRow(i)} aria-label="Remover" className="rounded p-1.5 text-text2 hover:bg-bg hover:text-danger"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={addRow}><Plus size={16} /> Adicionar</Button>
            <Button variant="outline" onClick={() => { setImportText(""); setImportOpen(true); }}><FileUp size={16} /> Importar .env</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {save.isPending ? "Salvando…" : "Salvar e aplicar"}
            </Button>
          </div>
        </div>
      </Card>

      <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg p-3 text-sm text-text2">
        <Info size={16} className="mt-0.5 shrink-0 text-info" />
        <span>Aplicar reinicia o processo do app (conexões em andamento caem por ~1s). Em ambientes antigos, pode ser necessário recriar (trocar versão) para as variáveis valerem.</span>
      </p>

      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importar .env"
        description="Cole o conteúdo do seu arquivo .env. Linhas comentadas (#) e em branco são ignoradas. Chaves que já existem são atualizadas."
      >
        <div className="flex flex-col gap-3">
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={10}
            spellCheck={false}
            placeholder={"APP_NAME=Meu App\nAPP_ENV=production\n# comentário — ignorado\nDB_HOST=127.0.0.1\nDB_PASSWORD=\"senha com espaço\""}
            className="w-full resize-y rounded-lg border border-border bg-bg p-3 font-mono text-sm text-text outline-none focus:border-brand-strong"
          />
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-text3">{parseEnv(importText).length} variável(is) detectada(s)</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancelar</Button>
            <Button onClick={doImport} disabled={importing || parseEnv(importText).length === 0}>
              {importing ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
              {importing ? "Importando…" : "Importar"}
            </Button>
          </div>
          <p className="text-xs text-text3">
            Depois de importar, revise a lista e clique em <strong>Salvar e aplicar</strong> para gravar.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
