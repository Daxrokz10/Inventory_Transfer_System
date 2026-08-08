import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase auth session on every request and gates pages
// behind login. Public paths (login, auth callback) are allowed through.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Until a Supabase project is connected, let every request through so the
  // app can render its setup instructions instead of crashing.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const publicPaths = ["/login", "/auth"];
  // Routes that authenticate themselves and legitimately arrive without a
  // session cookie. /api/diesel/monitor is called by the platform's cron, not
  // a browser — it checks a bearer secret of its own and 401s without it, so
  // skipping the session gate here opens nothing up. Session-gating it would
  // simply redirect every nightly run to the login page.
  const selfAuthedPaths = ["/api/diesel/monitor"];
  const isPublic =
    publicPaths.some((p) => request.nextUrl.pathname.startsWith(p)) ||
    selfAuthedPaths.some((p) => request.nextUrl.pathname === p);

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
