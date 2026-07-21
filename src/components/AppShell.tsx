"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import {
  MODULES,
  moduleFromPathname,
  navFor,
  type ModuleKey,
} from "@/lib/nav";

/* One shell, two tools. The module switcher at the top of the sidebar flips
   between Inventory (steel blue) and Diesel (safety amber); data-theme on the
   root swaps the accent tokens so each module keeps its own identity while
   sharing the session, sidebar, and design system. */

export function AppShell({
  fullName,
  roleLabel,
  isAdmin,
  children,
}: {
  fullName: string;
  roleLabel: string;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const module = moduleFromPathname(pathname);
  const nav = navFor(module, isAdmin);

  return (
    <div
      data-theme={module === "diesel" ? "diesel" : undefined}
      className="flex min-h-screen"
    >
      <aside className="sticky top-0 flex h-screen w-64 flex-col bg-sidebar px-3 py-4 text-sidebar-ink">
        {/* Brand */}
        <div className="mb-4 px-2">
          <p className="text-sm font-bold uppercase tracking-[0.14em]">
            SGC <span className="text-sidebar-muted">Suite</span>
          </p>
          <p className="mt-0.5 text-[11px] text-sidebar-muted">
            Shree Ganesh Corporation
          </p>
        </div>

        {/* Module switcher */}
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-sidebar-hover p-1">
          {(Object.keys(MODULES) as ModuleKey[]).map((key) => {
            const active = key === module;
            return (
              <Link
                key={key}
                href={MODULES[key].home}
                className={cn(
                  "rounded-md px-2 py-1.5 text-center text-xs font-semibold transition-colors",
                  active
                    ? key === "diesel"
                      ? "bg-[#b45309] text-white"
                      : "bg-[#1c5cab] text-white"
                    : "text-sidebar-muted hover:text-sidebar-ink",
                )}
              >
                {MODULES[key].label}
              </Link>
            );
          })}
        </div>

        {/* Module title */}
        <div className="mb-2 px-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sidebar-muted">
            {MODULES[module].tagline}
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
              (item.href !== MODULES[module].home &&
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
        <div className="mt-4 border-t border-white/10 px-2 pt-4 text-xs">
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

      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
