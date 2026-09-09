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
  const [{ data: machinesRaw }, { data: logsRaw }, { data: transfersRaw }, { data: originTransfersRaw }, { data: projectsRaw }] =
    await Promise.all([
      supabase
        .from("machines")
        .select("id, name, registration_no, machine_type, ownership, is_active, project_id, deployed_at"),
      supabase
        .from("daily_logs")
        .select("machine_id, project_id, log_date")
        .gte("log_date", monthStart)
        .lte("log_date", monthEnd)
        .order("log_date", { ascending: true }),
      supabase
        .from("machine_transfers")
        .select("machine_id, from_project_id, to_project_id, transferred_at")
        .gte("transferred_at", monthStart)
        .lte("transferred_at", monthEnd)
        .order("transferred_at", { ascending: true }),
      // Unbounded below monthEnd — used only to answer "where did the
      // month's FIRST stay come from," which may well be a transfer from
      // an earlier month, not this one.
      supabase
        .from("machine_transfers")
        .select("machine_id, from_project_id, to_project_id, transferred_at")
        .lte("transferred_at", monthEnd)
        .order("transferred_at", { ascending: true }),
      supabase.from("projects").select("id, name, code"),
    ]);

  const projectLabel = new Map(
    (projectsRaw ?? []).map((p) => [p.id as string, p.code ? `${p.code} · ${p.name}` : (p.name as string)]),
  );
  const labelFor = (id: string) => projectLabel.get(id) ?? "—";

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
  };

  // Ordered, deduped project_ids per machine with their first/last log date
  // this month — logs already arrive oldest-first from the query above.
  const loggedSitesByMachine = new Map<string, { project_id: string; from_date: string; to_date: string }[]>();
  for (const l of (logsRaw ?? []) as LogRow[]) {
    const list = loggedSitesByMachine.get(l.machine_id) ?? [];
    const existing = list.find((s) => s.project_id === l.project_id);
    if (existing) existing.to_date = l.log_date;
    else list.push({ project_id: l.project_id, from_date: l.log_date, to_date: l.log_date });
    loggedSitesByMachine.set(l.machine_id, list);
  }

  const transfersByMachine = new Map<string, TransferRow[]>();
  for (const t of (transfersRaw ?? []) as TransferRow[]) {
    (transfersByMachine.get(t.machine_id) ?? transfersByMachine.set(t.machine_id, []).get(t.machine_id)!).push(t);
  }

  // All transfers up to month end, ascending — used to find what a
  // machine's month-opening site was transferred FROM, even if that
  // transfer happened before this month.
  const originTransfersByMachine = new Map<string, TransferRow[]>();
  for (const t of (originTransfersRaw ?? []) as TransferRow[]) {
    (originTransfersByMachine.get(t.machine_id) ?? originTransfersByMachine.set(t.machine_id, []).get(t.machine_id)!).push(t);
  }
  function originOf(
    machineId: string,
    intoProjectId: string,
    onOrBefore: string,
  ): { label: string; date: string } | null {
    const list = originTransfersByMachine.get(machineId) ?? [];
    let best: TransferRow | null = null;
    for (const t of list) {
      if (t.to_project_id === intoProjectId && t.transferred_at <= onOrBefore) {
        if (!best || t.transferred_at > best.transferred_at) best = t;
      }
    }
    return best?.from_project_id ? { label: labelFor(best.from_project_id), date: best.transferred_at } : null;
  }

  const results: MachineSiteMonth[] = [];
  for (const m of (machinesRaw ?? []) as MachineRow[]) {
    const logged = loggedSitesByMachine.get(m.id) ?? [];
    const transfers = transfersByMachine.get(m.id) ?? [];

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
      }));
    } else if (m.deployed_at && m.deployed_at <= monthEnd) {
      // No activity this month at all — fall back to "still at its current
      // site," but only when it was already deployed there before this
      // month ended (otherwise we'd be guessing at a site it may not have
      // reached yet).
      stays = [
        {
          project_id: m.project_id,
          site_label: labelFor(m.project_id),
          source: "inferred",
          from_date: m.deployed_at >= monthStart ? m.deployed_at : null,
          to_date: null,
          moved_from_label: null,
          moved_from_date: null,
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
