import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type Stage = { name: string; sort_order: number; kind: "active" | "hold" | "success" | "closed" };

/** Stages in pipeline order (unsorted ones, sort_order 1000, last). */
export async function getStages(): Promise<Stage[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("hr_stages").select("name, sort_order, kind").order("sort_order").order("name");
  return (data ?? []) as Stage[];
}

/** Openings HR can still tag candidates to, with the site they are for. */
export async function getOpenOpenings(): Promise<{ id: string; code: string; designation: string; site: string | null }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("hr_openings")
    .select("id, code, designation, project:project_id(code)")
    .in("status", ["open", "in_progress", "accepted"])
    .order("code", { ascending: false });
  return ((data ?? []) as unknown as { id: string; code: string; designation: string; project: { code: string } | null }[]).map(
    (o) => ({ id: o.id, code: o.code, designation: o.designation, site: o.project?.code ?? null }),
  );
}

/** The stages that end a hire: "Joined" (the person turned up) and the
    success stages before it, such as "Offer Accepted". Without a stage named
    Joined, the last success stage stands in for it. */
export function joiningStages(stages: Stage[]): { joined: string | null; accepted: string[] } {
  const success = stages.filter((s) => s.kind === "success").sort((a, b) => a.sort_order - b.sort_order);
  const joined = success.find((s) => /^joined$/i.test(s.name.trim()))?.name ?? success.at(-1)?.name ?? null;
  return { joined, accepted: success.map((s) => s.name).filter((n) => n !== joined) };
}

export const OPENING_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  accepted: "Completed — not yet joined",
  filled: "Filled",
  cancelled: "Cancelled",
};

export const PRIORITY_LABEL: Record<string, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

/** Job titles taken from the candidates themselves, so openings and quick add
    use one consistent list. Spellings that differ only by case or punctuation
    are merged, keeping the most common one. Read with the service role
    because planning users can't read candidates. */
export async function getDesignations(minCount = 2): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("hr_designations").select("designation, n");
  const groups = new Map<string, { n: number; spellings: Map<string, number> }>();
  for (const row of data ?? []) {
    const title = String(row.designation).trim();
    if (!title) continue;
    const key = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const g = groups.get(key) ?? { n: 0, spellings: new Map<string, number>() };
    g.n += row.n;
    g.spellings.set(title, (g.spellings.get(title) ?? 0) + row.n);
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.n >= minCount)
    .map((g) => [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0])
    .sort((a, b) => a.localeCompare(b));
}
