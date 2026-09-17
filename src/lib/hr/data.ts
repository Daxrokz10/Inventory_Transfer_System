import { createClient } from "@/lib/supabase/server";

export type Stage = { name: string; sort_order: number; kind: "active" | "hold" | "success" | "closed" };

/** Stages in pipeline order (unsorted ones, sort_order 1000, last). */
export async function getStages(): Promise<Stage[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("hr_stages").select("name, sort_order, kind").order("sort_order").order("name");
  return (data ?? []) as Stage[];
}

/** Openings HR can still tag candidates to. */
export async function getOpenOpenings(): Promise<{ id: string; code: string; designation: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("hr_openings")
    .select("id, code, designation")
    .in("status", ["open", "in_progress"])
    .order("code", { ascending: false });
  return data ?? [];
}

export const OPENING_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  filled: "Filled",
  cancelled: "Cancelled",
};

export const PRIORITY_LABEL: Record<string, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};
