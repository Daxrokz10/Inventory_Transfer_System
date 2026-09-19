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
  const days = daysBetween(requiredBy, day);
  if (days === 0) return { suffix: " — on the date needed", late: false };
  return days < 0
    ? { suffix: ` — ${-days} day${days === -1 ? "" : "s"} before needed`, late: false }
    : { suffix: ` — ${days} day${days === 1 ? "" : "s"} after needed`, late: true };
}

const daysBetween = (from: string, to: string) =>
  Math.round((new Date(to.slice(0, 10)).getTime() - new Date(from.slice(0, 10)).getTime()) / 86_400_000);

const addDays = (day: string, n: number) =>
  new Date(new Date(day.slice(0, 10)).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** The notice period a new hire usually has to serve at their old job. Joining
    inside it is expected, not a delay on HR's side. */
export const NOTICE_DAYS = 30;

export type HireNote = { text: string; tone: BadgeTone };

/** Two separate judgements for someone hired against an opening:

    1. Hiring — HR's part: the day the offer was accepted, against the date
       planning needed the person.
    2. Joining — the candidate's notice period: the joining day against the
       offer date plus the usual one month. Joining within it is on time; any
       delay past it is the candidate's, not HR's.

    Without a recorded offer date (someone set straight to Joined), joining is
    judged against the date needed plus the notice month. */
export function hireNotes(h: {
  offerAcceptedOn: string | null;
  joinedOn: string | null | undefined;
  dateOfJoining: string | null | undefined;
  requiredBy: string | null;
}): HireNote[] {
  const notes: HireNote[] = [];
  const joined = Boolean(h.joinedOn);
  const day = h.joinedOn ?? toIsoDay(h.dateOfJoining);
  const verb = joined ? "Joined" : "Joining";

  if (h.offerAcceptedOn) {
    const v = versusNeeded(h.offerAcceptedOn, h.requiredBy);
    notes.push({ text: `Offer accepted ${fmtDay(h.offerAcceptedOn)}${v.suffix}`, tone: v.late ? "warn" : "good" });
  }

  if (!day) {
    if (!joined) notes.push({ text: "Joining date not set", tone: "warn" });
    return notes;
  }

  const from = h.offerAcceptedOn ?? h.requiredBy;
  if (!from) {
    notes.push({ text: `${verb} ${fmtDay(day)}`, tone: joined ? "good" : "accent" });
    return notes;
  }
  const past = daysBetween(addDays(from, NOTICE_DAYS), day);
  const within = h.offerAcceptedOn ? "within the 1-month notice" : "within a month of the date needed";
  notes.push(
    past <= 0
      ? { text: `${verb} ${fmtDay(day)} — ${within}`, tone: joined ? "good" : "accent" }
      : { text: `${verb} ${fmtDay(day)} — ${past} day${past === 1 ? "" : "s"} past the notice period`, tone: "neutral" },
  );
  return notes;
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
