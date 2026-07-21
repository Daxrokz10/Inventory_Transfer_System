import { cn } from "@/lib/cn";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "good"
  | "warn"
  | "danger";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-ink-2 border border-line",
  accent: "bg-accent-soft text-accent-strong",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
