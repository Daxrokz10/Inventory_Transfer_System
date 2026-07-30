import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Table, TH, TRow, TD, EmptyState } from "@/components/ui/Table";
import { resolveFlag } from "../actions";

const SEVERITY_TONE: Record<string, BadgeTone> = {
  low: "neutral",
  medium: "warn",
  high: "danger",
};

// Highest severity first within each resolved/open group.
const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export default async function AnomaliesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  if (!isAdmin) redirect("/diesel");

  const [{ data: flagsRaw }, { data: machines }, { data: projects }] =
    await Promise.all([
      supabase
        .from("anomaly_flags")
        .select(
          "id, severity, type, message, resolved, created_at, daily_logs!inner(machine_id, project_id, log_date, fuel_issued_liters)",
        )
        .order("resolved", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("machines").select("id, name, registration_no"),
      supabase.from("projects").select("id, name"),
    ]);

  const machineById = new Map((machines ?? []).map((m) => [m.id, m]));
  const siteById = new Map((projects ?? []).map((p) => [p.id, p.name]));

  // Open flags first, then ranked by severity (high → low), then newest first
  // within each group — so the things most worth checking surface at the top
  // instead of being scattered across the raw insert order.
  const flags = [...(flagsRaw ?? [])].sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    const rank = (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
    if (rank !== 0) return rank;
    return b.created_at.localeCompare(a.created_at);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Anomaly Review"
        subtitle="Flags raised automatically on suspicious fill-ups — resolve once checked"
      />

      <Card className="overflow-x-auto p-0">
        <Table>
          <thead>
            <tr>
              <TH>Severity</TH>
              <TH>Date</TH>
              <TH>Site</TH>
              <TH>Machine</TH>
              <TH>What was flagged</TH>
              <TH>Status</TH>
              <TH />
            </tr>
          </thead>
          <tbody>
            {flags.length === 0 ? (
              <tr>
                <TD colSpan={7}>
                  <EmptyState message="No anomalies — nothing suspicious has been flagged." />
                </TD>
              </tr>
            ) : (
              flags.map((f) => {
                const log = f.daily_logs as unknown as {
                  machine_id: string;
                  project_id: string;
                  log_date: string;
                };
                const m = machineById.get(log.machine_id);
                return (
                  <TRow key={f.id} className={f.resolved ? "opacity-55" : ""}>
                    <TD>
                      <Badge tone={SEVERITY_TONE[f.severity] ?? "warn"}>
                        {f.severity}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap">{log.log_date}</TD>
                    <TD className="text-ink-2">
                      {siteById.get(log.project_id) ?? "—"}
                    </TD>
                    <TD className="font-medium">
                      {m ? (
                        <Link
                          href={`/diesel/machines/${m.id}`}
                          className="text-accent hover:underline"
                        >
                          {m.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                      {m?.registration_no && (
                        <span className="font-normal text-ink-3">
                          {" "}
                          · {m.registration_no}
                        </span>
                      )}
                    </TD>
                    <TD className="max-w-md text-ink-2">{f.message}</TD>
                    <TD>
                      {f.resolved ? (
                        <Badge tone="good">Resolved</Badge>
                      ) : (
                        <Badge tone="warn">Open</Badge>
                      )}
                    </TD>
                    <TD>
                      {!f.resolved && (
                        <form action={resolveFlag}>
                          <input type="hidden" name="flag_id" value={f.id} />
                          <Button variant="secondary" size="sm" type="submit">
                            Resolve
                          </Button>
                        </form>
                      )}
                    </TD>
                  </TRow>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
