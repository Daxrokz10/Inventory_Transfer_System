"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACCESS_FLAGS, type AccessFlag } from "./constants";

/* Control Panel actions — superadmin only. Checked with getUser (a live call
   to Supabase Auth, not just the local JWT) because these change who can
   do what. Credential changes (email/password/remove) reuse the actions
   in /admin/users, which the superadmin also passes. */

async function requireSuperadmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "superadmin") redirect("/");
  return { supabase, userId: user.id };
}


const revalidate = () => {
  revalidatePath("/console");
  revalidatePath("/admin/users");
};

export async function createUserWithAccess(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase } = await requireSuperadmin();

  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "").trim();
  const full_name = String(fd.get("full_name") ?? "").trim();
  // New accounts get the standard level; access is decided by the checkboxes.
  const role = "supervisor";
  const home_project_id = String(fd.get("home_project_id") ?? "").trim() || null;

  if (!full_name) return "Name is required.";
  if (!email || !password) return "Email and password are required.";
  if (password.length < 8) return "Password must be at least 8 characters.";

  const flags = Object.fromEntries(ACCESS_FLAGS.map((f) => [f, fd.get(f) === "on"])) as Record<AccessFlag, boolean>;
  if (!Object.values(flags).some(Boolean)) return "Give the user access to at least one module.";

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (error) return error.message;

  const { error: pErr } = await supabase
    .from("profiles")
    .update({ full_name, role, home_project_id, ...flags })
    .eq("id", data.user.id);
  if (pErr) return pErr.message;

  revalidate();
  return null;
}

export async function setAccessFlag(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase, userId } = await requireSuperadmin();
  const user_id = String(fd.get("user_id") ?? "");
  const flag = String(fd.get("flag") ?? "") as AccessFlag;
  const value = fd.get("value") === "true";
  if (!user_id || !ACCESS_FLAGS.includes(flag)) return "Invalid request.";

  const { data: target } = await supabase.from("profiles").select("role").eq("id", user_id).single();
  if (!target) return "User not found.";
  if (target.role === "superadmin" || user_id === userId) return "The superadmin always has full access.";

  const { error } = await supabase.from("profiles").update({ [flag]: value }).eq("id", user_id);
  if (error) return error.message;
  revalidate();
  return null;
}

export async function renameUser(_prev: string | null, fd: FormData): Promise<string | null> {
  const { supabase } = await requireSuperadmin();
  const user_id = String(fd.get("user_id") ?? "");
  const full_name = String(fd.get("full_name") ?? "").trim();
  if (!user_id || !full_name) return "Name is required.";
  const { error } = await supabase.from("profiles").update({ full_name }).eq("id", user_id);
  if (error) return error.message;
  revalidate();
  return null;
}
