import * as React from "react";
import { cn } from "@/lib/cn";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
}

/**
 * Select nativo (o mais acessível: teclado, leitor de tela e toque de graça).
 * A seta é desenhada por CSS; o texto continua sendo texto real.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ options, className, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "h-11 w-full appearance-none rounded-lg border border-border bg-surface",
            "px-3 pr-9 text-sm text-text",
            className,
          )}
          {...props}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text2"
        >
          ▾
        </span>
      </div>
    );
  },
);
Select.displayName = "Select";
