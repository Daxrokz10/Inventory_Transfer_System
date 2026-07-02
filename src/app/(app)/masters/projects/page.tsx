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

  // main-group list for the filter
  const groups = [...new Set((items ?? []).map((i) => i.main_group).filter(Boolean))].sort() as string[];

  // pivot: itemId -> projectId -> on_hand ; track which items/sites hold stock
  const pivot = new Map<string, Map<string, number>>();
  const siteTotals = new Map<string, number>();
  const itemsWithStock = new Set<string>();
  for (const b of balances ?? []) {
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

  const th = "border border-gray-200 px-2 py-1.5 text-xs font-semibold text-gray-500 whitespace-nowrap";
  const td = "border border-gray-100 px-2 py-1 text-xs text-right tabular-nums whitespace-nowrap";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Closing balance</h1>
          <p className="mt-1 text-sm text-gray-500">
            Live on-hand quantity of every item at every site — computed from the ledger, always ties out.
          </p>
        </div>
        <span className="text-sm text-gray-500">
          {rowItems.length} items × {siteCols.length} sites
        </span>
      </div>

      {/* Filters */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Main group
          <select
            name="group"
            defaultValue={sp.group ?? ""}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Search item
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="code or description"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Apply
        </button>
        <a href="/masters/projects" className="px-2 py-2 text-sm text-gray-500 hover:underline">
          Reset
        </a>
      </form>

      <div className="overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm" style={{ maxHeight: "72vh" }}>
        {rowItems.length === 0 || siteCols.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">No stock to show for this filter.</p>
        ) : (
          <table className="border-collapse text-xs">
            <thead className="sticky top-0 z-20 bg-gray-50">
              <tr>
                <th className={`${th} sticky left-0 z-30 bg-gray-50 text-left`} style={{ minWidth: "16rem" }}>
                  Item
                </th>
                {siteCols.map((s) => (
                  <th key={s.id} className={th} title={s.name}>
                    {s.code}
                  </th>
                ))}
                <th className={`${th} bg-gray-100`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rowItems.map((it) => {
                const row = pivot.get(it.id)!;
                const rowTotal = [...row.values()].reduce((s, v) => s + v, 0);
                return (
                  <tr key={it.id} className="hover:bg-blue-50/40">
                    <td className="sticky left-0 z-10 border border-gray-100 bg-white px-2 py-1 text-left" style={{ minWidth: "16rem" }}>
                      <span className="font-medium text-gray-800">{it.code}</span>
                      <span className="ml-1.5 text-gray-500">{it.description}</span>
                    </td>
                    {siteCols.map((s) => {
                      const v = row.get(s.id) ?? 0;
                      return (
                        <td key={s.id} className={`${td} ${v < 0 ? "text-red-600 font-medium" : "text-gray-700"}`}>
                          {qty(v)}
                        </td>
                      );
                    })}
                    <td className={`${td} bg-gray-50 font-semibold text-gray-900`}>{qty(rowTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 bg-gray-50">
              <tr>
                <td className="sticky left-0 z-10 border border-gray-200 bg-gray-50 px-2 py-1.5 text-left text-xs font-semibold text-gray-600" style={{ minWidth: "16rem" }}>
                  Site total (all items)
                </td>
                {siteCols.map((s) => (
                  <td key={s.id} className={`${td} font-semibold text-gray-700`}>
                    {qty(siteTotals.get(s.id) ?? 0)}
                  </td>
                ))}
                <td className={`${td} bg-gray-100 font-bold`}>
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
