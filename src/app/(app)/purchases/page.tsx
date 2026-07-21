import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PurchaseForm } from "./PurchaseForm";
import { PURCHASE_CODE } from "./constants";

export default async function PurchasesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, home_project_id")
    .eq("id", user.id)
    .single();
  const role = profile?.role ?? null;
  if (role !== "admin" && role !== "superadmin") redirect("/dashboard");

  const [{ data: items }, { data: projects }] = await Promise.all([
    supabase
      .from("items")
      .select("id, code, description, unit, sub_group, per_day_rate")
      .order("code"),
    supabase.from("projects").select("id, code, name").order("code"),
  ]);

  const purchaseProject = (projects ?? []).find((p) => p.code === PURCHASE_CODE);
  // Real destination sites exclude the reserved purchase source.
  const destinations = (projects ?? []).filter((p) => p.code !== PURCHASE_CODE);
  const projMap = new Map((projects ?? []).map((p) => [p.id, p]));
  const itemMap = new Map((items ?? []).map((i) => [i.id, i]));

  // Recent purchases = transfers out of the J-0000 pseudo-site.
  let recent: {
    id: string;
    transfer_date: string | null;
    to_project_id: string;
    transfer_lines: { item_id: string; qty_sent: number }[] | null;
  }[] = [];
  if (purchaseProject) {
    const { data } = await supabase
      .from("transfers")
      .select("id, transfer_date, to_project_id, transfer_lines(item_id, qty_sent)")
      .eq("from_project_id", purchaseProject.id)
      .order("created_at", { ascending: false })
      .limit(50);
    recent = (data ?? []) as typeof recent;
  }

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Purchase</h1>
        <p className="mt-1 text-sm text-ink-2">
          Record newly purchased material into a site. Purchases are booked from the{" "}
          <span className="font-medium">{PURCHASE_CODE}</span> purchase source and land in stock immediately.
        </p>
      </div>

      <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">New purchase</h2>
        <PurchaseForm
          items={(items ?? []).map((i) => ({
            ...i,
            unit: i.unit ?? "NOS",
            sub_group: i.sub_group ?? null,
            per_day_rate: Number(i.per_day_rate ?? 0),
          }))}
          projects={destinations}
          defaultProject={profile?.home_project_id ?? null}
        />
      </section>

      <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">Recent purchases</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-ink-2">No purchases recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Site</th>
                  <th className="py-2 pr-4">Item</th>
                  <th className="py-2 text-right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => {
                  const site = projMap.get(t.to_project_id);
                  const dateStr = t.transfer_date
                    ? new Date(t.transfer_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                    : "—";
                  return (t.transfer_lines ?? []).map((l, i) => {
                    const it = itemMap.get(l.item_id);
                    return (
                      <tr key={`${t.id}-${i}`} className="border-b border-line">
                        <td className="py-2.5 pr-4 tabular-nums text-ink-2">{dateStr}</td>
                        <td className="py-2.5 pr-4 font-medium">{site?.code ?? "—"}</td>
                        <td className="py-2.5 pr-4">
                          <span className="font-medium">{it?.code}</span>
                          <span className="ml-1.5 text-ink-2">{it?.description}</span>
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-good">
                          +{Number(l.qty_sent).toLocaleString("en-IN")}
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
