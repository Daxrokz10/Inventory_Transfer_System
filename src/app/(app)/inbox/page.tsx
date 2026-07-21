import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function InboxPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role, home_project_id").eq("id", user!.id).single()
    : { data: null };

  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  const homeProjectId = profile?.home_project_id ?? null;

  // Admins see all dispatched transfers; store managers see only transfers coming TO their site
  const query = supabase
    .from("transfers")
    .select("id, challan_no, transfer_date, from_project:from_project_id(code, name), to_project:to_project_id(code, name)")
    .eq("status", "dispatched")
    .order("created_at", { ascending: false });

  if (!isAdmin && homeProjectId) {
    query.eq("to_project_id", homeProjectId);
  }

  const { data: incoming } = await query;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Receive inbox</h1>
        <p className="mt-1 text-sm text-ink-2">
          {isAdmin
            ? "All material currently in transit. Open a transfer to confirm receipt."
            : "Material dispatched to your site. Enter the actual quantity received and confirm."}
        </p>
      </div>

      <div className="rounded-lg border border-line bg-surface shadow-sm">
        {!incoming || incoming.length === 0 ? (
          <p className="p-6 text-sm text-ink-2">Nothing incoming right now.</p>
        ) : (
          <ul className="divide-y divide-line">
            {incoming.map((t) => {
              const from = t.from_project as unknown as { code: string; name: string } | null;
              const to = t.to_project as unknown as { code: string; name: string } | null;
              const dateStr = t.transfer_date
                ? new Date(t.transfer_date).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                : "—";
              return (
                <li key={t.id} className="flex items-center justify-between px-5 py-4">
                  <div>
                    <p className="font-medium text-ink">
                      {t.challan_no ?? <span className="text-ink-3 font-normal">No challan no.</span>}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-2">
                      {dateStr} · From{" "}
                      <span className="font-medium text-ink-2">
                        {from?.code}
                      </span>{" "}
                      {from?.name}
                      {isAdmin && to && (
                        <>
                          {" "}→{" "}
                          <span className="font-medium text-ink-2">{to.code}</span>{" "}
                          {to.name}
                        </>
                      )}
                    </p>
                  </div>
                  <Link
                    href={`/transfers/${t.id}`}
                    className="ml-4 shrink-0 rounded-lg bg-good px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
                  >
                    Receive
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
