import { NextResponse, type NextRequest } from "next/server";
import { getHrContext } from "@/lib/hr/auth";
import { completeAuthorization } from "@/lib/hr/graph";

export async function GET(request: NextRequest) {
  const { isHr } = await getHrContext("staff");
  const origin = request.nextUrl.origin;
  if (!isHr) return NextResponse.redirect(new URL("/hr/my-interviews", origin));

  const sp = request.nextUrl.searchParams;
  const settings = new URL("/hr/settings", origin);
  const expected = request.cookies.get("hr_ms_state")?.value;

  if (sp.get("error")) {
    settings.searchParams.set("error", sp.get("error_description") ?? sp.get("error")!);
  } else if (!expected || sp.get("state") !== expected) {
    settings.searchParams.set("error", "Sign-in expired or was tampered with. Try connecting again.");
  } else {
    try {
      const email = await completeAuthorization(
        sp.get("code") ?? "",
        new URL("/api/hr/oauth/callback", origin).toString(),
      );
      settings.searchParams.set("connected", email);
    } catch (e) {
      settings.searchParams.set("error", e instanceof Error ? e.message : String(e));
    }
  }

  const res = NextResponse.redirect(settings);
  res.cookies.delete({ name: "hr_ms_state", path: "/api/hr/oauth" });
  return res;
}
