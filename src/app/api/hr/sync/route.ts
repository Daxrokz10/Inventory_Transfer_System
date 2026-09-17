import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { syncFromExcel } from "@/lib/hr/sync";

/* Daily safety-net sync of the HR master Excel (Vercel Cron, see vercel.json).
   HR pages also sync on load when the last sync is over a minute old. */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null, secret: string) {
  const a = Buffer.from(header ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json({ ok: true, ...(await syncFromExcel()) });
  } catch (e) {
    // Not connected yet / Microsoft hiccup: recorded in hr_ms_connection.last_error.
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
