import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/SetupNotice";
import { AppShell } from "@/components/AppShell";
import { accessFromProfile, getAuthUser, getProfile } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured) {
    return <SetupNotice />;
  }

  const user = await getAuthUser();

  if (!user) {
    redirect("/login");
  }

  const profile = await getProfile();
  const access = accessFromProfile(profile);

  const roleLabel =
    profile?.role === "superadmin"
      ? "Superadmin"
      : profile?.role === "admin"
        ? "Admin"
        : profile?.can_inventory || profile?.can_diesel
          ? "Store Manager"
          : profile?.hr_staff
            ? "HR"
            : profile?.hr_planning
              ? "Planning"
              : profile?.hr_interviewer
                ? "Interviewer"
                : "—";

  return (
    <AppShell
      fullName={profile?.full_name ?? user.email ?? "—"}
      roleLabel={roleLabel}
      role={profile?.role ?? null}
      access={access}
    >
      {children}
    </AppShell>
  );
}
