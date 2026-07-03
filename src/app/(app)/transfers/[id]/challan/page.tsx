import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/PrintButton";

const COMPANY = "SHREE GANESH CORPORATION";
const COMPANY_GSTIN = "24AALPL7464Q1ZW";
const COMPANY_BRANCH = "NAVSARI";
const PAN = "AALPL7464Q";
const EMAIL = "info@shreeganeshcorp.com";
const WEBSITE = "www.shreeganeshcorp.com";
const MIN_ROWS = 16; // blank rows to fill like the original challan (kept low so it stays on one A4 page)

function fmt(n: number) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function ChallanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: t } = await supabase
    .from("transfers")
    .select("*, from_project:from_project_id(*), to_project:to_project_id(*)")
    .eq("id", id)
    .single();

  if (!t) notFound();

  const { data: lines } = await supabase
    .from("transfer_lines")
    .select("id, qty_sent, rate, item:item_id(code, description, unit, hsn_code, main_group)")
    .eq("transfer_id", id);

  const from = t.from_project as Record<string, string | null> | null;
  const to = t.to_project as Record<string, string | null> | null;

  const rows = (lines ?? []) as unknown as {
    id: string;
    qty_sent: number;
    rate: number;
    item: { code: string; description: string; unit: string; hsn_code: string | null; main_group: string | null } | null;
  }[];

  const totalQty = rows.reduce((s, r) => s + Number(r.qty_sent), 0);
  const totalAmt = rows.reduce((s, r) => s + Number(r.qty_sent) * Number(r.rate ?? 0), 0);
  const blankCount = Math.max(0, MIN_ROWS - rows.length);

  const td = "border border-gray-800 px-1.5 py-1 text-xs";
  const tdC = `${td} text-center`;

  return (
    <>
      {/* Print button — hidden when printing */}
      <div className="no-print mb-4 flex gap-3 p-4">
        <PrintButton />
        <a
          href={`/transfers/${id}`}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          ← Back
        </a>
      </div>

      {/* A4 challan body */}
      <div
        id="challan"
        className="mx-auto w-[210mm] bg-white p-6 font-sans text-black"
        style={{ minHeight: "297mm" }}
      >
        {/* ── HEADER ── */}
        <div className="flex items-center gap-4 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sgc-logo.png"
            alt="Shree Ganesh Corporation"
            height={72}
            className="h-[72px] w-auto"
          />
          <div>
            <h1
              className="text-4xl font-extrabold tracking-wide"
              style={{ color: "#7B1A1A" }}
            >
              {COMPANY}
            </h1>
          </div>
        </div>

        {/* maroon rule */}
        <div className="h-1.5 w-full" style={{ background: "#7B1A1A" }} />
        <div className="h-0.5 mt-0.5 w-full" style={{ background: "#7B1A1A" }} />

        {/* ── TITLE ── */}
        <div
          className="my-2 py-1.5 text-center text-sm font-bold text-white"
          style={{ background: "#7B1A1A" }}
        >
          Material Delivery Challan
        </div>

        {/* ── CONSIGNOR / CONSIGNEE ── */}
        <table className="w-full border-collapse border border-gray-800 text-xs">
          <tbody>
            <tr>
              <td className="w-1/2 border border-gray-800 p-1 align-top">
                <div><span className="font-bold">Consignor:</span> {COMPANY}</div>
                <div>
                  <span className="font-bold">Address:</span>{" "}
                  {from?.address ?? from?.name ?? "—"}
                </div>
              </td>
              <td className="w-1/2 border border-gray-800 p-1 align-top">
                <div><span className="font-bold">Consignee:</span> {COMPANY}</div>
                <div>
                  <span className="font-bold">Address:</span>{" "}
                  {to?.address ?? to?.name ?? "—"}
                </div>
              </td>
            </tr>
            <tr>
              <td className="border border-gray-800 p-1">
                <span className="font-bold">Project Code TO</span>{" "}
                {t.to_project_id ? (to?.code ?? "—") : "—"}
              </td>
              <td className="border border-gray-800 p-1">
                <span className="font-bold">Project Code FROM</span>{" "}
                {from?.code ?? "—"}
              </td>
            </tr>
            <tr>
              <td className="border border-gray-800 p-1">
                <span className="font-bold">GSTIN:</span>&nbsp;&nbsp;
                {from?.branch ?? COMPANY_BRANCH}&nbsp;&nbsp;
                {from?.gstin ?? COMPANY_GSTIN}
              </td>
              <td className="border border-gray-800 p-1">
                <span className="font-bold">GSTIN:</span>&nbsp;&nbsp;
                {to?.branch ?? COMPANY_BRANCH}&nbsp;&nbsp;
                {to?.gstin ?? COMPANY_GSTIN}
              </td>
            </tr>
            <tr>
              <td className="border border-gray-800 p-1">
                <span className="font-bold">Challan No.:</span> {t.challan_no ?? "—"}
              </td>
              <td className="border border-gray-800 p-1">
                <span className="font-bold">LR NO-</span> {t.lr_no ?? "—"}
              </td>
            </tr>
            <tr>
              <td className="border border-gray-800 p-1">
                <span className="font-bold">Date:</span>{" "}
                {t.transfer_date
                  ? new Date(t.transfer_date).toLocaleDateString("en-IN")
                  : "—"}
              </td>
              <td className="border border-gray-800 p-1">
                <span className="font-bold">TRANSPORTER ID</span>{" "}
                {t.transporter_id ?? to?.transporter_id ?? "—"}
              </td>
            </tr>
            <tr>
              <td className="border border-gray-800 p-1">
                <span className="font-bold">Vehicle No :-</span> {t.vehicle_no ?? "—"}
              </td>
              <td className="border border-gray-800 p-1">
                <span className="font-bold">EWAY BILL NO :-</span>{" "}
                {t.eway_bill_no ?? "—"}
              </td>
            </tr>
            <tr>
              <td className="border border-gray-800 p-1" />
              <td className="border border-gray-800 p-1">
                <span className="font-bold">E-Way Bill Date :-</span>{" "}
                {t.eway_bill_date
                  ? new Date(t.eway_bill_date).toLocaleDateString("en-IN")
                  : "—"}
              </td>
            </tr>
            <tr>
              <td className="border border-gray-800 p-1">
                <span className="font-bold">From :-</span>{" "}
                {from?.address ?? from?.name ?? "—"}
              </td>
              <td className="border border-gray-800 p-1">
                <span className="font-bold">Shipped TO</span>{" "}
                {to?.address ?? to?.name ?? "—"}
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── ITEMS TABLE ── */}
        <table className="mt-2 w-full border-collapse border border-gray-800 text-xs">
          <thead>
            <tr style={{ background: "#D4B8B8" }}>
              <th className={`${td} w-10 text-center`}>SR No.</th>
              <th className={`${td} w-24`}>ITEM CODE</th>
              <th className={`${td}`}>Item Name</th>
              <th className={`${td} w-20 text-center`}>
                HSN/SAC{"\n"}Code
              </th>
              <th className={`${td} w-16 text-center`}>Quantity</th>
              <th className={`${td} w-12 text-center`}>Unit</th>
              <th className={`${td} w-28 text-right`}>AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="h-6">
                <td className={tdC}>{i + 1}</td>
                <td className={td}>{r.item?.code ?? ""}</td>
                <td className={td}>{r.item?.description ?? ""}</td>
                <td className={tdC}>{r.item?.hsn_code ?? ""}</td>
                <td className={tdC}>{Number(r.qty_sent).toLocaleString("en-IN")}</td>
                <td className={tdC}>{r.item?.unit ?? "NOS"}</td>
                <td className={`${td} text-right`}>
                  {fmt(Number(r.qty_sent) * Number(r.rate ?? 0))}
                </td>
              </tr>
            ))}
            {/* blank rows to match original fixed-row layout */}
            {Array.from({ length: blankCount }).map((_, i) => (
              <tr key={`blank-${i}`} className="h-6">
                <td className={tdC} />
                <td className={td} />
                <td className={td} />
                <td className={tdC} />
                <td className={tdC} />
                <td className={tdC} />
                <td className={td} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className={td} colSpan={4}>
                Total(INCL TAX)
              </td>
              <td className={tdC}>{totalQty.toLocaleString("en-IN")}</td>
              <td className={tdC}>NOS</td>
              <td className={`${td} text-right`}>{fmt(totalAmt)}</td>
            </tr>
          </tfoot>
        </table>

        {/* ── FOOTER ── */}
        <div className="mt-3 flex justify-between text-xs">
          <div className="space-y-4">
            <div>
              <span className="font-bold">Remark :-</span>{" "}
              {t.remarks ?? ""}
            </div>
            <div className="font-bold">RECEIVER SIGNATURE</div>
          </div>
          <div className="font-bold">DRIVER SIGNATURE</div>
          <div className="text-right">
            <div>For, {COMPANY}</div>
            <div className="mt-6 border-t border-gray-800 pt-1">
              Authorized Signature
            </div>
          </div>
        </div>

        {/* ── BOTTOM BAR ── */}
        <div
          className="mt-4 flex justify-between px-4 py-1.5 text-xs text-white"
          style={{ background: "#7B1A1A" }}
        >
          <a href={`mailto:${EMAIL}`} className="underline">
            {EMAIL}
          </a>
          <div>
            <span className="mr-6">{WEBSITE}</span>
            <span>PAN NO:-{PAN}</span>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 8mm; }
          /* Hide the app chrome so only the challan prints */
          .no-print { display: none !important; }
          aside { display: none !important; }
          main { padding: 0 !important; }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          /* print backgrounds/colours (logo, maroon bars) exactly */
          #challan, #challan * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #challan {
            width: auto !important;
            min-height: 0 !important;   /* don't force a full-page box (avoids spilling to page 2) */
            padding: 0 !important;      /* @page margin already provides the border */
            margin: 0 !important;
            box-shadow: none !important;
          }
          /* keep the challan together on one page */
          #challan { page-break-inside: avoid; break-inside: avoid; }
        }
      `}</style>
    </>
  );
}
