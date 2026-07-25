import { cn } from "@/lib/cn";

/* The five-state table system. A field is one of:
     • logged / running  → a plain mono value + a StatusPill
     • caution / alarm    → StatusPill (amber ⚠ / red ▲) + row edge-stripe
     • pending            → <Pending/>  — an open cyan slot, applies but empty now
     • not metered (N/A)  → <NotMetered/> — hatched, inert, excluded by design
   Colour + shape + label together, so meaning never rests on hue alone. */

export type SignalTone = "ok" | "caution" | "alarm" | "pending" | "off";

/** A single instrument lamp. Always sits beside a label, never alone. */
export function Led({ tone }: { tone: SignalTone }) {
  return <span className="led-dot" data-tone={tone} aria-hidden />;
}

/** Field that structurally has no value — no engine, not a metered asset.
    Rendered inert and hatched so the eye skips past it. */
export function NotMetered({
  label = "not metered",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "cell-na inline-block px-2 py-0.5 text-center font-mono text-[11px] tracking-wide",
        className,
      )}
      title="This machine doesn't have this metric — excluded by design."
    >
      {label}
    </span>
  );
}

/** Field that applies but hasn't been entered yet — an open slot inviting
    a log. Cool, dashed, distinct from both a value and an N/A. */
export function Pending({
  label = "awaiting",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "cell-pending inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[11px]",
        className,
      )}
      title="Applies to this machine, but not logged yet."
    >
      <Led tone="pending" />
      {label}
    </span>
  );
}

const PILL: Record<
  SignalTone,
  { cls: string; glyph?: string }
> = {
  ok: { cls: "bg-good-soft text-good border-good/35" },
  caution: { cls: "bg-warn-soft text-warn border-warn/40", glyph: "⚠" },
  alarm: { cls: "bg-danger-soft text-danger border-danger/45", glyph: "▲" },
  pending: { cls: "bg-pending-soft text-pending border-pending/40" },
  off: { cls: "bg-surface-2 text-ink-3 border-line" },
};

/** A status lamp + label as a pill. `glyph` (⚠ / ▲) doubles the signal so
    colour-blind operators aren't reading hue alone. */
export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: SignalTone;
  children: React.ReactNode;
  className?: string;
}) {
  const { cls, glyph } = PILL[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        cls,
        className,
      )}
    >
      {glyph ? (
        <span className="font-mono text-[11px] leading-none" aria-hidden>
          {glyph}
        </span>
      ) : (
        <Led tone={tone} />
      )}
      {children}
    </span>
  );
}
