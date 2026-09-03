"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UPLOAD_MAX_MB_CEILING } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/** Tamanho máximo de upload no gerenciador de arquivos (super admin). Em MB. */
function UploadSettingsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["upload-settings"], queryFn: api.getUploadSettings });

  const [mb, setMb] = React.useState<string>("");
  React.useEffect(() => {
    if (q.data) setMb(String(q.data.maxUploadMb));
  }, [q.data]);

  const current = q.data ? q.data.maxUploadMb : null;
  const parsed = Number(mb);
  const valid =
    mb.trim() !== "" &&
    Number.isFinite(parsed) &&
    Number.isInteger(parsed) &&
    parsed >= 1 &&
    parsed <= UPLOAD_MAX_MB_CEILING;
  const dirty = valid && current !== null && parsed !== current;

  const save = useMutation({
    mutationFn: () => api.setUploadSettings(parsed),
    onSuccess: (r) => {
      qc.setQueryData(["upload-settings"], r);
      toast.show("success", `Máximo de upload definido para ${r.maxUploadMb} MB.`);
    },
    onError: (e) => toast.show("error", e instanceof Error ? e.message : "Falha ao salvar."),
  });

  return (
    <Card className="mb-6 flex flex-col gap-3">
      <div>
        <h2 className="vp-accent-bar text-base font-semibold text-text">Upload de arquivos</h2>
        <p className="mt-0.5 text-sm text-text2">
          Tamanho máximo de cada arquivo enviado pelo gerenciador de arquivos, válido para
          <strong> todos os ambientes</strong>. A mudança vale <strong>na hora</strong>, sem
          reiniciar nada. O teto permitido é {UPLOAD_MAX_MB_CEILING} MB (2 GB).
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="upload-max">Tamanho máximo (MB)</Label>
          <Input
            id="upload-max"
            type="number"
            min={1}
            max={UPLOAD_MAX_MB_CEILING}
            step={1}
            inputMode="numeric"
            className="w-40"
            value={mb}
            disabled={q.isPending || save.isPending}
            onChange={(e) => setMb(e.target.value)}
          />
        </div>
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          {save.isPending ? "Salvando…" : "Salvar"}
        </Button>
        <span className="pb-2 text-sm text-text3">
          {current === null ? "" : `Atual: ${current} MB.`}
        </span>
      </div>
    </Card>
  );
}

export default function AdminConfiguracoesPage() {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight text-text">
          Configurações
        </h1>
        <p className="mt-1 text-sm text-text2">
          Ajustes gerais do painel que valem para toda a plataforma.
        </p>
      </header>

      <UploadSettingsCard />
    </>
  );
}
