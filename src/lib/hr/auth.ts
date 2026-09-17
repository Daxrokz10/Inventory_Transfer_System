import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccess, getAuthUser, hasAnyHr, type Access } from "@/lib/auth";
import { hrHome } from "@/lib/nav";

export type HrNeed = "staff" | "interviewer" | "planning" | "any";

function allowed(a: Access, need: HrNeed): boolean {
  switch (need) {
    case "staff":
      return a.hrStaff;
    case "interviewer":
      return a.interviewer || a.hrStaff;
    case "planning":
      return a.planning || a.hrStaff;
    default:
      return hasAnyHr(a);
  }
}

/** Current user + HR access. Redirects when the user lacks `need`
    (HR staff → Candidates, planning → Openings, interviewer → My Interviews). */
export async function getHrContext(need: HrNeed = "any") {
  const [supabase, user, access] = await Promise.all([createClient(), getAuthUser(), getAccess()]);
  if (!user) redirect("/login");
  if (!allowed(access, need)) redirect(hasAnyHr(access) ? hrHome(access) : "/");
  return { supabase, user, access, isHr: access.hrStaff };
}
