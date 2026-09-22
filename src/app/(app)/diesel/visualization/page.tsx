import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/selectAll";
import { PageHeader } from "@/components/ui/PageHeader";
import type { Machine } from "@/lib/diesel/types";
import { VisualizationCanvas } from "./VisualizationCanvas";
import { getAuthUser, getProfile, canViewAll, canWriteAll } from "@/lib/auth";

export default async function VisualizationPage() {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const profile = await getProfile();
  const isAdmin = canViewAll(profile?.role);
  const canWrite = canWriteAll(profile?.role);
  if (!isAdmin) redirect("/diesel");

  const [{ data: sites }, machinesRaw] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    // Paged — the fleet is 330 machines today and this view wants all of them.
    selectAll<Machine>(() =>
      supabase.from("machines").select("*").eq("is_active", true).order("name"),
    ),
  ]);

  const machines = machinesRaw as Machine[];

  // Only surface sites that actually have at least one machine — empty
  // sites just clutter the canvas.
  const occupied = new Set(machines.map((m) => m.project_id));
  const sitesWithMachines = (sites ?? []).filter((s) => occupied.has(s.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Site Visualization"
        subtitle="Pan the canvas, zoom in/out, drag site boxes into place, and drop a machine onto another site to relocate it"
      />
      <VisualizationCanvas sites={sitesWithMachines} machines={machines} canWrite={canWrite} />
    </div>
  );
}
