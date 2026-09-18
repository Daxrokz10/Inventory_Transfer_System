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
  filled: "good",
  cancelled: "neutral",
};

export const fmtDay = (day: string | null) =>
  day ? new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** How the joining day compares with the date planning asked for. */
export function joiningNote(
  joinedOn: string | null,
  requiredBy: string | null,
): { text: string; tone: BadgeTone } | null {
  if (!joinedOn) return null;
  if (!requiredBy) return { text: `Joined ${fmtDay(joinedOn)}`, tone: "good" };
  const days = Math.round((new Date(joinedOn).getTime() - new Date(requiredBy).getTime()) / 86_400_000);
  if (days === 0) return { text: `Joined ${fmtDay(joinedOn)} — on the date needed`, tone: "good" };
  return days < 0
    ? { text: `Joined ${fmtDay(joinedOn)} — ${-days} day${days === -1 ? "" : "s"} before needed`, tone: "good" }
    : { text: `Joined ${fmtDay(joinedOn)} — ${days} day${days === 1 ? "" : "s"} late`, tone: "warn" };
}

/** Whole days since an ISO timestamp. */
export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}
