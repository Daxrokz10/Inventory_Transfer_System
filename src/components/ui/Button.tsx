import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-strong disabled:opacity-60 disabled:hover:bg-accent",
  secondary:
    "border border-line-strong bg-surface text-ink hover:bg-surface-2 disabled:opacity-60",
  danger:
    "bg-danger text-white hover:opacity-90 disabled:opacity-60",
  ghost:
    "text-accent hover:bg-accent-soft disabled:opacity-60",
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
