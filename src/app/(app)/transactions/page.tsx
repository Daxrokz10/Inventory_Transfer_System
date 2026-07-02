import { createClient } from "@/lib/supabase/server";

const typeStyles: Record<string, string> = {
  OPENING: "bg-gray-100 text-gray-700",
  PURCHASE: "bg-green-100 text-green-800",
  RECEIVE_IN: "bg-blue-100 text-blue-800",
  ISSUE_OUT: "bg-orange-100 text-orange-800",
  ADJUSTMENT: "bg-violet-100 text-violet-800",
};

const LIMIT = 500;

type Search = { site?: string; item?: string; type?: string };

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  // scope: store managers only see their own site
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role, home_project_id").eq("id", user!.id).single()
    : { data: null };
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  const scopedSite = isAdmin ? sp.site : profile?.home_project_id ?? "__none__";

  const [{ data: projects }, { data: items }] = await Promise.all([
    supabase.from("projects").select("id, code, name").order("code"),
    supabase.from("items").select("id, code, description").order("code"),
  ]);

  const projMap = new Map((projects ?? []).map((p) => [p.id, p]));
  const itemMap = new Map((items ?? []).map((i) => [i.id, i]));

  let query = supabase
    .from("ledger_entries")
    .select("project_id, item_id, entry_type, signed_qty, doc_date, counterparty_project_id, source, reference")
    .order("doc_date", { ascending: false, nullsFirst: false })
    .limit(LIMIT);

  if (scopedSite && scopedSite !== "__none__") query = query.eq("project_id", scopedSite);
  if (sp.item) query = query.eq("item_id", sp.item);
  if (sp.type) query = query.eq("entry_type", sp.type);

  const { data: rows } = scopedSite === "__none__" ? { data: [] } : await query;
  const entries = rows ?? [];

  const selCls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every signed stock movement — openings, purchases, transfers in/out and adjustments.
          {entries.length >= LIMIT && ` Showing latest ${LIMIT}.`}
        </p>
      </div>

      {/* Filters */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        {isAdmin && (
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Site
            <select name="site" defaultValue={sp.site ?? ""} className={selCls}>
              <option value="">All sites</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Item
          <select name="item" defaultValue={sp.item ?? ""} className={selCls}>
            <option value="">All items</option>
            {(items ?? []).map((i) => (
              <option key={i.id} value={i.id}>{i.code} — {i.description}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Type
          <select name="type" defaultValue={sp.type ?? ""} className={selCls}>
            <option value="">All types</option>
            {Object.keys(typeStyles).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Filter
        </button>
        <a href="/transactions" className="px-2 py-2 text-sm text-gray-500 hover:underline">
          Reset
        </a>
      </form>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        {entries.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">
            No transactions match. Openings, transfers and imported history will appear here.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Site</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3">Counterparty</th>
                <th className="px-4 py-3">Source</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, idx) => {
                const site = projMap.get(e.project_id);
                const item = itemMap.get(e.item_id);
                const cp = e.counterparty_project_id ? projMap.get(e.counterparty_project_id) : null;
                const q = Number(e.signed_qty);
                return (
                  <tr key={idx} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2.5 tabular-nums text-gray-600">
                      {e.doc_date
                        ? new Date(e.doc_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{site?.code ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeStyles[e.entry_type] ?? "bg-gray-100"}`}>
                        {e.entry_type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{item?.code}</span>
                      <span className="ml-1.5 text-gray-500">{item?.description}</span>
                    </td>
                    <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${q < 0 ? "text-orange-600" : "text-green-700"}`}>
                      {q > 0 ? "+" : ""}{q.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{cp ? cp.code : "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">{e.source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
