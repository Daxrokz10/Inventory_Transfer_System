/* Navigation config for the SGC Suite shell.
   Three modules share one login/session but present as separate tools:
   - inventory: the original Inventory Transfer System
   - diesel: the Diesel Report (machinery fuel tracking + anomaly review)
   - hr: candidates, interviews & openings (synced with HR's master Excel)
   - console: the superadmin's Control Panel (users, credentials, access)
   The active module is inferred from the pathname (/diesel/* → diesel). */

import type { Access } from "@/lib/auth";

export type ModuleKey = "inventory" | "diesel" | "hr" | "console";

export interface NavItem {
  href: string;
  label: string;
}

export const MODULES: Record<
  ModuleKey,
  { label: string; home: string; tagline: string }
> = {
  inventory: {
    label: "Inventory",
    home: "/dashboard",
    tagline: "Material transfers & stock",
  },
  diesel: {
    label: "Diesel",
    home: "/diesel",
    tagline: "Fuel, machinery & anomalies",
  },
  hr: {
    label: "HR",
    home: "/hr",
    tagline: "Candidates & interviews",
  },
  console: {
    label: "Control Panel",
    home: "/console",
    tagline: "Users & module access",
  },
};

const inventorySupervisorNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/masters/projects", label: "Closing Balance" },
  { href: "/transactions", label: "Transactions" },
  { href: "/transfers", label: "Transfers" },
  { href: "/inbox", label: "Receive Inbox" },
  { href: "/masters/items", label: "Items" },
];

const inventoryAdminNav: NavItem[] = [
  ...inventorySupervisorNav,
  { href: "/purchases", label: "Purchase" },
  { href: "/admin/users", label: "Users" },
];

const dieselSupervisorNav: NavItem[] = [
  { href: "/diesel", label: "Daily Report" },
  { href: "/diesel/machines", label: "Machinery" },
  { href: "/diesel/register", label: "Diesel Register" },
];

const dieselAdminNav: NavItem[] = [
  ...dieselSupervisorNav,
  { href: "/diesel/anomalies", label: "Anomalies" },
  { href: "/diesel/planning", label: "Planning" },
  { href: "/diesel/reports", label: "Reports" },
  { href: "/diesel/history", label: "Site History" },
  { href: "/diesel/sites", label: "Sites" },
  { href: "/diesel/visualization", label: "Visualization" },
  { href: "/diesel/assistant", label: "Assistant" },
];

const consoleNav: NavItem[] = [{ href: "/console", label: "Users & access" }];

function hrNav(a: Access): NavItem[] {
  const items: NavItem[] = [];
  if (a.hrStaff) {
    items.push(
      { href: "/hr", label: "Candidates" },
      { href: "/hr/status", label: "Status" },
      { href: "/hr/openings", label: "Openings" },
      { href: "/hr/interviews", label: "Interviews" },
    );
  } else if (a.planning || a.interviewer) {
    // Planning follows their own openings on the status board; interviewers
    // see what the company is hiring for. Both read-only.
    if (a.planning) items.push({ href: "/hr/status", label: "Status" });
    items.push({ href: "/hr/openings", label: "Openings" });
  }
  if (a.interviewer) items.push({ href: "/hr/my-interviews", label: "My Interviews" });
  if (a.hrStaff) items.push({ href: "/hr/settings", label: "Settings" });
  return items;
}

export function navFor(module: ModuleKey, access: Access, role: string | null): NavItem[] {
  const isAdmin = role === "admin" || role === "superadmin";
  if (module === "console") return consoleNav;
  if (module === "hr") return hrNav(access);
  if (module === "diesel") return isAdmin ? dieselAdminNav : dieselSupervisorNav;
  return isAdmin ? inventoryAdminNav : inventorySupervisorNav;
}

/** Modules shown in the switcher (the Control Panel is linked separately). */
export function modulesFor(a: Access): Exclude<ModuleKey, "console">[] {
  const out: Exclude<ModuleKey, "console">[] = [];
  if (a.inventory) out.push("inventory");
  if (a.diesel) out.push("diesel");
  if (a.hrStaff || a.interviewer || a.planning) out.push("hr");
  return out;
}

/** HR's home depends on which HR role the user has. */
export function hrHome(a: Access): string {
  return a.hrStaff ? "/hr" : a.planning ? "/hr/openings" : "/hr/my-interviews";
}

const startsWith = (path: string, base: string) => path === base || path.startsWith(base + "/");

export function moduleFromPathname(pathname: string): ModuleKey {
  if (startsWith(pathname, "/console")) return "console";
  if (startsWith(pathname, "/diesel")) return "diesel";
  if (startsWith(pathname, "/hr")) return "hr";
  return "inventory";
}

export function canUseModule(module: ModuleKey, a: Access): boolean {
  switch (module) {
    case "console":
      return a.superadmin;
    case "diesel":
      return a.diesel;
    case "hr":
      return a.hrStaff || a.interviewer || a.planning;
    default:
      return a.inventory;
  }
}
