import Link from "next/link";
import { cn } from "@/lib/cn";
import { RECOMMENDATION_LABEL, fmtDateTime } from "@/lib/hr/format";

/* The candidate's journey in one column: when the position was asked for,
   when the candidate was registered, every status change, and each interview
   round with whether its feedback is in. Pending steps are shown hollow. */

export type TimelineEvent = {
  at: string | null; // ISO
  label: string; // "dd Mon yyyy" style, or "not set"
  title: string;
  /** Who it involved and how it went — shown on the chip, not just the tooltip. */
  who?: string | null;
  detail?: string | null;
  state: "done" | "pending" | "stopped";
  href?: string;
};

function Dot({ state }: { state: TimelineEvent["state"] }) {
  return (
    <span
      className={cn(
        "mt-1 h-3 w-3 shrink-0 rounded-full border-2",
        state === "done" && "border-accent bg-accent",
        state === "pending" && "border-warn bg-transparent",
        state === "stopped" && "border-danger bg-danger",
      )}
      aria-hidden
    />
  );
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-ink-2">Nothing recorded yet.</p>;
  return (
    <ol className="relative space-y-4 border-l border-line pl-0">
      {events.map((e, i) => (
        <li key={i} className="relative flex gap-3 pl-4">
          <span className="absolute -left-[7px] top-0">
            <Dot state={e.state} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">
              {e.href ? (
                <Link href={e.href} className="text-accent hover:underline">
                  {e.title}
                </Link>
              ) : (
                e.title
              )}
              {e.who && <span className="ml-2 text-xs font-normal text-ink-2">{e.who}</span>}
              {e.state === "pending" && <span className="ml-2 text-xs font-normal text-warn">pending</span>}
            </p>
            {e.detail && <p className="text-xs text-ink-2">{e.detail}</p>}
            <p className="text-[11px] text-ink-3">{e.label}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** One-line version of the same events, for lists of candidates. */
export function TimelineStrip({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
      {events.map((e, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-ink-3">→</span>}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
              e.state === "done" && "border-line bg-surface-2 text-ink-2",
              e.state === "pending" && "border-warn/50 bg-warn-soft text-warn",
              e.state === "stopped" && "border-danger/50 bg-danger-soft text-danger",
            )}
            title={e.detail ?? undefined}
          >
            {e.title}
            {e.who && <span className="font-medium opacity-90">{e.who}</span>}
            <span className="text-[10px] opacity-70">{e.label}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

const dateOnly = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

export function buildTimeline(input: {
  candidate: { entry_date: string | null; created_at: string; status: string | null; name: string };
  opening: { id: string; code: string; designation: string; headcount: number; created_at: string; raiser: string | null } | null;
  history: { from_status: string | null; to_status: string | null; source: string; changed_at: string; changed_by: string | null }[];
  panels: {
    panel_id: string;
    round: number;
    scheduled_at: string | null;
    mode: string | null;
    created_at: string;
    members: { name: string; state: string; recommendation: string | null; rating: number | null; completed_at: string | null }[];
  }[];
  nameOf: Map<string, string>;
}): TimelineEvent[] {
  const { candidate, opening, history, panels, nameOf } = input;
  const events: TimelineEvent[] = [];

  if (opening) {
    events.push({
      at: opening.created_at,
      label: dateOnly(opening.created_at),
      title: `Requirement raised · ${opening.code}`,
      detail: `${opening.designation} × ${opening.headcount}${opening.raiser ? ` · by ${opening.raiser}` : ""}`,
      state: "done",
      href: `/hr/openings/${opening.id}`,
    });
  }

  events.push({
    at: candidate.created_at,
    // The Excel's own Date column is what HR recognises; fall back to when the
    // row first reached the app.
    label: candidate.entry_date ?? dateOnly(candidate.created_at),
    title: "Candidate registered",
    detail: candidate.entry_date ? null : "date not in the sheet",
    state: "done",
  });

  for (const h of history) {
    events.push({
      at: h.changed_at,
      label: dateOnly(h.changed_at),
      title: h.to_status ?? "Status cleared",
      who: h.source === "excel" ? null : `by ${nameOf.get(h.changed_by ?? "") ?? "HR"}`,
      detail: `${h.from_status ? `from ${h.from_status} · ` : ""}${h.source === "excel" ? "changed in the Excel" : `changed by ${nameOf.get(h.changed_by ?? "") ?? "HR"}`}`,
      state: /reject|drop|not suitable/i.test(h.to_status ?? "") ? "stopped" : "done",
    });
  }
  if (history.length === 0 && candidate.status) {
    events.push({
      at: null,
      label: "from the Excel",
      title: candidate.status,
      detail: "current status",
      state: /reject|drop|not suitable/i.test(candidate.status) ? "stopped" : "done",
    });
  }

  for (const p of panels) {
    const live = p.members.filter((m) => m.state !== "cancelled");
    const done = live.filter((m) => m.state === "completed");
    const names = live.map((m) => m.name).join(", ");
    const at = p.scheduled_at ?? p.created_at;
    if (live.length === 0) {
      events.push({
        at,
        label: dateOnly(at),
        title: `Round ${p.round} cancelled`,
        who: names || null,
        detail: names || null,
        state: "stopped",
      });
      continue;
    }
    // Name each interviewer with what they said, so a glance at the strip shows
    // who took the round and who is still to give feedback.
    const who = live
      .map((m) =>
        m.state === "completed"
          ? `${m.name} — ${RECOMMENDATION_LABEL[m.recommendation ?? ""] ?? "feedback in"}${m.rating ? ` ${m.rating}/5` : ""}`
          : `${m.name} — awaiting`,
      )
      .join(" · ");
    events.push({
      at,
      label: p.scheduled_at ? fmtDateTime(p.scheduled_at) : "time not set",
      title: `Round ${p.round}`,
      who,
      detail: `${names}${p.mode ? ` · ${p.mode}` : ""}${done.length === live.length ? "" : ` · ${done.length} of ${live.length} gave feedback`}`,
      state: done.length === live.length ? "done" : "pending",
    });
  }

  return events.sort((a, b) => {
    if (!a.at) return 1;
    if (!b.at) return -1;
    return a.at.localeCompare(b.at);
  });
}
