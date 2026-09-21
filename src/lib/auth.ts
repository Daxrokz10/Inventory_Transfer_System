import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/* Per-request auth helpers.

   getAuthUser verifies the session JWT locally: the project signs tokens with
   an asymmetric key (ES256), so getClaims checks the signature against the
   cached public key instead of calling the Supabase Auth server the way
   getUser does.

   Both helpers are wrapped in React cache(), so the layout and the page (and
   anything else rendered in the same request) share one result: one profile
   query per click instead of one per component. */

export type AuthUser = {
  id: string;
  email: string | null;
  app_metadata: { role?: string; access?: Partial<Access> } & Record<string, unknown>;
};

export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient();
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub) return null;
    const c = data.claims;
    return {
      id: c.sub,
      email: typeof c.email === "string" ? c.email : null,
      app_metadata: (c.app_metadata ?? {}) as AuthUser["app_metadata"],
    };
  } catch {
    return null;
  }
});

export type UserRole = "superadmin" | "admin" | "supervisor" | "hr" | "viewer";

/* Two different questions, deliberately separate:

   canViewAll  — may this person see EVERY site's data (the admin view of
                 each page, the cross-site reports, the registers)?
   canWriteAll — may they change any of it?

   They match for admin/superadmin. They diverge for "viewer", a read-only
   account: same visibility, no write anywhere — not even at their own
   site, since the database gives them no home site for write purposes
   (migration 0043). Every page gates viewing on the first and every write
   control on the second, so a viewer sees the same numbers with no way to
   alter them. */
export function canViewAll(role: string | null | undefined): boolean {
  return role === "admin" || role === "superadmin" || role === "viewer";
}

export function canWriteAll(role: string | null | undefined): boolean {
  return role === "admin" || role === "superadmin";
}

export type Profile = {
  id: string;
  full_name: string | null;
  role: UserRole;
  home_project_id: string | null;
  can_inventory: boolean;
  can_diesel: boolean;
  hr_staff: boolean;
  hr_interviewer: boolean;
  hr_planning: boolean;
};

const PROFILE_COLUMNS =
  "id, full_name, role, home_project_id, can_inventory, can_diesel, hr_staff, hr_interviewer, hr_planning";

export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();
  if (!error) return (data as Profile | null) ?? null;

  // Access columns not there yet (migration 0035 not run): keep the app
  // working with the old behaviour — Inventory + Diesel for everyone.
  const { data: legacy } = await supabase
    .from("profiles")
    .select("id, full_name, role, home_project_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!legacy) return null;
  return {
    ...(legacy as Pick<Profile, "id" | "full_name" | "role" | "home_project_id">),
    can_inventory: true,
    can_diesel: true,
    hr_staff: false,
    hr_interviewer: false,
    hr_planning: false,
  };
});

/* ---------------- module access ---------------- */

export type Access = {
  superadmin: boolean;
  inventory: boolean;
  diesel: boolean;
  hrStaff: boolean;
  interviewer: boolean;
  planning: boolean;
};

export const NO_ACCESS: Access = {
  superadmin: false,
  inventory: false,
  diesel: false,
  hrStaff: false,
  interviewer: false,
  planning: false,
};

/** The superadmin can do everything; everyone else gets their flags. */
export function accessFromProfile(p: Pick<Profile, "role" | "can_inventory" | "can_diesel" | "hr_staff" | "hr_interviewer" | "hr_planning"> | null): Access {
  if (!p) return NO_ACCESS;
  if (p.role === "superadmin") {
    return { superadmin: true, inventory: true, diesel: true, hrStaff: true, interviewer: true, planning: true };
  }
  return {
    superadmin: false,
    inventory: p.can_inventory,
    diesel: p.can_diesel,
    hrStaff: p.hr_staff,
    interviewer: p.hr_interviewer,
    planning: p.hr_planning,
  };
}

export const getAccess = cache(async (): Promise<Access> => accessFromProfile(await getProfile()));

export function hasAnyHr(a: Access): boolean {
  return a.hrStaff || a.interviewer || a.planning;
}

/** Where a user lands after login (and where disallowed paths send them). */
export function homeFor(a: Access): string {
  if (a.superadmin) return "/console";
  if (a.inventory) return "/dashboard";
  if (a.diesel) return "/diesel";
  if (a.hrStaff) return "/hr";
  if (a.planning) return "/hr/openings";
  if (a.interviewer) return "/hr/my-interviews";
  return "/no-access";
}
