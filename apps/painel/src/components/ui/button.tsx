import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "success" | "danger" | "warning" | "neutral" | "ghost" | "outline";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-on-solid hover:opacity-90",
  success: "bg-success text-on-solid hover:opacity-90",
  danger: "bg-danger text-on-solid hover:opacity-90",
  warning: "bg-warning text-on-solid hover:opacity-90",
  neutral: "bg-neutral text-on-solid hover:opacity-90",
  outline:
    "bg-transparent text-text border border-border hover:bg-surface",
  ghost: "bg-transparent text-link hover:bg-surface",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
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
          "inline-flex items-center justify-center gap-2 rounded-md font-medium",
          "transition-opacity disabled:opacity-50 disabled:cursor-not-allowed",
          "select-none",
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
