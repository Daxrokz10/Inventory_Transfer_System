"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/* Admin-only by RLS (see migration 0030): dismiss a daily-review insight
   once it's been looked at. Mirrors resolveFlag in ../actions.ts. */
export async function acknowledgeInsight(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const id = String(formData.get("insight_id") ?? "").trim();
  if (!id) return;

  await supabase
    .from("diesel_ai_insights")
    .update({ acknowledged: true })
    .eq("id", id);
  revalidatePath("/diesel/anomalies");
}
