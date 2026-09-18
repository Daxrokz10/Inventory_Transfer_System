import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { getHrContext } from "@/lib/hr/auth";
import { getDesignations } from "@/lib/hr/data";
import { NewOpeningForm } from "../../HrForms";

export default async function NewOpeningPage() {
  const { supabase, access } = await getHrContext("planning");
  if (!access.planning) redirect("/hr/openings");

  const [{ data: projects }, designations] = await Promise.all([
    supabase.from("projects").select("id, code, name").eq("is_active", true).neq("code", "J-0000").order("code"),
    getDesignations(),
  ]);

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/hr/openings" className="text-sm text-ink-2 hover:underline">
        ← Openings
      </Link>
      <PageHeader title="Raise an opening" subtitle="HR is notified and starts finding candidates for it." />
      <Card>
        <NewOpeningForm projects={projects ?? []} designations={designations} />
      </Card>
    </div>
  );
}
