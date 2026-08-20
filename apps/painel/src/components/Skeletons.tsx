import { Loader2 } from "lucide-react";

/**
 * Esqueletos de carregamento reutilizados pelos loading.tsx dos segmentos de
 * rota. Mostram um "molde" instantâneo no formato do conteúdo — assim a troca
 * de rota exibe um esqueleto na hora em vez de congelar na tela anterior.
 */

function Block({ className = "" }: { className?: string }) {
  return (
    <div
      className={`vp-card-shadow animate-pulse rounded-xl border border-border-subtle bg-surface ${className}`}
    />
  );
}

function Line({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-border-subtle ${className}`} />;
}

/** Esqueleto de página de conteúdo (título + strip de KPIs + grade de cards). */
export function PageSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-6">
        <Line className="h-7 w-48" />
        <Line className="mt-2 h-4 w-72" />
      </div>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Block className="h-20" />
        <Block className="h-20" />
        <Block className="h-20" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Block className="h-40" />
        <Block className="h-40" />
        <Block className="h-40" />
      </div>
    </div>
  );
}

/** Esqueleto de uma seção do ambiente (cabeçalho pequeno + cards empilhados). */
export function EnvSectionSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6">
      <div>
        <Line className="h-6 w-52" />
        <Line className="mt-2 h-4 w-80 max-w-full" />
      </div>
      <Block className="h-24" />
      <Block className="h-24" />
      <Block className="h-48" />
    </div>
  );
}

/**
 * Spinner grande centralizado (horizontal E vertical) na área de conteúdo —
 * usado nos loading.tsx para dar um retorno claro "no meio da tela" enquanto
 * a rota carrega. loader-2 girando em roxo + texto curto.
 */
export function CenterLoader({
  label = "Carregando…",
  minHeight = "60vh",
}: {
  label?: string;
  minHeight?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex w-full flex-col items-center justify-center gap-3"
      style={{ minHeight }}
    >
      <Loader2
        size={40}
        aria-hidden="true"
        className="animate-spin text-brand-strong"
      />
      <span className="text-sm font-medium text-text2">{label}</span>
    </div>
  );
}
