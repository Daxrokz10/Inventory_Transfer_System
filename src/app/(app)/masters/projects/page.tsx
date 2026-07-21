import { createClient } from "@/lib/supabase/server";

const qty = (n: number) =>
  n === 0 ? "" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

type Search = { group?: string; q?: string };

export default async function ClosingBalancePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role, home_project_id").eq("id", user!.id).single()
    : { data: null };
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  const homeProjectId = profile?.home_project_id ?? null;

  let balQuery = supabase.from("stock_balances").select("project_id, item_id, on_hand");
  if (!isAdmin && homeProjectId) balQuery = balQuery.eq("project_id", homeProjectId);

  const [{ data: balances }, { data: items }, { data: projects }] = await Promise.all([
    balQuery,
    supabase.from("items").select("id, code, description, main_group, unit").order("code"),
    supabase.from("projects").select("id, code, name").order("code"),
  ]);

  const itemMap = new Map((items ?? []).map((i) => [i.id, i]));
  const projMap = new Map((projects ?? []).map((p) => [p.id, p]));

  // J-0000 is the reserved purchase source, not a real site holding inventory.
  const purchaseProjectId = (projects ?? []).find((p) => p.code === "J-0000")?.id ?? null;

  // main-group list for the filter
  const groups = [...new Set((items ?? []).map((i) => i.main_group).filter(Boolean))].sort() as string[];

  // pivot: itemId -> projectId -> on_hand ; track which items/sites hold stock
  const pivot = new Map<string, Map<string, number>>();
  const siteTotals = new Map<string, number>();
  const itemsWithStock = new Set<string>();
  for (const b of balances ?? []) {
    if (b.project_id === purchaseProjectId) continue; // exclude purchase source
    const v = Number(b.on_hand);
    if (!v) continue;
    itemsWithStock.add(b.item_id);
    if (!pivot.has(b.item_id)) pivot.set(b.item_id, new Map());
    pivot.get(b.item_id)!.set(b.project_id, v);
    siteTotals.set(b.project_id, (siteTotals.get(b.project_id) ?? 0) + v);
  }

  // columns = sites holding stock (scoped), sorted by code
  const siteCols = (projects ?? [])
    .filter((p) => siteTotals.has(p.id))
    .sort((a, b) => a.code.localeCompare(b.code));

  // rows = items holding stock, filtered by group + search
  const search = (sp.q ?? "").trim().toLowerCase();
  let rowItems = [...itemsWithStock]
    .map((id) => itemMap.get(id))
    .filter((it): it is NonNullable<typeof it> => Boolean(it));
  if (sp.group) rowItems = rowItems.filter((it) => it.main_group === sp.group);
  if (search)
    rowItems = rowItems.filter(
      (it) => it.code.toLowerCase().includes(search) || (it.description ?? "").toLowerCase().includes(search),
    );
  rowItems.sort((a, b) => a.code.localeCompare(b.code));

  const th = "border border-line px-2 py-1.5 text-xs font-semibold text-ink-2 whitespace-nowrap";
  const td = "border border-line px-2 py-1 text-xs text-right tabular-nums whitespace-nowrap";

  const exportParams = new URLSearchParams();
  if (sp.group) exportParams.set("group", sp.group);
  if (sp.q) exportParams.set("q", sp.q);
  const exportHref = `/api/closing-balance/export${exportParams.size ? `?${exportParams.toString()}` : ""}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Closing balance</h1>
          <p className="mt-1 text-sm text-ink-2">
            Live on-hand quantity of every item at every site — computed from the ledger, always ties out.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink-2">
            {rowItems.length} items × {siteCols.length} sites
          </span>
          <a
            href={exportHref}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-strong"
          >
            Download Excel
          </a>
        </div>
      </div>

      {/* Filters */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Main group
          <select
            name="group"
            defaultValue={sp.group ?? ""}
            className="rounded-lg border border-line-strong px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Search item
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="code or description"
            className="rounded-lg border border-line-strong px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong">
          Apply
        </button>
        <a href="/masters/projects" className="px-2 py-2 text-sm text-ink-2 hover:underline">
          Reset
        </a>
      </form>

      <div className="overflow-auto rounded-lg border border-line bg-surface shadow-sm" style={{ maxHeight: "72vh" }}>
        {rowItems.length === 0 || siteCols.length === 0 ? (
          <p className="p-6 text-sm text-ink-2">No stock to show for this filter.</p>
        ) : (
          <table className="border-collapse text-xs">
            <thead className="sticky top-0 z-20 bg-surface-2">
              <tr>
                <th className={`${th} sticky left-0 z-30 bg-surface-2 text-left`} style={{ minWidth: "16rem" }}>
                  Item
                </th>
                {siteCols.map((s) => (
                  <th key={s.id} className={th} title={s.name}>
                    {s.code}
                  </th>
                ))}
                <th className={`${th} bg-surface-2`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rowItems.map((it) => {
                const row = pivot.get(it.id)!;
                const rowTotal = [...row.values()].reduce((s, v) => s + v, 0);
                return (
                  <tr key={it.id} className="hover:bg-accent-soft/40">
                    <td className="sticky left-0 z-10 border border-line bg-surface px-2 py-1 text-left" style={{ minWidth: "16rem" }}>
                      <span className="font-medium text-ink">{it.code}</span>
                      <span className="ml-1.5 text-ink-2">{it.description}</span>
                    </td>
                    {siteCols.map((s) => {
                      const v = row.get(s.id) ?? 0;
                      return (
                        <td key={s.id} className={`${td} ${v < 0 ? "text-danger font-medium" : "text-ink-2"}`}>
                          {qty(v)}
                        </td>
                      );
                    })}
                    <td className={`${td} bg-surface-2 font-semibold text-ink`}>{qty(rowTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 bg-surface-2">
              <tr>
                <td className="sticky left-0 z-10 border border-line bg-surface-2 px-2 py-1.5 text-left text-xs font-semibold text-ink-2" style={{ minWidth: "16rem" }}>
                  Site total (all items)
                </td>
                {siteCols.map((s) => (
                  <td key={s.id} className={`${td} font-semibold text-ink-2`}>
                    {qty(siteTotals.get(s.id) ?? 0)}
                  </td>
                ))}
                <td className={`${td} bg-surface-2 font-bold`}>
                  {qty([...siteTotals.values()].reduce((s, v) => s + v, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
