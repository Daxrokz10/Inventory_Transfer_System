import { NextRequest, NextResponse } from "next/server";
import { createRequire } from "module";
import { createClient } from "@/lib/supabase/server";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

// Mirrors the pivot built in /masters/projects (Closing Balance) so the
// downloaded sheet matches exactly what's on screen, including the same
// role-based site scoping and group/search filters.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const group = sp.get("group") ?? "";
  const q = (sp.get("q") ?? "").trim().toLowerCase();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role, home_project_id").eq("id", user.id).single()
    : { data: null };
  const isAdmin = profile?.role === "admin" || profile?.role === "superadmin";
  const homeProjectId = profile?.home_project_id ?? null;

  let balQuery = supabase.from("stock_balances").select("project_id, item_id, on_hand");
  if (!isAdmin && homeProjectId) balQuery = balQuery.eq("project_id", homeProjectId);

  const [{ data: balances }, { data: items }, { data: projects }] = await Promise.all([
    balQuery,
    supabase.from("items").select("id, code, description, main_group, unit").order("code"),
    supabase.from("projects").select("id, code, name").order("code"),
  ]);

  const itemMap = new Map((items ?? []).map((i) => [i.id, i]));
  const purchaseProjectId = (projects ?? []).find((p) => p.code === "J-0000")?.id ?? null;

  const pivot = new Map<string, Map<string, number>>();
  const siteTotals = new Map<string, number>();
  const itemsWithStock = new Set<string>();
  for (const b of balances ?? []) {
    if (b.project_id === purchaseProjectId) continue;
    const v = Number(b.on_hand);
    if (!v) continue;
    itemsWithStock.add(b.item_id);
    if (!pivot.has(b.item_id)) pivot.set(b.item_id, new Map());
    pivot.get(b.item_id)!.set(b.project_id, v);
    siteTotals.set(b.project_id, (siteTotals.get(b.project_id) ?? 0) + v);
  }

  const siteCols = (projects ?? [])
    .filter((p) => siteTotals.has(p.id))
    .sort((a, b) => a.code.localeCompare(b.code));

  let rowItems = [...itemsWithStock]
    .map((id) => itemMap.get(id))
    .filter((it): it is NonNullable<typeof it> => Boolean(it));
  if (group) rowItems = rowItems.filter((it) => it.main_group === group);
  if (q) {
    rowItems = rowItems.filter(
      (it) => it.code.toLowerCase().includes(q) || (it.description ?? "").toLowerCase().includes(q),
    );
  }
  rowItems.sort((a, b) => a.code.localeCompare(b.code));

  // ---- build worksheet rows ----
  const header = ["Item code", "Description", "Unit", ...siteCols.map((s) => s.code), "Total"];
  const aoa: (string | number)[][] = [header];

  for (const it of rowItems) {
    const row = pivot.get(it.id)!;
    const rowTotal = [...row.values()].reduce((s, v) => s + v, 0);
    aoa.push([
      it.code,
      it.description ?? "",
      it.unit ?? "NOS",
      ...siteCols.map((s) => row.get(s.id) ?? 0),
      rowTotal,
    ]);
  }

  aoa.push([
    "Site total (all items)",
    "",
    "",
    ...siteCols.map((s) => siteTotals.get(s.id) ?? 0),
    [...siteTotals.values()].reduce((s, v) => s + v, 0),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 14 },
    { wch: 36 },
    { wch: 8 },
    ...siteCols.map(() => ({ wch: 10 })),
    { wch: 10 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Closing Balance");

  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const bytes = new Uint8Array(buf);
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="closing-balance-${today}.xlsx"`,
    },
  });
}
