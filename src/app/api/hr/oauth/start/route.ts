import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { getHrContext } from "@/lib/hr/auth";
import { authorizeUrl, isMsConfigured } from "@/lib/hr/graph";

/* Starts the one-time Microsoft 365 sign-in for the HR Excel connection.
   A random state value in an httpOnly cookie guards the callback (CSRF). */

export async function GET(request: NextRequest) {
  const { isHr } = await getHrContext("staff");
  const settings = new URL("/hr/settings", request.nextUrl.origin);
  if (!isHr) return NextResponse.redirect(new URL("/hr/my-interviews", request.nextUrl.origin));
  if (!isMsConfigured()) {
    settings.searchParams.set("error", "Microsoft app credentials (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET) are not set.");
    return NextResponse.redirect(settings);
  }

  const state = randomBytes(24).toString("hex");
  const redirectUri = new URL("/api/hr/oauth/callback", request.nextUrl.origin).toString();
  const res = NextResponse.redirect(authorizeUrl(redirectUri, state));
  res.cookies.set("hr_ms_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/hr/oauth",
    maxAge: 600,
  });
  return res;
}
