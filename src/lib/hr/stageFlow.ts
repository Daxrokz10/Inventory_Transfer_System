import { createAdminClient } from "@/lib/supabase/admin";

/* Where a candidate lands once a round's feedback is in.

   The stages HR keeps in hr_stages are the whole ladder: the active ones are
   the rounds themselves (Telephonic Interview, Technical Round, Management
   Round, Offer…), each followed by the rejection that ends the process there.
   Round 1 in the app is the first round after HR's own telephonic call, so
   round N is the Nth active stage. Clearing a round puts the candidate on that
   stage; a rejection puts them on the closed stage that follows it. */

export type Stage = { name: string; sort_order: number; kind: "active" | "hold" | "success" | "closed" };

export type PanelVerdict = "cleared" | "rejected" | "hold";

/** One verdict for the whole panel: one rejection stops it; anything on hold
    waits for HR; otherwise the candidate moves on. */
export function panelVerdict(recommendations: (string | null)[]): PanelVerdict {
  if (recommendations.some((r) => r === "reject")) return "rejected";
  if (recommendations.some((r) => r === "hold" || !r)) return "hold";
  return "cleared";
}

export async function listStages(): Promise<Stage[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("hr_stages").select("name, sort_order, kind").order("sort_order");
  return (data ?? []) as Stage[];
}

/** The status to move to, or null to leave it to HR. */
export function nextStatus(stages: Stage[], round: number, verdict: PanelVerdict): string | null {
  if (verdict === "hold") return null;

  const active = stages.filter((s) => s.kind === "active");
  if (!active.length) return null;
  // Round 1 is the first round after the telephonic call, so it is active[1].
  const reached = active[Math.min(Math.max(round, 1), active.length - 1)];
  if (!reached) return null;

  if (verdict === "cleared") return reached.name;

  const rejection = stages.find((s) => s.kind === "closed" && s.sort_order > reached.sort_order);
  return rejection?.name ?? null;
}
