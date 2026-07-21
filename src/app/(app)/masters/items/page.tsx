import { createClient } from "@/lib/supabase/server";
import { NewItemButton } from "./ItemForm";
import { ItemsTable } from "./ItemsTable";

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

  const rows = (items ?? []).map((it) => ({
    ...it,
    per_day_rate: Number(it.per_day_rate ?? 0),
    total: totalByItem.get(it.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Items</h1>
        <span className="text-sm text-ink-2">{items?.length ?? 0} shown</span>
      </div>

      {isAdmin && <NewItemButton />}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface p-5 shadow-sm">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-2">
            No items yet — add one with “New item”, or run the importer to load the
            item master from your spreadsheets.
          </p>
        ) : (
          <ItemsTable items={rows} isAdmin={isAdmin} />
        )}
      </div>
    </div>
  );
}
