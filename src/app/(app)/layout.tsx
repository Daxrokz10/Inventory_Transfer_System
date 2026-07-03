import Link from "next/link";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/SetupNotice";
import { createClient } from "@/lib/supabase/server";

const supervisorNav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/masters/projects", label: "Closing Balance" },
  { href: "/transactions", label: "Transactions" },
  { href: "/transfers", label: "Transfers" },
  { href: "/inbox", label: "Receive Inbox" },
  { href: "/masters/items", label: "Items" },
];

const adminNav = [
  ...supervisorNav,
  { href: "/purchases", label: "Purchase" },
  { href: "/masters/sites", label: "Sites" },
  { href: "/admin/users", label: "Users" },
];

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

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-gray-200 bg-white p-4">
        <div className="mb-6">
          <p className="text-sm font-semibold leading-tight">
            Inventory Transfer
          </p>
          <p className="text-xs text-gray-500">Shree Ganesh Corporation</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 text-sm">
          {(profile?.role === "admin" || profile?.role === "superadmin" ? adminNav : supervisorNav).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded px-3 py-2 text-gray-700 hover:bg-gray-200"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-4 border-t border-gray-200 pt-4 text-xs text-gray-500">
          <p className="truncate font-medium text-gray-700">
            {profile?.full_name ?? user.email}
          </p>
          <p>
            {profile?.role === "superadmin"
              ? "Superadmin"
              : profile?.role === "admin"
              ? "Admin"
              : profile?.role === "supervisor"
              ? "Store Manager"
              : "—"}
          </p>
          <form action="/auth/signout" method="post" className="mt-2">
            <button className="text-blue-600 hover:underline" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
