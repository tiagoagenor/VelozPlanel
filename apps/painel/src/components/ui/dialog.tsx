"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Modal acessível sobre o elemento nativo <dialog>:
 * - showModal() dá foco-trap, Esc e backdrop de graça;
 * - role/aria-modal já vêm do próprio elemento.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: DialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const descId = React.useId();

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  // Fecha ao clicar no backdrop (fora do conteúdo).
  const onClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === ref.current) onClose();
  };

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={onClose}
      onClick={onClick}
      className={cn(
        "m-auto w-[min(92vw,32rem)] rounded-lg border border-border-subtle bg-elevated p-6 text-text",
        "backdrop:bg-black/50",
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-lg font-semibold text-text">
            {title}
          </h2>
          {description ? (
            <p id={descId} className="text-sm text-text2">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="rounded-md px-2 py-1 text-text2 hover:bg-surface"
        >
          ✕
        </button>
      </div>
      {children}
    </dialog>
  );
}
