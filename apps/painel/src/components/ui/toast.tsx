"use client";

import * as React from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastKind = "success" | "error";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastCtx {
  show: (kind: ToastKind, message: string) => void;
}

const Ctx = React.createContext<ToastCtx | null>(null);

/** Toast simples e próprio (sem lib): pilha no canto, auto-dispensa em 4s. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const idRef = React.useRef(0);

  const remove = React.useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = React.useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++idRef.current;
      setToasts((list) => [...list, { id, kind, message }]);
      window.setTimeout(() => remove(id), 4000);
    },
    [remove],
  );

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,22rem)] flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const Icon = t.kind === "success" ? CheckCircle2 : AlertTriangle;
          return (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              className={cn(
                "vp-pop-shadow pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3",
                t.kind === "success"
                  ? "vp-pill vp-pill-success"
                  : "vp-pill vp-pill-danger",
              )}
            >
              <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
              <p className="flex-1 text-sm font-medium leading-snug">{t.message}</p>
              <button
                type="button"
                onClick={() => remove(t.id)}
                aria-label="Fechar aviso"
                className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useToast precisa de <ToastProvider>.");
  return ctx;
}
