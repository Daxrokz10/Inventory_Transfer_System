# Inventory Transfer System — Plan

A web app for **Shree Ganesh Corporation** to manage transfers of construction
shuttering & equipment material between project sites, replacing the Excel
ledger + challan workbooks.

## Stack
- **Next.js (App Router)** on **Vercel**
- **Supabase** — Postgres, Auth, Row-Level Security (source of truth)
- **Google Sheets** — read-only mirror of the Stock Report for the store head
  (built last; the app stays the source of truth)

## Roles
- **Admin (store head)** — full access; manages masters; can override/adjust;
  views the mirror Google Sheet.
- **Supervisor** — tied to a home site; creates dispatches **from** their site,
  approves receipts **to** their site. Enforced by RLS.

## Core workflow
1. Sender creates a transfer → status `dispatched`; stock leaves source as
   in-transit; a GST challan is generated.
2. Receiver opens the inbox, enters the **actual** quantity received, approves
   → status `received` (full) or `partial` (shortage/excess flagged).
3. Per-project balances recompute automatically from the `stock_balances` view.

## Data model (`supabase/migrations/`)
- `projects` — sites/jobs (code, name, address, GSTIN, branch, transporter)
- `items` — material master (code, description, unit, groups, HSN, rate)
- `profiles` — extends `auth.users`; role + home site
- `opening_balances` — seeded per project × item from the Stock Report
- `transfers` — challan header + lifecycle status
- `transfer_lines` — items with `qty_sent` / `qty_received`
- `stock_balances` (view) — opening + received − issued, per project × item

## Roadmap
- **Phase 0 — Foundations ✅** schema, RLS, Supabase wiring, auth, app shell,
  dashboard, masters (read), transfers list, inbox + new-transfer placeholders.
- **Phase 1 — Master data + import** importer that reads the two `.xlsx` files
  in `data/source/` into `projects`, `items`, `opening_balances`.
- **Phase 2 — Transfer workflow** create-dispatch form + receiver approval
  action (the heart of the app).
- **Phase 3 — Challan** printable GST Material Delivery Challan from a transfer.
- **Phase 4 — Google Sheet mirror** one-way sync of balances/transfers.

## Getting it running
1. Create a Supabase project → run `supabase/migrations/0001_schema.sql` then
   `0002_rls.sql` in the SQL editor.
2. `cp .env.local.example .env.local` and fill in the Project URL + anon key.
3. `npm run dev` → http://localhost:3000
4. Create a user (Supabase Auth), then set their `profiles.role = 'admin'` for
   the store head.
