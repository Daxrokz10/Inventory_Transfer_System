export interface Machine {
  id: string;
  project_id: string;
  name: string;
  machine_type: string;
  registration_no: string | null;
  reading_type: "km" | "hours";
  fuel_type: "diesel" | "petrol";
  ownership: "internal" | "external";
  vendor_name: string | null;
  /** What we pay per month for this hired unit — the input the Own vs Rent
      panel sums per machine_type to judge buy-vs-rent. Null for internal
      machines, and for external ones not yet priced. */
  monthly_rent: number | null;
  tank_capacity_liters: number | null;
  is_active: boolean;
  /** False for assets whose fuel isn't tracked — electric/no-engine items
      (silos, batching plants, tower cranes) and office vehicles. They're
      still tracked as assets but stay off the daily fuel report. */
  track_fuel: boolean;
  /** True if this machine gets a reading (km/hours) field on the daily
      report, independent of track_fuel — e.g. batching plants log hours
      but consume no diesel we track. */
  track_meter: boolean;
  /** Persistent latest known meter reading — the single source of truth
      independent of which day's report last touched it. */
  current_reading: number | null;
  current_reading_at: string | null;
  /** When the machine's current deployment at its current site began.
      Reset to "today" whenever it's transferred. */
  deployed_at: string | null;
  /** Date the SO (Supply Order) / authorization to keep this machine at
      its current site expires. Null = no deadline (permanent fixture).
      Cleared on transfer. */
  so_until: string | null;
  /** Set by a site supervisor when the physical odometer/hour-meter
      fails. Only an admin can clear it — see set_meter_broken() RPC. */
  meter_broken: boolean;
}

export type SoStatus =
  | { state: "none" }
  | { state: "ok"; days: number }
  | { state: "soon"; days: number }
  | { state: "expired"; days: number };

/** Warn this many days before the SO date as it approaches. */
export const SO_SOON_DAYS = 7;

/** Classify a machine's SO deadline relative to `today` (defaults to now).
    `days` is whole days until (ok/soon) or since (expired) the deadline. */
export function soStatus(
  machine: Pick<Machine, "so_until">,
  today: Date = new Date(),
): SoStatus {
  if (!machine.so_until) return { state: "none" };
  // Compare at day granularity in the machine's stored (date-only) terms.
  const t0 = Date.parse(`${machine.so_until}T00:00:00`);
  const nowDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.floor((t0 - nowDay.getTime()) / 86_400_000);
  if (diffDays < 0) return { state: "expired", days: -diffDays };
  if (diffDays <= SO_SOON_DAYS) return { state: "soon", days: diffDays };
  return { state: "ok", days: diffDays };
}

export interface DailyLog {
  id: string;
  machine_id: string;
  project_id: string;
  log_date: string;
  opening_reading: number | null;
  closing_reading: number | null;
  opening_mismatch_reason: string | null;
  fuel_issued_liters: number;
  rate_per_liter: number | null;
  total_cost: number | null;
  remarks: string | null;
  entered_by: string | null;
  created_at: string;
  /** "breakdown"/"maintenance" days don't need a reading or fuel entry —
      they just record why the machine wasn't in normal use that day. */
  status: "normal" | "breakdown" | "maintenance";
  /** Where a fill came from, relative to this site's own barrel stock:
      'on_site' = drawn from a barrel delivered here (the default everywhere
      except the two Shraddha-pump sites); 'shraddha' = filled at the sister
      company's pump (those two sites' normal source); 'outside' = the
      vehicle drove out and filled at a pump not tied to this site's stock.
      Null when no fuel was issued. Cost is the API day-rate regardless.
      Only 'on_site' (and legacy null) fills count against the site's
      barrel balance in the Diesel Register — see register.ts. */
  fuel_source: "on_site" | "shraddha" | "outside" | null;
}

export interface SiteRequirement {
  id: string;
  project_id: string;
  machine_type: string;
  quantity: number;
  needed_from: string;
  /** null = open-ended / ongoing need — no defined end date. */
  needed_until: string | null;
  status: "open" | "fulfilled" | "cancelled";
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MachineRequest {
  id: string;
  machine_id: string;
  project_id: string;
  type: "renewal" | "removal";
  note: string | null;
  status: "pending" | "approved" | "rejected";
  requested_by: string | null;
  created_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

// A barrel / diesel delivery arriving on site (procurement) — separate
// from daily_logs, which is fuel issued to machines (consumption).
export interface FuelReceipt {
  id: string;
  project_id: string;
  receipt_date: string;
  liters: number;
  /** Number of drums, if counted — informational; liters is authoritative. */
  barrels: number | null;
  rate_per_liter: number | null;
  total_cost: number | null;
  vendor: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  fuel_type: "diesel" | "petrol";
}

export interface AnomalyFlag {
  id: string;
  log_id: string;
  type: string;
  severity: "low" | "medium" | "high";
  message: string;
  resolved: boolean;
  created_at: string;
}

export interface FuelPrice {
  price_date: string;
  /** City name (goodreturns.in is queried per city, not state). */
  location: string;
  fuel_type: "diesel" | "petrol";
  price: number;
  source: string;
}

/** Unit the meter reading is measured in ("km" or "hr"). */
export function readingUnit(machine: Pick<Machine, "reading_type">) {
  return machine.reading_type === "hours" ? "hr" : "km";
}

/** Efficiency unit label, e.g. "km/L" for vehicles, "L/hr" for DG sets. */
export function efficiencyUnit(machine: Pick<Machine, "reading_type">) {
  return machine.reading_type === "hours" ? "L/hr" : "km/L";
}

/** Machine types whose meter is always hours, never km — physically these
    run on an engine-hour meter (or an odometer makes no sense at all, e.g.
    a static batching plant), so the "Metered by" choice isn't a per-machine
    judgment call at registration time the way it is for a vehicle. */
export const HOURS_METERED_TYPES = new Set<string>([
  "DG Set",
  "Excavator",
  "Backhoe Loader (JCB)",
  "Self-Loading Mixer (Ajax)",
  "Tower Crane",
  "Mobile Crane",
  "Batching Plant",
  "Concrete Pump",
  "Concrete Boom Placer",
  "Transit Mixer",
  "Baby Roller",
  "Vibratory Roller",
  "Walk Behind Roller",
]);

export const MACHINE_TYPES = [
  "Excavator",
  "Backhoe Loader (JCB)",
  "Paver",
  "DG Set",
  "Concrete Mixer",
  "Transit Mixer",
  "Concrete Pump",
  "Concrete Boom Placer",
  "Batching Plant",
  "Tower Crane",
  "Mobile Crane",
  "Truck",
  "Tempo Traveller",
  "Dumper / Tipper",
  "Water Tanker",
  "Tractor",
  "Trailer",
  "Pickup",
  "Car / Jeep",
  "Bike / Scooter",
  "Bus",
  "Baby Roller",
  "Vibratory Roller",
  "Walk Behind Roller",
  "Dewatering Pump",
  "Other",
] as const;

/** Indian states & UTs — the value stored on projects.state and used to
    query the fuel price API. */
export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;

/** Each state maps to one major city used to query goodreturns.in for a
    representative daily price — verified for the states actually in use
    (Gujarat, Punjab, West Bengal, Madhya Pradesh, Uttar Pradesh,
    Jharkhand, Maharashtra, Andhra Pradesh); the rest are a best-effort
    state-capital/largest-city guess and should be spot-checked
    (https://www.goodreturns.in/petrol-price-in-<city-slug>.html) before
    relying on them. */
export const STATE_REFERENCE_CITY: Record<(typeof INDIAN_STATES)[number], string> = {
  "Andhra Pradesh": "Vijayawada",
  "Arunachal Pradesh": "Itanagar",
  Assam: "Guwahati",
  Bihar: "Patna",
  Chhattisgarh: "Raipur",
  Goa: "Panaji",
  Gujarat: "Ahmedabad",
  Haryana: "Gurugram",
  "Himachal Pradesh": "Shimla",
  Jharkhand: "Ranchi",
  Karnataka: "Bengaluru",
  Kerala: "Kochi",
  "Madhya Pradesh": "Indore",
  Maharashtra: "Mumbai",
  Manipur: "Imphal",
  Meghalaya: "Shillong",
  Mizoram: "Aizawl",
  Nagaland: "Kohima",
  Odisha: "Bhubaneswar",
  Punjab: "Ludhiana",
  Rajasthan: "Jaipur",
  Sikkim: "Gangtok",
  "Tamil Nadu": "Chennai",
  Telangana: "Hyderabad",
  Tripura: "Agartala",
  "Uttar Pradesh": "Lucknow",
  Uttarakhand: "Dehradun",
  "West Bengal": "Kolkata",
  "Andaman and Nicobar Islands": "Port Blair",
  Chandigarh: "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu": "Daman",
  Delhi: "Delhi",
  "Jammu and Kashmir": "Srinagar",
  Ladakh: "Leh",
  Lakshadweep: "Kavaratti",
  Puducherry: "Puducherry",
};

/** Resolve a site's state to the city used for its fuel-price lookup. */
export function cityForState(state: string | null): string | null {
  if (!state) return null;
  return (STATE_REFERENCE_CITY as Record<string, string>)[state] ?? null;
}
