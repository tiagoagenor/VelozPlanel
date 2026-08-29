"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Download,
  Upload,
  Timer,
  Play,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import type { SpeedtestResult } from "@velozplanel/contracts";
import * as api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CenterLoader } from "@/components/Skeletons";
import { formatDateTime } from "@/lib/format";

function fmtMbps(v: number): string {
  return v >= 100 ? Math.round(v).toString() : v.toFixed(1);
}

function Stat({
  icon: Icon,
  label,
  value,
  unit,
  tone = "neutral",
}: {
  icon: typeof Download;
  label: string;
  value: string;
  unit: string;
  tone?: "download" | "upload" | "ping" | "neutral";
}) {
  const color =
    tone === "download"
      ? "text-success"
      : tone === "upload"
        ? "text-accent"
        : tone === "ping"
          ? "text-warning"
          : "text-text";
  return (
    <Card className="flex flex-col gap-1 p-5">
      <div className="flex items-center gap-2 text-sm text-text3">
        <Icon size={16} aria-hidden="true" />
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-4xl font-bold leading-none ${color}`}>{value}</span>
        <span className="text-sm text-text3">{unit}</span>
      </div>
    </Card>
  );
}

export default function AdminSpeedtestPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["admin", "speedtests"],
    queryFn: () => api.listSpeedtests(50),
    refetchInterval: 60_000,
  });

  const run = useMutation({
    mutationFn: api.runSpeedtest,
    onSuccess: (r) => {
      if (r.ok) {
        toast.show("success", 
          `Teste concluído: ↓ ${fmtMbps(r.downloadMbps)} / ↑ ${fmtMbps(r.uploadMbps)} Mbps`,
        );
      } else {
        toast.show("error", `Teste falhou: ${r.error ?? "erro desconhecido"}`);
      }
      void qc.invalidateQueries({ queryKey: ["admin", "speedtests"] });
    },
    onError: (e: unknown) => {
      toast.show("error", e instanceof Error ? e.message : "Não foi possível rodar o teste.");
    },
  });

  const rows = q.data ?? [];
  const latest = rows[0];

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-text">
            Velocidade de internet
          </h1>
          <p className="mt-1 text-sm text-text3">
            Teste de download/upload do servidor local, medido automaticamente de hora em hora.
          </p>
        </div>
        <Button onClick={() => run.mutate()} disabled={run.isPending}>
          <Play size={16} aria-hidden="true" />
          {run.isPending ? "Testando…" : "Testar agora"}
        </Button>
      </header>

      {q.isLoading ? (
        <CenterLoader />
      ) : (
        <>
          {/* Resultado mais recente */}
          <section aria-label="Resultado mais recente" className="mb-8">
            {latest ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-text3">
                  <span>
                    Último teste — <strong className="text-text">{latest.nodeName}</strong>
                  </span>
                  <span>{formatDateTime(latest.createdAt)}</span>
                  {latest.ok ? (
                    <Badge tone="success">
                      <CheckCircle2 size={13} aria-hidden="true" /> OK
                    </Badge>
                  ) : (
                    <Badge tone="warning">
                      <AlertTriangle size={13} aria-hidden="true" /> Falhou
                    </Badge>
                  )}
                  <Badge tone="neutral">
                    {latest.source === "manual" ? "Manual" : "Automático"}
                  </Badge>
                </div>
                {latest.ok ? (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Stat
                      icon={Download}
                      label="Download"
                      value={fmtMbps(latest.downloadMbps)}
                      unit="Mbps"
                      tone="download"
                    />
                    <Stat
                      icon={Upload}
                      label="Upload"
                      value={fmtMbps(latest.uploadMbps)}
                      unit="Mbps"
                      tone="upload"
                    />
                    <Stat
                      icon={Timer}
                      label="Latência (ping)"
                      value={latest.pingMs != null ? Math.round(latest.pingMs).toString() : "—"}
                      unit="ms"
                      tone="ping"
                    />
                  </div>
                ) : (
                  <Card className="flex items-center gap-2 p-5 text-sm text-text3">
                    <AlertTriangle size={16} className="text-warning" aria-hidden="true" />
                    {latest.error ?? "O teste falhou."}
                  </Card>
                )}
              </>
            ) : (
              <Card className="flex flex-col items-center gap-2 p-10 text-center text-text3">
                <Activity size={28} aria-hidden="true" />
                <p>Nenhum teste ainda. Ele roda sozinho de hora em hora, ou clique em “Testar agora”.</p>
              </Card>
            )}
          </section>

          {/* Histórico */}
          <section aria-label="Histórico">
            <h2 className="mb-3 text-lg font-semibold text-text">Histórico</h2>
            {rows.length === 0 ? (
              <p className="text-sm text-text3">Sem histórico.</p>
            ) : (
              <Card className="overflow-hidden p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border-subtle text-left text-text3">
                        <th className="px-4 py-3 font-medium">Quando</th>
                        <th className="px-4 py-3 font-medium">Servidor</th>
                        <th className="px-4 py-3 text-right font-medium">Download</th>
                        <th className="px-4 py-3 text-right font-medium">Upload</th>
                        <th className="px-4 py-3 text-right font-medium">Ping</th>
                        <th className="px-4 py-3 font-medium">Origem</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r: SpeedtestResult) => (
                        <tr key={r.id} className="border-b border-border-subtle/60 last:border-0">
                          <td className="whitespace-nowrap px-4 py-3">
                            {formatDateTime(r.createdAt)}
                          </td>
                          <td className="px-4 py-3">{r.nodeName}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                            {r.ok ? `${fmtMbps(r.downloadMbps)} Mbps` : "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                            {r.ok ? `${fmtMbps(r.uploadMbps)} Mbps` : "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                            {r.ok && r.pingMs != null ? `${Math.round(r.pingMs)} ms` : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {r.source === "manual" ? "Manual" : "Automático"}
                          </td>
                          <td className="px-4 py-3">
                            {r.ok ? (
                              <Badge tone="success">OK</Badge>
                            ) : (
                              <Badge tone="warning" title={r.error ?? undefined}>
                                Falhou
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </section>
        </>
      )}
    </>
  );
}
