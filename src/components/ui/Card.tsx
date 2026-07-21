import { cn } from "@/lib/cn";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface p-5 shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

/* Uppercase micro-label used above stats and card sections — the industrial
   "stencil" detail that ties both modules together. */
export function CardLabel({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3",
        className,
      )}
      {...props}
    />
  );
}
