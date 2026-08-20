import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "success" | "danger" | "warning" | "neutral" | "ghost" | "outline";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-on-solid hover:bg-brand-hover",
  success: "bg-success text-on-solid hover:brightness-90",
  danger: "bg-danger text-on-solid hover:brightness-90",
  warning: "bg-warning text-on-solid hover:brightness-90",
  neutral: "bg-neutral text-on-solid hover:brightness-90",
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
