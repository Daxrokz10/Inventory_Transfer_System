import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import type { Machine } from "@/lib/diesel/types";
import { VisualizationCanvas } from "./VisualizationCanvas";

export default async function VisualizationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  if (!isAdmin) redirect("/diesel");

  const [{ data: sites }, { data: machinesRaw }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    supabase.from("machines").select("*").eq("is_active", true).order("name"),
  ]);

  const machines = (machinesRaw ?? []) as Machine[];

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
      <VisualizationCanvas sites={sitesWithMachines} machines={machines} />
    </div>
  );
}
