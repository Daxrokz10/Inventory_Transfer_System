import type { SupabaseClient } from "@supabase/supabase-js";

/* Where a machine was, month by month — built for the History page so an
   admin can ask "what was on site X in month Y" or "where has machine Z
   been." There's no table that recorded this before now, so past months
   are reconstructed from daily_logs' own project_id per date: every fuel
   entry already says which site it happened at, so a machine logging fuel
   at two different sites in one month unambiguously means it moved between
   them. machine_transfers (new) supplements this for the rarer case where
   a machine changed sites but logged no fuel that month — and going
   forward, every transfer through transferMachine() writes an exact date
   there instead of leaving it to be inferred. */

export interface SiteStay {
  project_id: string;
  site_label: string;
  /** How this stay is known:
      - "logged": at least one daily_logs entry this month at this site —
        the strongest evidence, with real dates attached.
      - "transferred": no fuel logged this month, but a machine_transfers
        row moved it here — exact date, just no usage evidence yet.
      - "inferred": no logs and no recorded transfer this month at all —
        falls back to the machine's current site, on the assumption
        nothing changed. Least certain; flagged as such in the UI. */
  source: "logged" | "transferred" | "inferred";
  /** First date within the month this stay is evidenced by (a log date or
      the transfer date). Null only for a pure "inferred" stay with no
      transfer date to anchor it. Doubles as "arrived around this date." */
  from_date: string | null;
  /** Last log date within the month at this site — "logged" stays only. */
  to_date: string | null;
  /** Where it came from, if known — either a matching machine_transfers
      row (possibly from an earlier month, found by looking backward from
      from_date) or, for a stay that isn't the machine's first this month,
      simply the previous stay's site (its own logs already prove that
      move happened). Null when nothing pins down an origin. */
  moved_from_label: string | null;
  /** The transfer's own recorded date, when moved_from_label came from an
      actual machine_transfers row rather than being inferred from the
      previous stay (in which case from_date is the best approximation
      already shown alongside the site). */
  moved_from_date: string | null;
  /** Sister group sites whose account filed this stay's fuel logs — the
      machine was placed at its own registered site regardless, since in a
      group one site's login often files for all of them. */
  filed_from_labels: string[];
}

export interface MachineSiteMonth {
  machine_id: string;
  machine_name: string;
  registration_no: string | null;
  machine_type: string;
  ownership: "internal" | "external";
  is_active: boolean;
  /** Chronological — more than one entry means the machine moved sites
      during the month. */
  stays: SiteStay[];
}

/** `monthStart`/`monthEnd` are "YYYY-MM-DD" bounding one calendar month.
    `siteFilter` narrows to machines that had a stay at that site during
    the month (either end of a move counts). */
export async function fetchSiteHistory(
  supabase: SupabaseClient,
  monthStart: string,
  monthEnd: string,
  siteFilter: string | null,
): Promise<MachineSiteMonth[]> {
  // A month's fleet-wide logs run well past PostgREST's silent 1000-row
  // cap, so page through them rather than lose the month's tail.
  async function fetchMonthLogs(): Promise<unknown[]> {
    const all: unknown[] = [];
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from("daily_logs")
        .select("machine_id, project_id, log_date")
        .gte("log_date", monthStart)
        .lte("log_date", monthEnd)
        .order("log_date", { ascending: true })
        .order("id", { ascending: true })
        .range(page * 1000, page * 1000 + 999);
      all.push(...(data ?? []));
      if (!data || data.length < 1000) return all;
    }
  }

  const [{ data: machinesRaw }, logsRaw, { data: transfersRaw }, { data: allTransfersRaw }, { data: projectsRaw }] =
    await Promise.all([
      supabase
        .from("machines")
        .select("id, name, registration_no, machine_type, ownership, is_active, project_id, deployed_at, created_at")
        .range(0, 9999),
      fetchMonthLogs(),
      supabase
        .from("machine_transfers")
        .select("machine_id, from_project_id, to_project_id, transferred_at")
        .gte("transferred_at", monthStart)
        .lte("transferred_at", monthEnd)
        .order("transferred_at", { ascending: true }),
      // Every transfer ever — used to answer "where did the month's FIRST
      // stay come from" (maybe an earlier month) and "which site was this
      // machine registered to on a given date" (needs later ones too).
      supabase
        .from("machine_transfers")
        .select("machine_id, from_project_id, to_project_id, transferred_at")
        .order("transferred_at", { ascending: true })
        .range(0, 9999),
      supabase.from("projects").select("id, name, code, group_id, site_groups(share_external)"),
    ]);

  const projectLabel = new Map(
    (projectsRaw ?? []).map((p) => [p.id as string, p.code ? `${p.code} · ${p.name}` : (p.name as string)]),
  );
  const labelFor = (id: string) => projectLabel.get(id) ?? "—";
  // Only "shared" groups (share_external — one person runs every site in
  // it, e.g. AMNS filing everything from J-0081) break the link between
  // filing site and location. In an internal-fleet group like Dahej, each
  // site files for the machines physically there, so the filing site IS
  // the location and is used as-is.
  const sharedGroupOf = new Map(
    ((projectsRaw ?? []) as unknown as {
      id: string;
      group_id: string | null;
      site_groups: { share_external: boolean } | null;
    }[]).map((p) => [p.id, p.group_id && p.site_groups?.share_external ? p.group_id : null]),
  );
  const sameSharedGroup = (a: string, b: string) =>
    a === b || (!!sharedGroupOf.get(a) && sharedGroupOf.get(a) === sharedGroupOf.get(b));

  type LogRow = { machine_id: string; project_id: string; log_date: string };
  type TransferRow = { machine_id: string; from_project_id: string | null; to_project_id: string; transferred_at: string };
  type MachineRow = {
    id: string;
    name: string;
    registration_no: string | null;
    machine_type: string;
    ownership: "internal" | "external";
    is_active: boolean;
    project_id: string;
    deployed_at: string | null;
    created_at: string;
  };

  const machines = (machinesRaw ?? []) as MachineRow[];
  const machineById = new Map(machines.map((m) => [m.id, m]));

  const allTransfersByMachine = new Map<string, TransferRow[]>();
  for (const t of (allTransfersRaw ?? []) as TransferRow[]) {
    (allTransfersByMachine.get(t.machine_id) ?? allTransfersByMachine.set(t.machine_id, []).get(t.machine_id)!).push(t);
  }

  // The site a machine was registered to on a given date: the last
  // transfer on or before it, else where the first later transfer moved
  // it FROM, else (never transferred) its current site.
  function registeredSiteOn(m: MachineRow, date: string): string {
    const list = allTransfersByMachine.get(m.id) ?? [];
    let last: TransferRow | null = null;
    for (const t of list) if (t.transferred_at <= date) last = t;
    if (last) return last.to_project_id;
    const firstLater = list.find((t) => t.transferred_at > date);
    return firstLater?.from_project_id ?? m.project_id;
  }

  // Where each log puts the machine. A log's project_id is the FILER's
  // site — a real location signal, except inside a shared group where one
  // site's account files for the whole group. There the machine is placed
  // at its own registered site, and the filing site kept as a note.
  const loggedSitesByMachine = new Map<
    string,
    { project_id: string; from_date: string; to_date: string; filed_from: Set<string> }[]
  >();
  for (const l of logsRaw as LogRow[]) {
    const m = machineById.get(l.machine_id);
    if (!m) continue;
    const reg = registeredSiteOn(m, l.log_date);
    const at = sameSharedGroup(l.project_id, reg) ? reg : l.project_id;
    const list = loggedSitesByMachine.get(l.machine_id) ?? [];
    let stay = list.find((s) => s.project_id === at);
    if (stay) stay.to_date = l.log_date;
    else list.push((stay = { project_id: at, from_date: l.log_date, to_date: l.log_date, filed_from: new Set() }));
    if (l.project_id !== at) stay.filed_from.add(l.project_id);
    loggedSitesByMachine.set(l.machine_id, list);
  }

  const transfersByMachine = new Map<string, TransferRow[]>();
  for (const t of (transfersRaw ?? []) as TransferRow[]) {
    (transfersByMachine.get(t.machine_id) ?? transfersByMachine.set(t.machine_id, []).get(t.machine_id)!).push(t);
  }

  // What a machine's month-opening site was transferred FROM, even if that
  // transfer happened before this month.
  function originOf(
    machineId: string,
    intoProjectId: string,
    onOrBefore: string,
  ): { label: string; date: string } | null {
    const list = allTransfersByMachine.get(machineId) ?? [];
    let best: TransferRow | null = null;
    for (const t of list) {
      if (t.to_project_id === intoProjectId && t.transferred_at <= onOrBefore) {
        if (!best || t.transferred_at > best.transferred_at) best = t;
      }
    }
    return best?.from_project_id ? { label: labelFor(best.from_project_id), date: best.transferred_at } : null;
  }

  const results: MachineSiteMonth[] = [];
  for (const m of machines) {
    const logged = loggedSitesByMachine.get(m.id) ?? [];
    const transfers = transfersByMachine.get(m.id) ?? [];
    // Machines registered without a deploy date (e.g. a MISC placeholder)
    // count as deployed from when they were added.
    const deployedOn = m.deployed_at ?? m.created_at.slice(0, 10);

    let stays: SiteStay[];
    if (logged.length > 0) {
      stays = logged.map((s) => ({
        project_id: s.project_id,
        site_label: labelFor(s.project_id),
        source: "logged" as const,
        from_date: s.from_date,
        to_date: s.to_date,
        moved_from_label: null,
        moved_from_date: null,
        filed_from_labels: [...s.filed_from].map(labelFor),
      }));
    } else if (transfers.length > 0) {
      stays = transfers.map((t) => ({
        project_id: t.to_project_id,
        site_label: labelFor(t.to_project_id),
        source: "transferred" as const,
        from_date: t.transferred_at,
        to_date: null,
        moved_from_label: null,
        moved_from_date: null,
        filed_from_labels: [],
      }));
    } else if (deployedOn <= monthEnd) {
      // No activity this month at all — fall back to "still at the site it
      // was registered to then," but only when it was already deployed
      // before this month ended (otherwise we'd be guessing at a site it
      // may not have reached yet).
      const site = registeredSiteOn(m, monthEnd);
      stays = [
        {
          project_id: site,
          site_label: labelFor(site),
          source: "inferred",
          from_date: deployedOn >= monthStart ? deployedOn : null,
          to_date: null,
          moved_from_label: null,
          moved_from_date: null,
          filed_from_labels: [],
        },
      ];
    } else {
      stays = []; // genuinely nothing known for this machine this month
    }

    if (stays.length === 0) continue;
    if (siteFilter && !stays.some((s) => s.project_id === siteFilter)) continue;

    // Fill in where each stay was moved FROM: the first stay's origin comes
    // from the closest matching transfer at or before it (possibly from an
    // earlier month); every later stay in the same month is provably a
    // move from whatever the previous stay was, straight from this
    // machine's own logs.
    stays.forEach((s, i) => {
      if (i === 0) {
        const origin = originOf(m.id, s.project_id, s.from_date ?? monthEnd);
        s.moved_from_label = origin?.label ?? null;
        s.moved_from_date = origin?.date ?? null;
      } else {
        // Later in the same month — the previous stay IS the origin,
        // proven by this machine's own logs, even with no transfer row.
        s.moved_from_label = stays[i - 1].site_label;
        s.moved_from_date = null;
      }
    });

    results.push({
      machine_id: m.id,
      machine_name: m.name,
      registration_no: m.registration_no,
      machine_type: m.machine_type,
      ownership: m.ownership,
      is_active: m.is_active,
      stays,
    });
  }

  results.sort((a, b) => a.machine_name.localeCompare(b.machine_name));
  return results;
}
