"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { ScrollText, Play, Pause, Trash2, RotateCw, AlertTriangle, Loader2 } from "lucide-react";
import * as api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const TAIL_OPTIONS = [100, 500, 1000] as const;
const MAX_LINES = 5000; // teto de memória do visualizador

type Status = "connecting" | "live" | "ended" | "error" | "empty";

export default function EnvLogsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [lines, setLines] = React.useState<string[]>([]);
  const [tail, setTail] = React.useState<number>(200);
  const [status, setStatus] = React.useState<Status>("connecting");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [autoScroll, setAutoScroll] = React.useState(true);

  const abortRef = React.useRef<AbortController | null>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);

  const append = React.useCallback((newLines: string[]) => {
    setLines((prev) => {
      const next = prev.concat(newLines);
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  const start = React.useCallback(
    async (tailN: number) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLines([]);
      setErrorMsg(null);
      setStatus("connecting");
      let res: Response;
      try {
        res = await fetch(api.envLogsStreamUrl(id, tailN), {
          credentials: "include",
          cache: "no-store",
          signal: ac.signal,
        });
      } catch {
        if (!ac.signal.aborted) { setStatus("error"); setErrorMsg("Não foi possível conectar ao stream de logs."); }
        return;
      }
      if (!res.ok || !res.body) {
        let msg = `Falha ao abrir os logs (HTTP ${res.status}).`;
        if (res.status === 409) msg = "O ambiente ainda não tem um container. Inicie-o para ver os logs.";
        setStatus("error");
        setErrorMsg(msg);
        return;
      }
      setStatus("live");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const events = buf.split("\n\n");
          buf = events.pop() ?? "";
          const batch: string[] = [];
          for (const evt of events) {
            for (const raw of evt.split("\n")) {
              if (raw.startsWith("data: ")) batch.push(raw.slice(6));
            }
          }
          if (batch.length) append(batch);
        }
        if (!ac.signal.aborted) setStatus("ended");
      } catch {
        if (!ac.signal.aborted) { setStatus("error"); setErrorMsg("A conexão de logs caiu."); }
      }
    },
    [id, append],
  );

  // Conecta ao montar e sempre que a quantidade de linhas (tail) muda.
  React.useEffect(() => {
    void start(tail);
    return () => abortRef.current?.abort();
  }, [start, tail]);

  // Auto-scroll pro fim quando chegam linhas novas (se habilitado).
  React.useEffect(() => {
    if (autoScroll && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [lines, autoScroll]);

  const live = status === "live";
  const paused = status === "ended" && abortRef.current?.signal.aborted;

  function onScroll() {
    const el = boxRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ScrollText size={20} aria-hidden="true" className="text-text3" />
          <h2 className="text-lg font-semibold text-text">Logs do ambiente</h2>
          <StatusPill status={status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-text2">
            Linhas
            <select
              value={tail}
              onChange={(e) => setTail(Number(e.target.value))}
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none focus:border-brand-strong"
            >
              {TAIL_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          {status === "live" ? (
            <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
              <Pause size={15} aria-hidden="true" /> Pausar
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void start(tail)}>
              <Play size={15} aria-hidden="true" /> {status === "ended" ? "Retomar" : "Reconectar"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void start(tail)} aria-label="Recarregar">
            <RotateCw size={15} aria-hidden="true" /> Recarregar
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setLines([])} disabled={lines.length === 0}>
            <Trash2 size={15} aria-hidden="true" /> Limpar
          </Button>
        </div>
      </div>

      {errorMsg ? (
        <p role="alert" className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
          <AlertTriangle size={16} aria-hidden="true" /> {errorMsg}
        </p>
      ) : null}

      <Card className="p-0">
        <div
          ref={boxRef}
          onScroll={onScroll}
          className="h-[60vh] overflow-auto rounded-xl bg-[#0d1117] p-4 font-mono text-[12.5px] leading-relaxed text-[#d1d5db]"
        >
          {status === "connecting" && lines.length === 0 ? (
            <p className="flex items-center gap-2 text-[#9ca3af]">
              <Loader2 size={14} aria-hidden="true" className="animate-spin" /> Conectando aos logs…
            </p>
          ) : lines.length === 0 ? (
            <p className="text-[#9ca3af]">Sem logs para exibir.</p>
          ) : (
            lines.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {l || " "}
              </div>
            ))
          )}
        </div>
      </Card>

      <p className="text-xs text-text3">
        {live
          ? "Transmitindo ao vivo — novas linhas aparecem automaticamente. Saia da página ou clique em Pausar para parar."
          : status === "ended"
            ? "Stream encerrado (container parado ou pausado). Mostra os logs até aqui."
            : "As últimas linhas de stdout/stderr do container."}
        {" "}O rolar manual para cima pausa o acompanhamento automático.
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const meta: Record<Status, { label: string; cls: string }> = {
    connecting: { label: "conectando", cls: "bg-bg text-text3" },
    live: { label: "ao vivo", cls: "bg-success/15 text-success" },
    ended: { label: "encerrado", cls: "bg-bg text-text3" },
    error: { label: "erro", cls: "bg-danger/15 text-danger" },
    empty: { label: "vazio", cls: "bg-bg text-text3" },
  };
  const m = meta[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", m.cls)}>
      {status === "live" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> : null}
      {m.label}
    </span>
  );
}
