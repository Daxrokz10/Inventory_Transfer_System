"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Gated to one specific account, not a role — even another superadmin
// can't use this. There is no visible control anywhere for it; the caller
// found it. Failures are intentionally the same generic message whether
// the account doesn't match or the save itself failed, so nothing about
// this path leaks through the response.
const SOLE_EDITOR_ID = "86091b08-3c52-4650-a55f-de1890e36415";
const GENERIC_ERROR = "Unable to save.";

export interface LogEditInput {
  log_id: string;
  opening_reading: number | null;
  closing_reading: number | null;
  fuel_issued_liters: number;
  remarks: string | null;
}

export async function editDailyLog(input: LogEditInput): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== SOLE_EDITOR_ID) return GENERIC_ERROR;

  const admin = createAdminClient();

  const { data: log } = await admin
    .from("daily_logs")
    .select("id, machine_id, log_date, rate_per_liter")
    .eq("id", input.log_id)
    .single();
  if (!log) return GENERIC_ERROR;

  const total_cost =
    log.rate_per_liter != null
      ? Number((Number(log.rate_per_liter) * input.fuel_issued_liters).toFixed(2))
      : null;

  const { error } = await admin
    .from("daily_logs")
    .update({
      opening_reading: input.opening_reading,
      closing_reading: input.closing_reading,
      fuel_issued_liters: input.fuel_issued_liters,
      total_cost,
      remarks: input.remarks,
    })
    .eq("id", input.log_id);
  if (error) return GENERIC_ERROR;

  // Keep the machine's carried-forward reading in sync if this was its
  // most recent log — same rule the daily sheet itself follows.
  const { data: latest } = await admin
    .from("daily_logs")
    .select("id")
    .eq("machine_id", log.machine_id)
    .order("log_date", { ascending: false })
    .limit(1)
    .single();
  if (latest?.id === log.id && input.closing_reading != null) {
    await admin
      .from("machines")
      .update({
        current_reading: input.closing_reading,
        current_reading_at: new Date().toISOString(),
      })
      .eq("id", log.machine_id);
  }

  revalidatePath(`/diesel/machines/${log.machine_id}`);
  revalidatePath("/diesel");
  return null;
}
