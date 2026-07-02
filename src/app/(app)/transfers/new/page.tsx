import { createClient } from "@/lib/supabase/server";
import { NewTransferForm } from "./NewTransferForm";

export default async function NewTransferPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: projects }, { data: items }, { data: profile }] =
    await Promise.all([
      supabase.from("projects").select("id, code, name").order("code"),
      supabase
        .from("items")
        .select("id, code, description, unit, per_day_rate, sub_group")
        .order("code"),
      user
        ? supabase
            .from("profiles")
            .select("home_project_id")
            .eq("id", user.id)
            .single()
        : Promise.resolve({ data: null }),
    ]);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New transfer</h1>
        <p className="mt-1 text-sm text-gray-500">
          Dispatch material from one site to another.
        </p>
      </div>
      <NewTransferForm
        projects={projects ?? []}
        items={(items ?? []).map((i) => ({
          ...i,
          unit: i.unit ?? "NOS",
          per_day_rate: Number(i.per_day_rate ?? 0),
          sub_group: i.sub_group ?? null,
        }))}
        defaultFromProject={profile?.home_project_id ?? null}
      />
    </div>
  );
}
