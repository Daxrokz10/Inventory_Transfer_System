import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/SetupNotice";
import { AppShell } from "@/components/AppShell";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured) {
    return <SetupNotice />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  const roleLabel =
    profile?.role === "superadmin"
      ? "Superadmin"
      : profile?.role === "admin"
        ? "Admin"
        : profile?.role === "supervisor"
          ? "Store Manager"
          : "—";

  return (
    <AppShell
      fullName={profile?.full_name ?? user.email ?? "—"}
      roleLabel={roleLabel}
      isAdmin={isAdmin}
    >
      {children}
    </AppShell>
  );
}
