import { redirect } from "next/navigation";
import { getAccess, homeFor } from "@/lib/auth";
import { canUseModule, type ModuleKey } from "@/lib/nav";

/* Module access gate, used by a tiny layout.tsx at the top of each module's
   folders. A segment layout renders whenever the user enters that segment
   (client navigation included), and the access flags come straight from the
   profile row, so a Control Panel change applies on the next click. */
export async function ModuleGuard({ module, children }: { module: ModuleKey; children: React.ReactNode }) {
  const access = await getAccess();
  if (!canUseModule(module, access)) redirect(homeFor(access));
  return <>{children}</>;
}
