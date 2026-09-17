"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import type { Access } from "@/lib/auth";
import {
  MODULES,
  hrHome,
  moduleFromPathname,
  modulesFor,
  navFor,
} from "@/lib/nav";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";

/* One shell, three tools. The module switcher at the top of the sidebar flips
   between Inventory (steel blue), Diesel (safety amber) and HR (teal); data-theme on the
   root swaps the accent tokens so each module keeps its own identity while
   sharing the session, sidebar, and design system. */

export function AppShell({
  fullName,
  roleLabel,
  role,
  access,
  children,
}: {
  fullName: string;
  roleLabel: string;
  role: string | null;
  access: Access;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const current = moduleFromPathname(pathname);
  const nav = navFor(current, access, role);
  const modules = modulesFor(access);
  const moduleHome = (key: (typeof modules)[number]) => (key === "hr" ? hrHome(access) : MODULES[key].home);

  return (
    <div
      data-theme={current === "diesel" || current === "hr" ? current : undefined}
      className="flex min-h-screen"
    >
      <aside className="sticky top-0 flex h-screen w-64 flex-col bg-sidebar px-3 py-4 text-sidebar-ink">
        {/* Brand */}
        <div className="mb-4 flex items-start justify-between gap-2 px-2">
          <div>
            <p className="font-display text-base font-bold uppercase tracking-[0.16em]">
              SGC <span className="text-sidebar-muted">Suite</span>
            </p>
            <p className="mt-0.5 text-[11px] text-sidebar-muted">
              Shree Ganesh Corporation
            </p>
          </div>
          <NotificationBell />
        </div>

        {access.superadmin && (
          <Link
            href="/console"
            className={cn(
              "mb-2 block rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
              current === "console"
                ? "bg-white/10 text-white"
                : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-ink",
            )}
          >
            ⚙ Control Panel
          </Link>
        )}

        {/* Module switcher */}
        {modules.length > 0 && (
        <div
          className="mb-5 grid gap-1 rounded-lg bg-sidebar-hover p-1"
          style={{ gridTemplateColumns: `repeat(${modules.length}, minmax(0, 1fr))` }}
        >
          {modules.map((key) => {
            const active = key === current;
            return (
              <Link
                key={key}
                href={moduleHome(key)}
                className={cn(
                  "rounded-md px-2 py-1.5 text-center text-xs font-semibold transition-colors",
                  active
                    ? "bg-accent text-white"
                    : "text-sidebar-muted hover:text-sidebar-ink",
                )}
              >
                {MODULES[key].label}
              </Link>
            );
          })}
        </div>
        )}

        {/* Module title */}
        <div className="mb-2 px-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sidebar-muted">
            {MODULES[current].tagline}
          </p>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-0.5 text-sm">
          {nav.map((item) => {
            // Exact match, or a sub-route of a non-home item (home links
            // only highlight exactly, so /diesel/machines doesn't also
            // light up "Fuel Log").
            const active =
              pathname === item.href ||
              (item.href !== MODULES[current].home &&
                pathname.startsWith(item.href + "/"));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-2 transition-colors",
                  active
                    ? "bg-sidebar-hover font-medium text-white"
                    : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="mt-4 border-t border-white/10 px-2 pt-3 text-xs">
          <div className="-mx-2 mb-1">
            <ThemeToggle />
          </div>
          <p className="truncate font-medium text-sidebar-ink">{fullName}</p>
          <p className="text-sidebar-muted">{roleLabel}</p>
          <form action="/auth/signout" method="post" className="mt-2">
            <button
              className="text-sidebar-muted underline-offset-2 hover:text-white hover:underline"
              type="submit"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* min-w-0 is load-bearing: without it, a flex item won't shrink
          below its content's intrinsic width, so one wide table anywhere
          on the page would force this whole row (sidebar included) to
          grow instead of just scrolling internally. */}
      <main className="min-w-0 flex-1 overflow-x-hidden p-8">{children}</main>
    </div>
  );
}
