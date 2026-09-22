import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

/* Small pieces the status board is built from. Kept apart so the page itself
   reads as the shape of the board rather than a wall of markup. */

/** One headline number. */
export function Stat({
  label,
  value,
  hint,
  tone = "plain",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "plain" | "good" | "warn" | "danger";
}) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs uppercase tracking-[0.08em] text-ink-3">{label}</p>
      <p
        className={cn(
          "mt-1 text-3xl font-semibold tabular-nums tracking-tight",
          tone === "plain" && "text-ink",
          tone === "good" && "text-good",
          tone === "warn" && "text-warn",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-2">{hint}</p>}
    </Card>
  );
}

/** How much of an opening is filled: joined, then offers accepted, then what
    is still to hire. */
export function HiringBar({ needed, joined, accepted }: { needed: number; joined: number; accepted: number }) {
  const total = Math.max(1, needed);
  const pct = (n: number) => `${Math.min(100, (n / total) * 100)}%`;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <div className="bg-good" style={{ width: pct(joined) }} />
      <div className="bg-accent" style={{ width: pct(Math.min(accepted, Math.max(0, needed - joined))) }} />
    </div>
  );
}

/** "Needed by 20 Sept" with how that is going. */
export function DueChip({ requiredBy, done }: { requiredBy: string | null; done: boolean }) {
  if (!requiredBy) return null;
  const day = new Date(`${requiredBy.slice(0, 10)}T00:00:00`);
  const label = day.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  if (done) return <span className="text-xs text-ink-2">needed by {label}</span>;

  const days = Math.round((day.getTime() - Date.now()) / 86_400_000);
  const tone =
    days < 0 ? "bg-danger-soft text-danger" : days <= 7 ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-2";
  const text =
    days < 0
      ? `${-days} day${days === -1 ? "" : "s"} overdue`
      : days === 0
        ? "needed today"
        : `${days} day${days === 1 ? "" : "s"} left`;
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tone)}>
      {text} <span className="font-normal opacity-80">· by {label}</span>
    </span>
  );
}

export type FunnelStep = { name: string; reached: number; here: number; rejected: number; final?: boolean };

/** The pipeline for one opening, left to right: how many candidates got as far
    as each stage. Counts are cumulative — someone in the management round has
    been through the telephonic and technical ones — so the numbers only fall,
    and the place they fall off is where the hiring is stuck. Each step also
    says how many are sitting there now and how many were rejected there, which
    is what the fall between two steps is made of. */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  return (
    <ol className="flex items-stretch gap-1 overflow-x-auto pb-1">
      {steps.map((s, i) => (
        <li key={s.name} className="flex min-w-0 items-stretch gap-1">
          {i > 0 && <span className="self-center px-0.5 text-ink-3" aria-hidden>›</span>}
          <div
            className={cn(
              "min-w-[6.5rem] rounded-lg border px-3 py-2",
              s.reached === 0 && "border-line bg-transparent",
              s.reached > 0 && !s.final && "border-line bg-surface-2",
              s.reached > 0 && s.final && "border-good/40 bg-good-soft/50",
            )}
          >
            <p className={cn("text-[11px] leading-tight", s.reached ? "text-ink-2" : "text-ink-3")}>{s.name}</p>
            <p
              className={cn(
                "text-xl font-semibold tabular-nums leading-tight",
                s.reached === 0 ? "text-ink-3" : s.final ? "text-good" : "text-ink",
              )}
            >
              {s.reached}
            </p>
            <p className="text-[10px] leading-tight text-ink-3">{s.here > 0 ? `${s.here} here now` : " "}</p>
            <p className={cn("text-[10px] leading-tight", s.rejected > 0 ? "text-danger" : "text-transparent")}>
              {s.rejected > 0 ? `${s.rejected} rejected here` : " "}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
