import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { INDIAN_STATES, cityForState } from "@/lib/diesel/types";
import { SiteForm } from "./SiteForm";
import {
  updateSiteState,
  deleteSiteGroup,
  setGroupShareExternal,
} from "./actions";
import { GroupForm } from "./GroupForm";
import { SiteGroupSelect } from "./SiteGroupSelect";

export default async function SitesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = me?.role ?? null;
  if (role !== "admin" && role !== "superadmin") redirect("/dashboard");

  const [{ data: projects, error: projectsError }, { data: pricesRaw }, { data: groups }] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, code, name, branch, gstin, state, group_id")
        .order("code"),
      supabase
        .from("fuel_prices")
        .select("location, fuel_type, price, price_date")
        .order("price_date", { ascending: false })
        .limit(400),
      supabase.from("site_groups").select("id, name, share_external").order("name"),
    ]);
  const siteGroups = groups ?? [];

  // J-0000 is the reserved purchase source, not a real site.
  const sites = (projects ?? []).filter((p) => p.code !== "J-0000");

  // Latest known price per city+fuel (today's row when present).
  const today = new Date().toISOString().slice(0, 10);
  const latestPrice = new Map<string, { price: number; price_date: string }>();
  for (const row of pricesRaw ?? []) {
    const key = `${row.location}|${row.fuel_type}`;
    if (!latestPrice.has(key)) {
      latestPrice.set(key, {
        price: Number(row.price),
        price_date: row.price_date,
      });
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sites</h1>
        <p className="mt-1 text-sm text-ink-2">
          Manage the projects / godowns that material moves between. The state
          drives the daily fuel price used by the Diesel Report (each state
          maps to one reference city).
        </p>
      </div>

      {projectsError && (
        <div className="rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          Couldn&apos;t load sites: {projectsError.message}. If this mentions a
          missing column, a pending database migration needs to be run.
        </div>
      )}

      <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">Add a new site</h2>
        <SiteForm />
      </section>

      <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
        <h2 className="mb-1 text-base font-semibold">Site groups</h2>
        <p className="mb-4 text-sm text-ink-2">
          Sites in the same group share their internal (company-owned) fleet —
          anyone at any site in the group can see and log fuel/readings for
          another member&apos;s internal machines on the daily report. External
          (hired) machines are never shared, regardless of grouping. Assign a
          site to a group from the &quot;Group&quot; column in the table below.
        </p>
        <GroupForm />
        {siteGroups.length === 0 ? (
          <p className="text-sm text-ink-3">No groups yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {siteGroups.map((g) => {
              const memberCount = (projects ?? []).filter((p) => p.group_id === g.id).length;
              return (
                <li key={g.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-ink">{g.name}</span>
                    <span className="ml-2 text-xs text-ink-3">
                      {memberCount} site{memberCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <div className="flex items-center gap-4">
                    <form action={setGroupShareExternal} className="flex items-center gap-1.5">
                      <input type="hidden" name="group_id" value={g.id} />
                      <label className="flex items-center gap-1.5 text-xs text-ink-2">
                        <input
                          type="checkbox"
                          name="share_external"
                          defaultChecked={g.share_external === true}
                        />
                        Also share external (hired) machines
                      </label>
                      <button
                        type="submit"
                        className="rounded-md border border-line-strong px-2 py-1 text-xs text-ink-2 hover:bg-surface-2"
                      >
                        Save
                      </button>
                    </form>
                    <form action={deleteSiteGroup}>
                      <input type="hidden" name="group_id" value={g.id} />
                      <button type="submit" className="text-xs text-ink-3 hover:text-danger">
                        Delete
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">All sites</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Branch</th>
                <th className="py-2 pr-4">GSTIN</th>
                <th className="py-2 pr-4">State (fuel prices)</th>
                <th className="py-2 pr-4">Group</th>
                <th className="py-2 pr-4 text-right">Diesel ₹/L</th>
                <th className="py-2 text-right">Petrol ₹/L</th>
              </tr>
            </thead>
            <tbody>
              {sites.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-3 text-ink-2">No sites yet.</td>
                </tr>
              ) : (
                sites.map((p) => {
                  const city = cityForState(p.state);
                  const diesel = city ? latestPrice.get(`${city}|diesel`) : undefined;
                  const petrol = city ? latestPrice.get(`${city}|petrol`) : undefined;
                  const stale =
                    (diesel?.price_date ?? petrol?.price_date ?? today) < today;
                  return (
                  <tr key={p.id} className="border-b border-line">
                    <td className="py-2.5 pr-4 font-medium text-ink">{p.code}</td>
                    <td className="py-2.5 pr-4 text-ink-2">{p.name}</td>
                    <td className="py-2.5 pr-4 text-ink-2">{p.branch ?? <span className="text-ink-3">—</span>}</td>
                    <td className="py-2.5 pr-4 text-ink-2">{p.gstin ?? <span className="text-ink-3">—</span>}</td>
                    <td className="py-2.5">
                      <form action={updateSiteState} className="flex items-center gap-1.5">
                        <input type="hidden" name="project_id" value={p.id} />
                        <select
                          name="state"
                          defaultValue={p.state ?? ""}
                          className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs"
                        >
                          <option value="">Not set</option>
                          {INDIAN_STATES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="rounded-md border border-line-strong px-2 py-1 text-xs text-ink-2 hover:bg-surface-2"
                        >
                          Save
                        </button>
                      </form>
                    </td>
                    <td className="py-2.5 pr-4">
                      <SiteGroupSelect projectId={p.id} groupId={p.group_id} groups={siteGroups} />
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-ink">
                      {diesel ? diesel.price.toFixed(2) : <span className="text-ink-3">—</span>}
                      {diesel && stale && (
                        <span className="ml-1 text-[10px] text-warn" title={`Price from ${diesel.price_date}`}>
                          ({diesel.price_date})
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-ink">
                      {petrol ? petrol.price.toFixed(2) : <span className="text-ink-3">—</span>}
                      {petrol && stale && (
                        <span className="ml-1 text-[10px] text-warn" title={`Price from ${petrol.price_date}`}>
                          ({petrol.price_date})
                        </span>
                      )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
