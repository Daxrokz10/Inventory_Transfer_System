"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type CallerRole = "superadmin" | "admin" | "supervisor" | null;

async function getCallerRole(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  callerRole: CallerRole;
  callerId: string;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const callerRole = (profile?.role ?? null) as CallerRole;
  if (callerRole !== "admin" && callerRole !== "superadmin") redirect("/dashboard");

  return { supabase, callerRole, callerId: user.id };
}

export async function createUser(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const { supabase, callerRole } = await getCallerRole();
  const admin = createAdminClient();

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const full_name = String(formData.get("full_name") ?? "").trim();
  const home_project_id = String(formData.get("home_project_id") ?? "").trim() || null;
  const requestedRole = String(formData.get("role") ?? "supervisor").trim();

  if (!email || !password) return "Email and password are required.";
  if (password.length < 8) return "Password must be at least 8 characters.";

  // Only superadmin can create admin accounts
  if (requestedRole === "admin" && callerRole !== "superadmin") {
    return "Only superadmin can create admin accounts.";
  }
  if (requestedRole === "superadmin") {
    return "Superadmin accounts cannot be created from here.";
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (error) return error.message;

  const { error: pErr } = await supabase
    .from("profiles")
    .update({ full_name, home_project_id, role: requestedRole as "admin" | "supervisor" })
    .eq("id", data.user.id);
  if (pErr) return pErr.message;

  revalidatePath("/admin/users");
  return null;
}

export async function assignSite(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const { supabase } = await getCallerRole();

  const user_id = String(formData.get("user_id") ?? "").trim();
  const home_project_id = String(formData.get("home_project_id") ?? "").trim() || null;

  if (!user_id) return "Missing user reference.";

  const { error } = await supabase
    .from("profiles")
    .update({ home_project_id })
    .eq("id", user_id);
  if (error) return error.message;

  revalidatePath("/admin/users");
  return null;
}

export async function changePassword(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const { callerRole } = await getCallerRole();
  if (callerRole !== "superadmin") return "Only superadmin can change passwords.";

  const user_id = String(formData.get("user_id") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  if (!user_id) return "Missing user reference.";
  if (password.length < 8) return "Password must be at least 8 characters.";

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user_id, { password });
  if (error) return error.message;

  revalidatePath("/admin/users");
  return null;
}

export async function changeEmail(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const { callerRole } = await getCallerRole();
  if (callerRole !== "superadmin") return "Only superadmin can change emails.";

  const user_id = String(formData.get("user_id") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  if (!user_id) return "Missing user reference.";
  if (!email) return "Email is required.";

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user_id, {
    email,
    email_confirm: true,
  });
  if (error) return error.message;

  revalidatePath("/admin/users");
  return null;
}

export async function deleteUser(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const { supabase, callerRole, callerId } = await getCallerRole();
  if (callerRole !== "superadmin") return "Only superadmin can remove users.";

  const user_id = String(formData.get("user_id") ?? "").trim();
  if (!user_id) return "Missing user reference.";
  if (user_id === callerId) return "You cannot remove your own account.";

  const { data: target } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user_id)
    .single();
  if (target?.role === "superadmin") return "Superadmin accounts cannot be removed here.";

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user_id);
  if (error) return error.message;

  revalidatePath("/admin/users");
  return null;
}
