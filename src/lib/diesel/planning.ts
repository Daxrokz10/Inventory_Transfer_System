import type { Machine, SiteRequirement } from "./types";

/* Planning: match upcoming site requirements (demand) against the fleet's
   SO end dates (supply — when a machine currently tied up elsewhere frees
   up) and a rent-vs-buy cost table pulled from the company's own June 2026
   "RENTAL VS NEW" workbook tab. This is a deterministic, explainable
   matcher — not a solver — so every suggestion traces back to a plain
   rule someone can check by hand. */

// ---- Rent-vs-buy cost table (source: MONTHLY REVENUE TO COST.xlsx,
// "RENTAL VS NEW" tab, June 2026). Breakeven months = the sheet's own
// "TIME TO FREE" column, taken as given rather than recomputed — it's the
// company's own judgment call, not a pure purchase÷rent division (the
// Poclain row in particular runs longer than that division would suggest,
// presumably folding in something beyond bare rent, so we don't override
// it with our own arithmetic). ----
export interface CostProfile {
  /** Canonical machine_type string this cost applies to. */
  machineType: string;
  monthlyRent: number;
  purchasePrice: number;
  /** Breakeven point, in months, as stated in the source sheet. */
  breakevenMonths: number;
  breakevenLabel: string;
}

export const RENTAL_VS_NEW: CostProfile[] = [
  { machineType: "Excavator", monthlyRent: 180000, purchasePrice: 6093000, breakevenMonths: 45, breakevenLabel: "3.75 years" },
  { machineType: "Wheel Loader", monthlyRent: 80000, purchasePrice: 1905000, breakevenMonths: 24, breakevenLabel: "2 years" },
  { machineType: "Trailer", monthlyRent: 110000, purchasePrice: 4577000, breakevenMonths: 42, breakevenLabel: "3.5 years" },
  { machineType: "Concrete Boom Placer", monthlyRent: 450000, purchasePrice: 13722000, breakevenMonths: 30, breakevenLabel: "2.5 years" },
  { machineType: "Backhoe Loader (JCB)", monthlyRent: 100000, purchasePrice: 3042000, breakevenMonths: 30, breakevenLabel: "2.5 years" },
  { machineType: "Tempo Traveller", monthlyRent: 90000, purchasePrice: 2280850, breakevenMonths: 24, breakevenLabel: "2 years" },
  { machineType: "Bus", monthlyRent: 120000, purchasePrice: 1836000, breakevenMonths: 15, breakevenLabel: "1.25 years" },
  { machineType: "Baby Roller", monthlyRent: 65000, purchasePrice: 1471000, breakevenMonths: 24, breakevenLabel: "2 years" },
];

export function costProfileFor(machineType: string): CostProfile | null {
  return RENTAL_VS_NEW.find((c) => c.machineType === machineType) ?? null;
}

/** Machine types the cost table covers — for the requirement form's picker. */
export const COSTED_MACHINE_TYPES = RENTAL_VS_NEW.map((c) => c.machineType);

// ---- Standing rental demand — derived live from the machines register
// (see standingDemandFromFleet below), not a spreadsheet snapshot. This is
// the fleet-wide baseline the company rents *every month* — the real
// "should we own this?" signal, independent of any single site
// requirement's duration.
//
// Shraddha (Corporation) is SGC's own sister company, not a market vendor —
// paying them "rent" doesn't reflect genuine external dependency the way
// paying an outside hire vendor does. Their units are carved out of the
// buy/rent signal below (shraddhaUnits/shraddhaMonthlyRent), detected off
// each machine's vendor_name, so the verdict is driven only by what we
// actually pay third parties.
export interface StandingDemand {
  machineType: string;
  unitsRented: number;
  sites: number;
  monthlyRent: number;
  shraddhaUnits?: number;
  shraddhaMonthlyRent?: number;
  /** External units of this type with no monthly_rent entered yet — their
      cost is silently counted as ₹0 above, so the UI needs this to warn
      the numbers are incomplete rather than presenting them as final. */
  missingRentUnits: number;
}

const SHRADDHA_VENDOR_RE = /shraddha/i;

// The fixed set of categories the fleet-wide panel tracks — the company's
// own curated "these are the standing rental categories that matter for a
// buy/rent call" list (source: the June 2026 rental provision workbook),
// kept as a stable list so the panel doesn't get cluttered by a one-off
// hired item, nor drop a category just because it happens to be at 0 right
// now. Numbers per type are live; this list of *which types show up* is not.
export const STANDING_RENTAL_TYPES = [
  "Excavator",
  "Dumper / Tipper",
  "Backhoe Loader (JCB)",
  "Tractor",
  "Concrete Boom Placer",
  "Self-Loading Mixer (Ajax)",
  "Trailer",
  "Bus",
  "Car / Jeep",
  "Baby Roller",
  "DG Set",
] as const;

/** Build the live "what do we rent every month" table straight off the
    machines register, for the fixed STANDING_RENTAL_TYPES categories — one
    row per type, even if nothing of that type is currently hired. */
export function standingDemandFromFleet(machines: Machine[]): StandingDemand[] {
  interface Acc {
    units: number;
    sites: Set<string>;
    rent: number;
    shraddhaUnits: number;
    shraddhaRent: number;
    missingRentUnits: number;
  }
  const trackedTypes = new Set<string>(STANDING_RENTAL_TYPES);
  const byType = new Map<string, Acc>(
    STANDING_RENTAL_TYPES.map((t) => [
      t,
      { units: 0, sites: new Set<string>(), rent: 0, shraddhaUnits: 0, shraddhaRent: 0, missingRentUnits: 0 },
    ]),
  );

  for (const m of machines) {
    if (!m.is_active || m.ownership !== "external") continue;
    if (!trackedTypes.has(m.machine_type)) continue;
    const acc = byType.get(m.machine_type)!;
    const rent = m.monthly_rent ?? 0;
    const isShraddha = SHRADDHA_VENDOR_RE.test(m.vendor_name ?? "");

    acc.units += 1;
    acc.sites.add(m.project_id);
    acc.rent += rent;
    if (m.monthly_rent == null) acc.missingRentUnits += 1;
    if (isShraddha) {
      acc.shraddhaUnits += 1;
      acc.shraddhaRent += rent;
    }
  }

  return STANDING_RENTAL_TYPES.map((machineType) => {
    const acc = byType.get(machineType)!;
    return {
      machineType,
      unitsRented: acc.units,
      sites: acc.sites.size,
      monthlyRent: acc.rent,
      shraddhaUnits: acc.shraddhaUnits || undefined,
      shraddhaMonthlyRent: acc.shraddhaRent || undefined,
      missingRentUnits: acc.missingRentUnits,
    };
  });
}

export type OwnVsRentCall = "buy-strong" | "buy-consider" | "rent" | "no-cost-data";

export interface OwnVsRentRow {
  machineType: string;
  /** Gross units/rent across all vendors, incl. Shraddha — shown for context. */
  unitsRented: number;
  sites: number;
  monthlyRent: number;
  annualRent: number;
  ownedNow: number;
  cost: CostProfile | null;
  /** Units/month rented from Shraddha (sister company) — carved out below
      because it isn't genuine market dependency. */
  shraddhaUnits: number;
  shraddhaMonthlyRent: number;
  /** External-vendor-only units/rent — what actually drives the call. */
  externalUnits: number;
  externalMonthlyRent: number;
  /** Per-unit payback in months at the ACTUAL average rent we pay
      external vendors for this type (external rent ÷ external units),
      which can differ from the cost sheet's single headline rate. */
  perUnitPaybackMonths: number | null;
  call: OwnVsRentCall;
  /** External units of this type with no monthly_rent entered — the rent
      figures above undercount by this much until someone fills it in. */
  missingRentUnits: number;
}

// Own the persistent base when the demand is genuinely standing (several
// units every month) and each unit pays back inside a normal ownership
// horizon; take the cheap-payback single units too; otherwise keep renting.
const BUY_HORIZON_MONTHS = 42;
const CHEAP_PAYBACK_MONTHS = 24;
const STANDING_UNITS = 3;

export function fleetOwnVsRent(machines: Machine[]): OwnVsRentRow[] {
  const ownedByType = new Map<string, number>();
  for (const m of machines) {
    if (m.is_active && m.ownership === "internal") {
      ownedByType.set(m.machine_type, (ownedByType.get(m.machine_type) ?? 0) + 1);
    }
  }

  return standingDemandFromFleet(machines).map((d) => {
    const shraddhaUnits = d.shraddhaUnits ?? 0;
    const shraddhaMonthlyRent = d.shraddhaMonthlyRent ?? 0;
    const externalUnits = d.unitsRented - shraddhaUnits;
    const externalMonthlyRent = d.monthlyRent - shraddhaMonthlyRent;

    const cost = costProfileFor(d.machineType);
    const perUnitRent = externalUnits > 0 ? externalMonthlyRent / externalUnits : 0;
    const perUnitPaybackMonths =
      cost && perUnitRent > 0 ? Math.round(cost.purchasePrice / perUnitRent) : null;

    let call: OwnVsRentCall;
    if (!cost || perUnitPaybackMonths == null) {
      call = "no-cost-data";
    } else if (externalUnits >= STANDING_UNITS && perUnitPaybackMonths <= BUY_HORIZON_MONTHS) {
      call = "buy-strong";
    } else if (perUnitPaybackMonths <= CHEAP_PAYBACK_MONTHS) {
      call = "buy-consider";
    } else {
      call = "rent";
    }

    return {
      machineType: d.machineType,
      unitsRented: d.unitsRented,
      sites: d.sites,
      monthlyRent: d.monthlyRent,
      annualRent: d.monthlyRent * 12,
      ownedNow: ownedByType.get(d.machineType) ?? 0,
      cost,
      shraddhaUnits,
      shraddhaMonthlyRent,
      externalUnits,
      externalMonthlyRent,
      perUnitPaybackMonths,
      call,
      missingRentUnits: d.missingRentUnits,
    };
  }).sort((a, b) => b.annualRent - a.annualRent);
}

// ---- Relocation proxy — a machine idle in Rajkot isn't free for a
// Jamnagar job. We can't cost a move exactly, so we tier it by geography
// from each site's state/city. ----
export type RelocationTier = "local" | "in-state" | "cross-state" | "unknown";

export interface SiteMeta {
  state: string | null;
  city: string | null;
}

export function relocationTier(
  fromId: string,
  toId: string,
  siteMeta: Map<string, SiteMeta>,
): RelocationTier {
  if (fromId === toId) return "local";
  const a = siteMeta.get(fromId);
  const b = siteMeta.get(toId);
  if (!a || !b || !a.state || !b.state) return "unknown";
  if (a.city && b.city && a.city.toLowerCase() === b.city.toLowerCase()) return "local";
  if (a.state === b.state) return "in-state";
  return "cross-state";
}

function monthsBetween(fromISO: string, toISO: string): number {
  const ms = new Date(`${toISO}T00:00:00`).getTime() - new Date(`${fromISO}T00:00:00`).getTime();
  return ms / (1000 * 60 * 60 * 24 * 30.4368);
}

export type CandidateAvailability = "idle-now" | "frees-in-time" | "frees-late" | "no-visibility";

export interface Candidate {
  machine: Machine;
  availability: CandidateAvailability;
  /** Days from needed_from until this machine frees (negative/0 = already free). */
  daysUntilFree: number | null;
  /** Geographic effort to move this machine to the requirement's site. */
  relocation: RelocationTier;
}

export type PlanVerdict =
  | { kind: "reassign"; used: Candidate[] }
  | { kind: "reassign-with-gap"; used: Candidate[]; gapDays: number }
  | { kind: "rent"; shortfall: number; cost: CostProfile }
  | { kind: "buy"; shortfall: number; cost: CostProfile }
  | { kind: "undetermined"; shortfall: number };

export interface Recommendation {
  requirement: SiteRequirement;
  candidates: Candidate[];
  durationMonths: number | null;
  verdict: PlanVerdict;
}

/** Is this machine sitting in a non-productive holding pool right now
    (Central Store), as opposed to actively deployed at a working site? */
function isIdleNow(m: Machine, siteCodeById: Map<string, string | null>): boolean {
  return siteCodeById.get(m.project_id) === "STORE";
}

export function recommend(
  requirement: SiteRequirement,
  allMachines: Machine[],
  siteCodeById: Map<string, string | null>,
  siteMeta: Map<string, SiteMeta>,
): Recommendation {
  const pool = allMachines.filter(
    (m) => m.is_active && m.ownership === "internal" && m.machine_type === requirement.machine_type,
  );

  const candidates: Candidate[] = pool.map((m) => {
    const idle = isIdleNow(m, siteCodeById);
    let availability: CandidateAvailability;
    let daysUntilFree: number | null;

    if (idle) {
      availability = "idle-now";
      daysUntilFree = 0;
    } else if (m.so_until) {
      const days = Math.round(
        (new Date(`${m.so_until}T00:00:00`).getTime() - new Date(`${requirement.needed_from}T00:00:00`).getTime()) /
          86_400_000,
      );
      daysUntilFree = days;
      if (days <= 0) availability = "idle-now";
      else if (!requirement.needed_until || m.so_until <= requirement.needed_until) availability = "frees-in-time";
      else availability = "frees-late";
    } else {
      availability = "no-visibility";
      daysUntilFree = null;
    }
    const relocation = relocationTier(m.project_id, requirement.project_id, siteMeta);
    return { machine: m, availability, daysUntilFree, relocation };
  });

  // Rank: already-idle / already-free first, then soonest-to-free, then
  // "frees but past your window", no-visibility machines last. Within the
  // same availability, prefer the machine that's cheapest to move.
  const rank: Record<CandidateAvailability, number> = {
    "idle-now": 0,
    "frees-in-time": 1,
    "frees-late": 2,
    "no-visibility": 3,
  };
  const moveRank: Record<RelocationTier, number> = {
    local: 0,
    "in-state": 1,
    unknown: 2,
    "cross-state": 3,
  };
  candidates.sort((a, b) => {
    if (rank[a.availability] !== rank[b.availability]) return rank[a.availability] - rank[b.availability];
    if (moveRank[a.relocation] !== moveRank[b.relocation]) return moveRank[a.relocation] - moveRank[b.relocation];
    return (a.daysUntilFree ?? Infinity) - (b.daysUntilFree ?? Infinity);
  });

  const usable = candidates.filter(
    (c) => c.availability === "idle-now" || c.availability === "frees-in-time",
  );
  const used = usable.slice(0, requirement.quantity);
  const shortfall = Math.max(0, requirement.quantity - used.length);

  const durationMonths = requirement.needed_until
    ? Math.round(monthsBetween(requirement.needed_from, requirement.needed_until) * 10) / 10
    : null;

  let verdict: PlanVerdict;
  if (shortfall === 0) {
    const worstGapDays = Math.max(0, ...used.map((c) => c.daysUntilFree ?? 0));
    verdict =
      worstGapDays > 0
        ? { kind: "reassign-with-gap", used, gapDays: worstGapDays }
        : { kind: "reassign", used };
  } else {
    const cost = costProfileFor(requirement.machine_type);
    if (!cost) {
      verdict = { kind: "undetermined", shortfall };
    } else if (durationMonths == null || durationMonths >= cost.breakevenMonths) {
      verdict = { kind: "buy", shortfall, cost };
    } else {
      verdict = { kind: "rent", shortfall, cost };
    }
  }

  return { requirement, candidates, durationMonths, verdict };
}
