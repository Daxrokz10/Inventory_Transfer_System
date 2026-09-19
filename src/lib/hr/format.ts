import type { BadgeTone } from "@/components/ui/Badge";

export function statusTone(status: string | null | undefined): BadgeTone {
  const s = (status ?? "").toLowerCase();
  if (/reject|not suitable|declined|no show/.test(s)) return "danger";
  if (/select|join|offer|hired/.test(s)) return "good";
  if (/hold|pending|wait/.test(s)) return "warn";
  if (/interview|shortlist|scheduled/.test(s)) return "accent";
  return "neutral";
}

export const RECOMMENDATION_LABEL: Record<string, string> = {
  hire: "Hire",
  reject: "Reject",
  hold: "On hold",
  next_round: "Next round",
};

export function recommendationTone(r: string | null): BadgeTone {
  return r === "hire" ? "good" : r === "reject" ? "danger" : r === "hold" ? "warn" : r ? "accent" : "neutral";
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDateTime(iso);
}

export const OPENING_STATUS_TONE: Record<string, BadgeTone> = {
  open: "accent",
  in_progress: "warn",
  accepted: "accent",
  filled: "good",
  cancelled: "neutral",
};

export const fmtDay = (day: string | null) =>
  day ? new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** dd/mm/yyyy or yyyy-mm-dd → yyyy-mm-dd (null if it isn't a date). */
export function toIsoDay(s: string | null | undefined): string | null {
  const v = s?.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : null;
}

function versusNeeded(day: string, requiredBy: string | null): { suffix: string; late: boolean } {
  if (!requiredBy) return { suffix: "", late: false };
  const days = Math.round((new Date(day).getTime() - new Date(requiredBy).getTime()) / 86_400_000);
  if (days === 0) return { suffix: " — on the date needed", late: false };
  return days < 0
    ? { suffix: ` — ${-days} day${days === -1 ? "" : "s"} before needed`, late: false }
    : { suffix: ` — ${days} day${days === 1 ? "" : "s"} late`, late: true };
}

/** How the joining day compares with the date planning asked for. */
export function joiningNote(
  joinedOn: string | null,
  requiredBy: string | null,
): { text: string; tone: BadgeTone } | null {
  if (!joinedOn) return null;
  const v = versusNeeded(joinedOn, requiredBy);
  return { text: `Joined ${fmtDay(joinedOn)}${v.suffix}`, tone: v.late ? "warn" : "good" };
}

/** A joining date agreed but not reached yet (offer accepted). */
export function expectedJoiningNote(
  dateOfJoining: string | null | undefined,
  requiredBy: string | null,
): { text: string; tone: BadgeTone } | null {
  const day = toIsoDay(dateOfJoining);
  if (!day) return null;
  const v = versusNeeded(day, requiredBy);
  return { text: `Joining ${fmtDay(day)}${v.suffix.replace(" late", " after needed")}`, tone: v.late ? "warn" : "accent" };
}

/** "3 needed · 1 joined · 1 joining · 1 still to hire" — each hire counts once,
    whether they have joined or only accepted. */
export function hiringSummary(headcount: number, joined: number, joining: number): string {
  const needed = Math.max(1, headcount);
  const parts = [`${needed} needed`];
  if (joined) parts.push(`${joined} joined`);
  if (joining) parts.push(`${joining} joining`);
  const left = Math.max(0, needed - joined - joining);
  if (joined || joining) parts.push(left ? `${left} still to hire` : "all hired");
  return parts.join(" · ");
}

/** ISO timestamp for `days` days ago. */
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Whole days since an ISO timestamp. */
export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}
