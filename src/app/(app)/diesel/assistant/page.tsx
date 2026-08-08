import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { isLlmConfigured } from "@/lib/llm/client";
import { AssistantChat } from "./AssistantChat";

/* Admin-only natural-language view over the diesel data.

   Nothing on this page calls the model during render — the chat component
   only reaches out on an explicit question, so the page loads normally even
   with the host PC asleep. */

/* Server Actions run in this route's segment, so this ceiling governs
   askDieselAssistant too. Without it the platform's 10s default would kill a
   question long before a 9B model on a home PC finishes answering. */
export const maxDuration = 60;
export default async function DieselAssistantPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  if (!isAdmin) redirect("/diesel");

  const today = new Date().toISOString().slice(0, 10);
  const defaultStart = `${today.slice(0, 7)}-01`;

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, code")
    .eq("is_active", true)
    .order("code");
  const sites = (projects ?? []).map((p) => ({
    id: p.id as string,
    label: p.code ? `${p.code} · ${p.name}` : (p.name as string),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assistant"
        subtitle="Ask questions about the diesel data in plain language"
      />

      {!isLlmConfigured ? (
        <Card>
          <p className="text-sm text-ink-2">
            The assistant isn&apos;t configured on this deployment yet — no
            model endpoint has been set. Once one is, this page will work
            without any further change.
          </p>
        </Card>
      ) : (
        <AssistantChat
          sites={sites}
          defaultStart={defaultStart}
          defaultEnd={today}
          today={today}
        />
      )}
    </div>
  );
}
