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

interface Row { key: string; value: string; buildTime: boolean; dirty: boolean }

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
  const [revealed, setRevealed] = React.useState(false);
  const [hidden, setHidden] = React.useState(false); // valores visíveis por padrão; olhinho esconde
  const [importOpen, setImportOpen] = React.useState(false);
  const [importText, setImportText] = React.useState("");
  const [importing, setImporting] = React.useState(false);

  // Ao carregar, revela os valores automaticamente (exibidos sempre).
  React.useEffect(() => {
    if (q.data) {
      setRows(q.data.vars.map((v) => ({ key: v.key, value: "", buildTime: true, dirty: false })));
      if (q.data.vars.length > 0 && !revealed) reveal.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const reveal = useMutation({
    mutationFn: () => api.revealEnvVars(id),
    onSuccess: (r) => {
      setRows(r.vars.map((v) => ({ key: v.key, value: v.value, buildTime: true, dirty: false })));
      setRevealed(true);
    },
    onError: () => toast.show("error", "Não foi possível revelar."),
  });

  const save = useMutation({
    mutationFn: () =>
      api.setEnvVars(id, { vars: rows.filter((r) => r.key.trim()).map((r) => ({ key: r.key.trim(), value: r.value, buildTime: true })) }),
    onSuccess: (r) => {
      qc.setQueryData(["env-vars", id], r);
      toast.show("success", r.message ?? "Salvo.");
    },
    onError: (e) => toast.show("error", e instanceof Error ? e.message : "Falha ao salvar."),
  });

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch, dirty: true } : r)));
  }
  function addRow() { setRows((rs) => [...rs, { key: "", value: "", buildTime: true, dirty: true }]); }
  function removeRow(i: number) { setRows((rs) => rs.filter((_, j) => j !== i)); }

  /** Mescla as variáveis do .env colado nas linhas atuais (sobrescreve chaves iguais). */
  function mergeImport(base: Row[], parsed: { key: string; value: string }[]): Row[] {
    const idxByKey = new Map(base.map((r, i) => [r.key, i]));
    const out = [...base];
    for (const p of parsed) {
      const idx = idxByKey.get(p.key);
      const cur = idx !== undefined ? out[idx] : undefined;
      if (idx !== undefined && cur) {
        out[idx] = { ...cur, value: p.value, buildTime: true, dirty: true };
      } else {
        out.push({ key: p.key, value: p.value, buildTime: true, dirty: true });
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
      // Se há segredos ainda mascarados, revela primeiro para não salvá-los vazios ao mesclar.
      let base = rows;
      if (hasSecrets && !revealed) {
        const r = await api.revealEnvVars(id);
        base = r.vars.map((v) => ({ key: v.key, value: v.value, buildTime: true, dirty: false }));
        setRevealed(true);
      }
      setRows(mergeImport(base, parsed));
      setImportOpen(false);
      setImportText("");
      toast.show("success", `${parsed.length} variável(is) importada(s). Revise e clique em Salvar e aplicar.`);
    } catch {
      toast.show("error", "Não foi possível revelar os valores atuais para mesclar com segurança.");
    } finally {
      setImporting(false);
    }
  }

  if (q.isPending) return <div className="flex min-h-40 items-center justify-center"><Loader2 className="animate-spin text-brand-strong" /></div>;

  const hasSecrets = (q.data?.vars.length ?? 0) > 0;

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
            no <strong>build</strong> e no runtime. Guardadas criptografadas.
          </p>

          <div className="flex flex-col gap-2">
            {rows.length > 0 ? (
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setHidden((h) => !h)}
                  aria-pressed={hidden}
                  className="inline-flex items-center gap-1.5 text-xs text-text2 hover:text-text"
                  title={hidden ? "Mostrar valores" : "Esconder valores"}
                >
                  {hidden ? <Eye size={15} /> : <EyeOff size={15} />}
                  {hidden ? "Mostrar valores" : "Esconder valores"}
                </button>
              </div>
            ) : null}
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input className="min-w-[160px] flex-1 font-mono" placeholder="CHAVE" value={r.key} onChange={(e) => update(i, { key: e.target.value })} />
                <Input type={hidden ? "password" : "text"} className="min-w-[200px] flex-[2] font-mono" placeholder="valor" value={r.value} onChange={(e) => update(i, { value: e.target.value })} />
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
