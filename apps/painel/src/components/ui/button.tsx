import * as React from "react";
import { cn } from "@/lib/cn";

/*
 * Hierarquia de botões (consistente em toda a UI — ADENDO 9/10):
 *   primary   → roxo preenchido. UM por tela (Criar ambiente, Iniciar, Entrar).
 *   outline   → branco + borda cinza + texto escuro (secundário/neutro:
 *               Pausar, Abrir site, Cancelar). NÃO usar cor "quente" aqui.
 *   danger    → vermelho preenchido, sempre com confirmação (Excluir).
 *   ghost     → só texto roxo, para ações inline.
 * Todos: raio 8px, foco 3px (globals.css :focus-visible), contraste AA.
 */
type Variant = "primary" | "danger" | "outline" | "ghost";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-on-solid hover:bg-brand-hover",
  danger: "bg-danger text-on-solid hover:brightness-90",
  outline:
    "bg-surface text-text border border-border hover:bg-bg hover:border-brand-strong",
  ghost: "bg-transparent text-link hover:bg-brand-soft",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-4 text-sm",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className, type, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg font-semibold",
          "transition-[background-color,filter,border-color] duration-150",
          "disabled:opacity-50 disabled:cursor-not-allowed select-none",
          VARIANTS[variant],
          SIZES[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
