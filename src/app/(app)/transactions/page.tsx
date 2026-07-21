import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// A "transaction" here is a stock transfer between sites. It is Open while the
// material is in transit (dispatched) and Closed once the receiving site
// confirms it (received / partial).
const statusView: Record<string, { label: string; cls: string }> = {
  dispatched: { label: "Open", cls: "bg-warn-soft text-warn" },
  received: { label: "Closed", cls: "bg-good-soft text-good" },
  partial: { label: "Closed", cls: "bg-good-soft text-good" },
  draft: { label: "Draft", cls: "bg-surface-2 text-ink-2" },
  cancelled: { label: "Cancelled", cls: "bg-danger-soft text-danger" },
};

const LIMIT = 500;

type Search = { site?: string; status?: string };

type Proj = { code: string; name: string } | null;
type TransferRow = {
  id: string;
  challan_no: string | null;
  transfer_date: string | null;
  status: string;
  from_project_id: string;
  to_project_id: string;
  from_project: Proj;
  to_project: Proj;
  transfer_lines: { qty_sent: number }[] | null;
};

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  // Scope: store managers only see transfers involving their own site.
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role, home_project_id").eq("id", user.id).single()
    : { data: null };
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  const homeProjectId = profile?.home_project_id ?? null;

  const { data: projects } = await supabase
    .from("projects")
    .select("id, code, name")
    .order("code");

  let query = supabase
    .from("transfers")
    .select(
      "id, challan_no, transfer_date, status, from_project_id, to_project_id, from_project:from_project_id(code, name), to_project:to_project_id(code, name), transfer_lines(qty_sent)",
    )
    .order("transfer_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  // Store managers: only transfers where their site is sender or receiver.
  let scopedOut = false;
  if (!isAdmin) {
    if (homeProjectId) {
      query = query.or(`from_project_id.eq.${homeProjectId},to_project_id.eq.${homeProjectId}`);
    } else {
      scopedOut = true; // no home site assigned → nothing to show
    }
  } else if (sp.site) {
    query = query.or(`from_project_id.eq.${sp.site},to_project_id.eq.${sp.site}`);
  }

  if (sp.status === "open") query = query.eq("status", "dispatched");
  else if (sp.status === "closed") query = query.in("status", ["received", "partial"]);

  const { data } = scopedOut ? { data: [] } : await query;
  const rows = (data ?? []) as unknown as TransferRow[];

  const selCls =
    "rounded-lg border border-line-strong px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        <p className="mt-1 text-sm text-ink-2">
          Material transfers between sites. A transfer is <span className="font-medium text-warn">Open</span>{" "}
          while in transit and <span className="font-medium text-good">Closed</span> once the receiving site confirms it.
          {rows.length >= LIMIT && ` Showing latest ${LIMIT}.`}
        </p>
      </div>

      {/* Filters */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        {isAdmin && (
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            Site
            <select name="site" defaultValue={sp.site ?? ""} className={selCls}>
              <option value="">All sites</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Status
          <select name="status" defaultValue={sp.status ?? ""} className={selCls}>
            <option value="">All</option>
            <option value="open">Open (in transit)</option>
            <option value="closed">Closed (received)</option>
          </select>
        </label>
        <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong">
          Filter
        </button>
        <a href="/transactions" className="px-2 py-2 text-sm text-ink-2 hover:underline">
          Reset
        </a>
      </form>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-ink-2">
            No transfers to show yet. Once you dispatch material it will appear here as Open, then Closed after it is received.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Challan</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3 text-right">Items</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const from = t.from_project;
                const to = t.to_project;
                const lineCount = t.transfer_lines?.length ?? 0;
                const totalQty = (t.transfer_lines ?? []).reduce((s, l) => s + Number(l.qty_sent), 0);
                const sv = statusView[t.status] ?? { label: t.status, cls: "bg-surface-2" };
                return (
                  <tr key={t.id} className="border-b border-line hover:bg-surface-2">
                    <td className="px-4 py-2.5 tabular-nums text-ink-2">
                      {t.transfer_date
                        ? new Date(t.transfer_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 font-medium">
                      <Link href={`/transfers/${t.id}`} className="text-accent hover:underline">
                        {t.challan_no ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{from?.code ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{to?.code ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-2">{lineCount}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-2">
                      {totalQty.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${sv.cls}`}>
                        {sv.label}
                      </span>
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
