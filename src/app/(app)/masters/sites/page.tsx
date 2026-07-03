import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteForm } from "./SiteForm";

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

  const { data: projects } = await supabase
    .from("projects")
    .select("id, code, name, branch, gstin")
    .order("code");

  // J-0000 is the reserved purchase source, not a real site.
  const sites = (projects ?? []).filter((p) => p.code !== "J-0000");

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sites</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage the projects / godowns that material moves between.
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">Add a new site</h2>
        <SiteForm />
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">All sites</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Branch</th>
                <th className="py-2">GSTIN</th>
              </tr>
            </thead>
            <tbody>
              {sites.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-3 text-gray-500">No sites yet.</td>
                </tr>
              ) : (
                sites.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-gray-800">{p.code}</td>
                    <td className="py-2.5 pr-4 text-gray-700">{p.name}</td>
                    <td className="py-2.5 pr-4 text-gray-600">{p.branch ?? <span className="text-gray-400">—</span>}</td>
                    <td className="py-2.5 text-gray-600">{p.gstin ?? <span className="text-gray-400">—</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
