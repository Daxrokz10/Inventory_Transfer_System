import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
const qty = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className={`h-1 w-8 rounded-full ${accent}`} />
      <p className="mt-3 text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("role, home_project_id")
        .eq("id", user!.id)
        .single()
    : { data: null };

  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  const homeProjectId = profile?.home_project_id ?? null;

  // Store managers with no site assigned see nothing useful — handle gracefully
  const noSite = !isAdmin && !homeProjectId;

  // Build queries scoped to user's site for store managers
  const balancesQuery = supabase
    .from("stock_balances")
    .select("project_id, item_id, on_hand");
  if (!isAdmin && homeProjectId) {
    balancesQuery.eq("project_id", homeProjectId);
  }

  const inTransitQuery = supabase
    .from("transfers")
    .select("*", { count: "exact", head: true })
    .eq("status", "dispatched");
  if (!isAdmin && homeProjectId) {
    inTransitQuery.or(
      `from_project_id.eq.${homeProjectId},to_project_id.eq.${homeProjectId}`,
    );
  }

  const [
    { count: projectCount },
    { count: itemCount },
    inTransit,
    balancesRes,
    itemsRes,
    projectsRes,
  ] = await Promise.all([
    isAdmin
      ? supabase.from("projects").select("*", { count: "exact", head: true }).neq("code", "J-0000")
      : Promise.resolve({ count: homeProjectId ? 1 : 0 }),
    supabase.from("items").select("*", { count: "exact", head: true }),
    inTransitQuery,
    balancesQuery,
    supabase.from("items").select("id, per_day_rate, main_group"),
    isAdmin
      ? supabase.from("projects").select("id, code, name")
      : homeProjectId
      ? supabase.from("projects").select("id, code, name").eq("id", homeProjectId)
      : Promise.resolve({ data: [] }),
  ]);

  const balances = balancesRes.data ?? [];
  const itemInfo = new Map(
    (itemsRes.data ?? []).map((i) => [
      i.id,
      { rate: Number(i.per_day_rate ?? 0), group: i.main_group ?? "Other" },
    ]),
  );
  const projList =
    (projectsRes as { data: { id: string; code: string; name: string }[] | null }).data ?? [];
  const projInfo = new Map(projList.map((p) => [p.id, `${p.code} — ${p.name}`]));
  // J-0000 is the reserved purchase source, not a real site.
  const purchaseProjectId = projList.find((p) => p.code === "J-0000")?.id ?? null;

  let totalUnits = 0;
  let totalValue = 0;
  const byProject = new Map<string, { qty: number; value: number }>();
  const byGroup = new Map<string, { qty: number; value: number }>();

  for (const b of balances) {
    if (b.project_id === purchaseProjectId) continue; // exclude purchase source
    const onHand = Number(b.on_hand ?? 0);
    if (onHand === 0) continue;
    const info = itemInfo.get(b.item_id);
    const value = onHand * (info?.rate ?? 0);
    totalUnits += onHand;
    totalValue += value;

    const p = byProject.get(b.project_id) ?? { qty: 0, value: 0 };
    p.qty += onHand;
    p.value += value;
    byProject.set(b.project_id, p);

    const g = info?.group ?? "Other";
    const gg = byGroup.get(g) ?? { qty: 0, value: 0 };
    gg.qty += onHand;
    gg.value += value;
    byGroup.set(g, gg);
  }

  const projectRows = [...byProject.entries()]
    .map(([id, v]) => ({ id, label: projInfo.get(id) ?? id, ...v }))
    .sort((a, b) => b.value - a.value);

  const groupRows = [...byGroup.entries()]
    .map(([group, v]) => ({ group, ...v }))
    .sort((a, b) => b.value - a.value);
  const groupMax = Math.max(1, ...groupRows.map((g) => g.value));

  const subtitle = isAdmin
    ? "Stock overview across all project sites"
    : homeProjectId
    ? `Stock overview for your site`
    : "No site assigned to your account yet";

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        </div>
        <Link
          href="/transfers/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          + New transfer
        </Link>
      </div>

      {noSite ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Your account has not been assigned to a site yet. Ask your admin to assign you to a site from the Users page.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Stock value"
              value={inr(totalValue)}
              sub="on-hand × rate"
              accent="bg-blue-500"
            />
            <StatCard
              label="Units on hand"
              value={qty(totalUnits)}
              sub={`${balances.filter((b) => Number(b.on_hand) > 0).length} item balances`}
              accent="bg-green-500"
            />
            {isAdmin ? (
              <StatCard
                label="Sites / projects"
                value={qty(projectCount ?? 0)}
                sub={`${projectRows.length} holding stock`}
                accent="bg-violet-500"
              />
            ) : (
              <StatCard
                label="Items in stock"
                value={qty(projectRows[0]?.qty ?? 0)}
                sub="at your site"
                accent="bg-violet-500"
              />
            )}
            <StatCard
              label={isAdmin ? "Items" : "In transit"}
              value={isAdmin ? qty(itemCount ?? 0) : qty(inTransit.count ?? 0)}
              sub={
                isAdmin
                  ? `${inTransit.count ?? 0} transfers in transit`
                  : "transfers involving your site"
              }
              accent="bg-amber-500"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold">
                  {isAdmin ? "Stock by project" : "Stock at your site"}
                </h2>
                {isAdmin && (
                  <span className="text-xs text-gray-400">
                    {projectRows.length} sites
                  </span>
                )}
              </div>
              {projectRows.length === 0 ? (
                <p className="text-sm text-gray-500">No stock recorded yet.</p>
              ) : (
                <div className="max-h-[28rem] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                        <th className="py-2">{isAdmin ? "Project" : "Category"}</th>
                        <th className="py-2 text-right">Units</th>
                        <th className="py-2 text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isAdmin
                        ? projectRows.map((r) => (
                            <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="py-2 pr-2">{r.label}</td>
                              <td className="py-2 text-right tabular-nums text-gray-600">
                                {qty(r.qty)}
                              </td>
                              <td className="py-2 text-right font-medium tabular-nums">
                                {inr(r.value)}
                              </td>
                            </tr>
                          ))
                        : groupRows.map((g) => (
                            <tr key={g.group} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="py-2 pr-2">{g.group}</td>
                              <td className="py-2 text-right tabular-nums text-gray-600">
                                {qty(g.qty)}
                              </td>
                              <td className="py-2 text-right font-medium tabular-nums">
                                {inr(g.value)}
                              </td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-base font-semibold">By category</h2>
              {groupRows.length === 0 ? (
                <p className="text-sm text-gray-500">No stock recorded yet.</p>
              ) : (
                <ul className="space-y-3">
                  {groupRows.map((g) => (
                    <li key={g.group}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="truncate pr-2 font-medium text-gray-700">
                          {g.group}
                        </span>
                        <span className="tabular-nums text-gray-500">
                          {inr(g.value)}
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${(g.value / groupMax) * 100}%` }}
                        />
                      </div>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {qty(g.qty)} units
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
