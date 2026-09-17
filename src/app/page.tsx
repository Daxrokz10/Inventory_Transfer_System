import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/SetupNotice";
import { getAccess, getAuthUser, homeFor } from "@/lib/auth";

export default async function Home() {
  if (!isSupabaseConfigured) {
    return <SetupNotice />;
  }
  if (!(await getAuthUser())) redirect("/login");
  redirect(homeFor(await getAccess()));
}
