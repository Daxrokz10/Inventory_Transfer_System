import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const statusStyles: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  dispatched: "bg-amber-100 text-amber-800",
  received: "bg-green-100 text-green-800",
  partial: "bg-orange-100 text-orange-800",
  cancelled: "bg-red-100 text-red-700",
};

const statusLabel: Record<string, string> = {
  draft: "Draft",
  dispatched: "Dispatched",
  received: "Received",
  partial: "Partial",
  cancelled: "Cancelled",
};

export default async function TransfersPage() {
  const supabase = await createClient();
  const { data: transfers } = await supabase
    .from("transfers")
    .select(
      "id, challan_no, transfer_date, status, from_project:from_project_id(code, name), to_project:to_project_id(code, name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Transfers</h1>
        <Link
          href="/transfers/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          New transfer
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        {!transfers || transfers.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">
            No transfers yet. Create one to dispatch material from your site.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-5 py-3">Challan</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => {
                const from = t.from_project as unknown as { code: string; name: string } | null;
                const to = t.to_project as unknown as { code: string; name: string } | null;
                return (
                  <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium">
                      <Link
                        href={`/transfers/${t.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {t.challan_no ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-600">
                      {t.transfer_date
                        ? new Date(t.transfer_date).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {from ? (
                        <span>
                          <span className="font-medium">{from.code}</span>
                          <span className="ml-1.5 text-gray-500 truncate max-w-[10rem] inline-block align-bottom">
                            {from.name}
                          </span>
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {to ? (
                        <span>
                          <span className="font-medium">{to.code}</span>
                          <span className="ml-1.5 text-gray-500 truncate max-w-[10rem] inline-block align-bottom">
                            {to.name}
                          </span>
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          statusStyles[t.status] ?? "bg-gray-100"
                        }`}
                      >
                        {statusLabel[t.status] ?? t.status}
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
