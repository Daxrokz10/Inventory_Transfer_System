/* Navigation config for the SGC Suite shell.
   Two modules share one login/session but present as separate tools:
   - inventory: the original Inventory Transfer System
   - diesel: the Diesel Report (machinery fuel tracking + anomaly review)
   The active module is inferred from the pathname (/diesel/* → diesel). */

export type ModuleKey = "inventory" | "diesel";

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
];

const dieselAdminNav: NavItem[] = [
  ...dieselSupervisorNav,
  { href: "/diesel/anomalies", label: "Anomalies" },
  { href: "/diesel/sites", label: "Sites" },
  { href: "/diesel/visualization", label: "Visualization" },
];

export function navFor(module: ModuleKey, isAdmin: boolean): NavItem[] {
  if (module === "diesel") return isAdmin ? dieselAdminNav : dieselSupervisorNav;
  return isAdmin ? inventoryAdminNav : inventorySupervisorNav;
}

export function moduleFromPathname(pathname: string): ModuleKey {
  return pathname === "/diesel" || pathname.startsWith("/diesel/")
    ? "diesel"
    : "inventory";
}
