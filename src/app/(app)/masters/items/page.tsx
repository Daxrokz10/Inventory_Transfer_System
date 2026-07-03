import { createClient } from "@/lib/supabase/server";
import { NewItemButton } from "./ItemForm";

const qty = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

export default async function ItemsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";

  const [{ data: items }, { data: balances }, { data: projects }] = await Promise.all([
    supabase
      .from("items")
      .select("id, code, description, unit, sub_group, main_group, hsn_code, per_day_rate")
      .order("code")
      .limit(500),
    supabase.from("stock_balances").select("project_id, item_id, on_hand"),
    supabase.from("projects").select("id, code"),
  ]);

  // J-0000 is the reserved purchase source, not a real site.
  const purchaseProjectId = (projects ?? []).find((p) => p.code === "J-0000")?.id ?? null;

  const totalByItem = new Map<string, number>();
  for (const b of balances ?? []) {
    if (b.project_id === purchaseProjectId) continue;
    totalByItem.set(b.item_id, (totalByItem.get(b.item_id) ?? 0) + Number(b.on_hand));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Items</h1>
        <span className="text-sm text-gray-500">{items?.length ?? 0} shown</span>
      </div>

      {isAdmin && <NewItemButton />}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        {!items || items.length === 0 ? (
          <p className="text-sm text-gray-500">
            No items yet — run the importer to load the item master from your
            spreadsheets.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="py-2">Code</th>
                <th className="py-2">Description</th>
                <th className="py-2">Unit</th>
                <th className="py-2">Sub group</th>
                <th className="py-2">Main group</th>
                <th className="py-2">HSN</th>
                <th className="py-2 text-right">Rate</th>
                <th className="py-2 text-right">Total qty (all sites)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const total = totalByItem.get(it.id) ?? 0;
                return (
                  <tr key={it.code} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 font-medium">{it.code}</td>
                    <td className="py-2">{it.description}</td>
                    <td className="py-2">{it.unit}</td>
                    <td className="py-2">{it.sub_group}</td>
                    <td className="py-2">{it.main_group}</td>
                    <td className="py-2">{it.hsn_code}</td>
                    <td className="py-2 text-right tabular-nums">
                      {Number(it.per_day_rate ?? 0).toLocaleString()}
                    </td>
                    <td
                      className={`py-2 text-right font-medium tabular-nums ${
                        total < 0 ? "text-red-600" : "text-gray-800"
                      }`}
                    >
                      {qty(total)}
                    </td>
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
