import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const LIMIT = 500;

type Row = {
  id: string;
  delta: number;
  previous_qty: number | null;
  new_qty: number | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  item: { code: string; description: string; unit: string } | null;
  project: { code: string; name: string } | null;
};

const num = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);

export default async function AdjustmentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const isAdmin = me?.role === "admin" || me?.role === "superadmin";
  if (!isAdmin) redirect("/masters/projects");

  const { data, error } = await supabase
    .from("stock_adjustments")
    .select(
      "id, delta, previous_qty, new_qty, reason, created_by, created_at, item:item_id(code, description, unit), project:project_id(code, name)",
    )
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  const notSetUp = Boolean(error);
  const rows = (data ?? []) as unknown as Row[];

  // created_by points at auth.users, so resolve names via profiles separately.
  const byId = new Map<string, string>();
  const ids = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[];
  if (ids.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids);
    for (const p of profiles ?? []) byId.set(p.id, p.full_name ?? "—");
  }

  const th = "px-4 py-3 text-left text-xs uppercase tracking-wide text-ink-3";
  const td = "px-4 py-2.5";

  return (
    <div className="space-y-5">
      <div>
        <Link href="/masters/projects" className="text-sm text-accent hover:underline">
          ← Closing balance
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Adjustment history</h1>
        <p className="mt-1 text-sm text-ink-2">
          Every manual correction made to a closing-balance quantity — who changed it, from what
          value to what, and when. Transfers and purchases are not listed here; see{" "}
          <Link href="/transactions" className="text-accent hover:underline">
            Transactions
          </Link>
          .
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
        {notSetUp ? (
          <p className="p-6 text-sm text-ink-2">
            Stock adjustments are not set up yet — run migration{" "}
            <code className="rounded bg-surface-2 px-1">0031_stock_adjustments.sql</code> in Supabase.
          </p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-ink-2">
            No manual adjustments have been made yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>When</th>
                <th className={th}>Site</th>
                <th className={th}>Item</th>
                <th className={`${th} text-right`}>From</th>
                <th className={`${th} text-right`}>To</th>
                <th className={`${th} text-right`}>Change</th>
                <th className={th}>Changed by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = Number(r.delta);
                return (
                  <tr key={r.id} className="border-b border-line hover:bg-surface-2">
                    <td className={`${td} whitespace-nowrap tabular-nums text-ink-2`}>
                      {new Date(r.created_at).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className={`${td} font-medium`}>{r.project?.code ?? "—"}</td>
                    <td className={td}>
                      <span className="font-medium">{r.item?.code}</span>
                      <span className="ml-1.5 text-ink-2">{r.item?.description}</span>
                    </td>
                    <td className={`${td} text-right tabular-nums text-ink-2`}>
                      {num(r.previous_qty)}
                    </td>
                    <td className={`${td} text-right tabular-nums font-medium`}>
                      {num(r.new_qty)}
                    </td>
                    <td
                      className={`${td} text-right font-medium tabular-nums ${
                        d < 0 ? "text-danger" : "text-good"
                      }`}
                    >
                      {d > 0 ? "+" : ""}
                      {num(d)}
                    </td>
                    <td className={`${td} text-ink-2`}>
                      {r.created_by ? byId.get(r.created_by) ?? "—" : "—"}
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
