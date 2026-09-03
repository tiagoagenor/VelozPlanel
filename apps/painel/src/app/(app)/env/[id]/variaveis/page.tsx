"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Braces, Plus, Trash2, Eye, EyeOff, Lock, Save, Loader2, Info, FileUp } from "lucide-react";
import * as api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

// hidden = flag persistida (escondida no servidor). available = temos o valor em
// texto no painel (só das não-escondidas, ou que o usuário digitou). valueDirty =
// valor editado (só então reenvia o valor ao salvar).
interface Row { key: string; value: string; hidden: boolean; available: boolean; valueDirty: boolean }

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
  const [importOpen, setImportOpen] = React.useState(false);
  const [importText, setImportText] = React.useState("");
  const [importing, setImporting] = React.useState(false);
  // edições pendentes (não salvas) — trava a saída da página e mostra aviso.
  const [dirty, setDirty] = React.useState(false);
  // diálogo de confirmação quando salvar for APAGAR variáveis já salvas.
  const [confirmRemove, setConfirmRemove] = React.useState<string[] | null>(null);
  // chaves que existem no servidor agora — base para detectar remoção.
  const serverKeys = React.useMemo(() => new Set((q.data?.vars ?? []).map((v) => v.key)), [q.data]);

  // Não-escondidas: valor exibido (auto-revela). Escondidas: o servidor NÃO manda
  // o valor (só se vê no container) → ficam mascaradas e sem "revelar".
  React.useEffect(() => {
    if (!q.data) return;
    setDirty(false); // recarregou do servidor → base limpa (edições anteriores já foram descartadas).
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
        } catch { /* mantém mascarado se falhar */ }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  // Trava a saída (recarregar/fechar/navegar p/ fora) enquanto houver edições
  // não salvas — o que você digitou só vive no navegador até clicar em Salvar.
  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const save = useMutation({
    // envia hidden sempre; value só das linhas EDITADAS (as intocadas vão sem
    // value → o backend mantém o valor atual, nunca zera).
    mutationFn: () =>
      api.setEnvVars(id, {
        vars: rows.filter((r) => r.key.trim()).map((r) => ({ key: r.key.trim(), buildTime: true, hidden: r.hidden, ...(r.valueDirty ? { value: r.value } : {}) })),
      }),
    onSuccess: (r) => {
      setDirty(false);
      qc.setQueryData(["env-vars", id], r); // dispara o efeito → recarrega + auto-revela
      toast.show("success", r.message ?? "Salvo.");
    },
    onError: (e) => toast.show("error", e instanceof Error ? e.message : "Falha ao salvar."),
  });

  /** Olho da linha: esconde/mostra. Só funciona se temos o valor (available);
   *  escondida já salva não tem valor no painel → não dá pra revelar. */
  function toggleHidden(i: number) {
    setDirty(true);
    setRows((rs) => rs.map((r, j) => (j === i && r.available ? { ...r, hidden: !r.hidden } : r)));
  }

  function update(i: number, patch: Partial<Row>) {
    setDirty(true);
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addRow() { setDirty(true); setRows((rs) => [...rs, { key: "", value: "", hidden: false, available: true, valueDirty: true }]); }
  function removeRow(i: number) { setDirty(true); setRows((rs) => rs.filter((_, j) => j !== i)); }

  /** Salvar: se a gravação for APAGAR variáveis já salvas no servidor (removidas da
   *  lista, ou lista esvaziada), confirma antes — evita zerar tudo sem querer. */
  function onSaveClick() {
    const curKeys = new Set(rows.map((r) => r.key.trim()).filter(Boolean));
    const removed = [...serverKeys].filter((k) => !curKeys.has(k));
    if (removed.length > 0) { setConfirmRemove(removed); return; }
    save.mutate();
  }

  /** Mescla as variáveis do .env colado nas linhas atuais (sobrescreve chaves iguais). */
  function mergeImport(base: Row[], parsed: { key: string; value: string }[]): Row[] {
    const idxByKey = new Map(base.map((r, i) => [r.key, i]));
    const out = [...base];
    for (const p of parsed) {
      const idx = idxByKey.get(p.key);
      const cur = idx !== undefined ? out[idx] : undefined;
      if (idx !== undefined && cur) {
        out[idx] = { ...cur, value: p.value, available: true, valueDirty: true };
      } else {
        out.push({ key: p.key, value: p.value, hidden: false, available: true, valueDirty: true });
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
      setDirty(true);
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
            no <strong>build</strong> e no runtime, guardadas criptografadas. Clique no olho para
            <strong> esconder</strong> uma variável: depois de salva, o valor <strong>não é mais
            exibido no painel</strong> (só de dentro do container) e não dá pra revelar de volta.
          </p>

          <div className="flex flex-col gap-2">
            {rows.map((r, i) => {
              const masked = r.hidden || !r.available;
              return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input className="min-w-[160px] flex-1 font-mono" placeholder="CHAVE" value={r.key} onChange={(e) => update(i, { key: e.target.value })} />
                <Input
                  type={masked ? "password" : "text"}
                  className="min-w-[200px] flex-[2] font-mono"
                  placeholder={masked ? "•••••••• (escondida)" : "valor"}
                  value={r.value}
                  onChange={(e) => update(i, { value: e.target.value, valueDirty: true, available: true })}
                />
                {r.available ? (
                  <button
                    type="button"
                    onClick={() => toggleHidden(i)}
                    aria-label={r.hidden ? "Mostrar valor" : "Esconder valor"}
                    title={r.hidden ? "Mostrar valor" : "Esconder valor (some ao salvar)"}
                    className="rounded p-1.5 text-text2 hover:bg-bg hover:text-brand-strong"
                  >
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

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={addRow}><Plus size={16} /> Adicionar</Button>
            <Button variant="outline" onClick={() => { setImportText(""); setImportOpen(true); }}><FileUp size={16} /> Importar .env</Button>
            <Button onClick={onSaveClick} disabled={save.isPending}>
              {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {save.isPending ? "Salvando…" : "Salvar e aplicar"}
            </Button>
            {dirty && !save.isPending && (
              <span className="flex items-center gap-1.5 self-center text-sm text-warning">
                <span className="inline-block size-2 rounded-full bg-warning" /> Alterações não salvas
              </span>
            )}
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

      <Dialog
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        title="Apagar variáveis já salvas?"
        description="Salvar agora vai remover variáveis que já estão gravadas neste ambiente. Esta ação não tem desfazer."
      >
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning/5 p-3 font-mono text-sm text-text">
            {(confirmRemove ?? []).map((k) => (
              <li key={k} className="flex items-center gap-2"><Trash2 size={14} className="shrink-0 text-danger" /> {k}</li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>Cancelar</Button>
            <Button variant="danger" onClick={() => { setConfirmRemove(null); save.mutate(); }}>
              <Trash2 size={16} /> Apagar e salvar
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
