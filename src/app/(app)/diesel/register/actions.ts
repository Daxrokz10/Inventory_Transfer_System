"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Set (or re-set) the opening barrel-stock count that anchors a site's
// diesel register balance. RLS scopes this to the caller's own site (or
// admin). One row per site — a fresh physical count overwrites the old one.
export async function setOpeningStock(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const project_id = String(formData.get("project_id") ?? "").trim();
  const liters = Number(formData.get("liters"));
  const as_of = String(formData.get("as_of") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!project_id) return "Missing site.";
  if (!(liters >= 0)) return "Enter the barrels on hand in liters (0 or more).";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(as_of)) return "Pick a valid date.";

  const { error } = await supabase.from("diesel_opening_stock").upsert(
    {
      project_id,
      liters,
      as_of,
      note,
      set_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" },
  );
  if (error) return error.message;

  revalidatePath("/diesel/register");
  return null;
}
