"use client";

/*
 * Modal "Arquivo de início / comando de start" — adaptativo por runtime.
 * Reaproveita setNodeStartFile / setPythonCmd / setDotnetCmd. Nenhuma API nova.
 *   - node / python genérico → env.nodeStartFile (reinicia na hora)
 *   - django                → env.pythonCmd (vale no próximo deploy)
 *   - dotnet                → env.dotnetCmd (vale no próximo deploy)
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Check } from "lucide-react";
import type { DeployFramework, Environment, RuntimeKind } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

type Mode = "nodefile" | "pycmd" | "dotnetcmd";
function modeFor(runtime: RuntimeKind, fw: DeployFramework): Mode {
  if (runtime === "python") return fw === "django" ? "pycmd" : "nodefile";
  if (runtime === "dotnet") return "dotnetcmd";
  return "nodefile"; // node
}

export function StartFileModal({
  id, open, onClose, env, framework,
}: { id: string; open: boolean; onClose: () => void; env: Environment; framework: DeployFramework }) {
  const qc = useQueryClient();
  const toast = useToast();
  const runtime = env.runtime.kind;
  const mode = modeFor(runtime, framework);
  const onSaved = (u: Environment) => { qc.setQueryData(["environment", id], u); };

  // .NET: comando efetivo atual (para exibir de baseline)
  const effQ = useQuery({ queryKey: ["dotnet-eff", id], queryFn: () => api.getDotnetEffectiveCmd(id), enabled: open && mode === "dotnetcmd" });

  const initial = mode === "nodefile" ? (env.nodeStartFile ?? "")
    : mode === "pycmd" ? (env.pythonCmd ?? "")
      : (env.dotnetCmd ?? effQ.data?.cmd ?? "");
  const [val, setVal] = React.useState(initial);
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => { if (open) { setVal(initial); setTouched(false); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, env.nodeStartFile, env.pythonCmd, env.dotnetCmd, effQ.data?.cmd]);

  const save = useMutation({
    mutationFn: () => {
      const v = val.trim() === "" ? null : val.trim();
      if (mode === "nodefile") return api.setNodeStartFile(id, v);
      if (mode === "pycmd") return api.setPythonCmd(id, v, false);
      return api.setDotnetCmd(id, v, false);
    },
    onSuccess: (u) => {
      onSaved(u);
      toast.show("success", mode === "nodefile" ? "Arquivo de início salvo — app reiniciado." : "Comando salvo — vale no próximo deploy.");
      onClose();
    },
    onError: (e) => toast.show("error", e instanceof ApiError && e.message ? e.message : "Falha ao salvar."),
  });

  const placeholder = mode === "nodefile" ? (runtime === "python" ? "app.py" : "index.js")
    : mode === "pycmd" ? "python manage.py runserver 0.0.0.0:80 --insecure --noreload"
      : "dotnet app.dll";
  const title = mode === "nodefile" ? "Arquivo de início" : "Comando de start";

  return (
    <Dialog open={open} onClose={onClose} title={title}
      description={mode === "nodefile"
        ? "O arquivo que sobe o servidor. Salvar reinicia o app na hora."
        : "O comando que sobe o servidor na porta 80. Vale a partir do próximo deploy."}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startfile">{title}</Label>
          <Input id="startfile" className="font-mono" value={val} placeholder={placeholder}
            onChange={(e) => { setTouched(true); setVal(e.target.value); }} />
          <p className="text-xs text-text3">
            {mode === "nodefile"
              ? <>Deixe vazio para o padrão <code>{placeholder}</code>. Seu app precisa escutar na porta 80 (host <code>0.0.0.0</code>).</>
              : mode === "pycmd"
                ? <>Deixe vazio para o padrão <code>python3 &lt;arquivo&gt;</code>.</>
                : <>Deixe vazio para o modo automático (a DLL da publicação).</>}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || (!touched && mode !== "nodefile")}>
            {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Salvar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
