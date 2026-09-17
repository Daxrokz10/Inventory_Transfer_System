import { createAdminClient } from "@/lib/supabase/admin";

/* Microsoft Graph access for the HR module.

   Delegated OAuth, not app-only: Excel workbook edits (range PATCH) are
   "Application: Not supported" in Graph, so the app acts as one connected
   Microsoft 365 account (HR's). Its refresh token lives in hr_ms_connection,
   a table with RLS on and no policies — only the service role can read it.

   Refresh tokens rotate: every refresh returns a new one, which is saved
   straight back so the connection never silently expires. */

const GRAPH = "https://graph.microsoft.com/v1.0";
export const MS_SCOPES = "offline_access User.Read Files.ReadWrite.All";

export function isMsConfigured(): boolean {
  return Boolean(
    process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET,
  );
}

function tenantUrl(path: string) {
  return `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/${path}`;
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: MS_SCOPES,
    state,
    prompt: "select_account",
  });
  return `${tenantUrl("authorize")}?${p}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
};

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(tenantUrl("token"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      scope: MS_SCOPES,
      ...params,
    }),
    cache: "no-store",
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) {
    throw new Error(json.error_description?.split("\r\n")[0] ?? json.error ?? "Microsoft sign-in failed");
  }
  return json;
}

/** OAuth callback: exchange the code, store the refresh token + account. */
export async function completeAuthorization(code: string, redirectUri: string): Promise<string> {
  const tok = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  if (!tok.refresh_token) throw new Error("Microsoft did not return a refresh token.");

  const me = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, {
    headers: { Authorization: `Bearer ${tok.access_token}` },
    cache: "no-store",
  }).then((r) => r.json() as Promise<{ mail?: string; userPrincipalName?: string }>);
  const email = me.mail ?? me.userPrincipalName ?? "unknown";

  cached = { token: tok.access_token, expiresAt: Date.now() + (tok.expires_in - 120) * 1000 };
  const admin = createAdminClient();
  const { error } = await admin
    .from("hr_ms_connection")
    .update({
      refresh_token: tok.refresh_token,
      account_email: email,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  return email;
}

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  if (!isMsConfigured()) throw new Error("Microsoft 365 is not configured (MS_* env vars missing).");

  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("hr_ms_connection")
    .select("refresh_token")
    .eq("id", 1)
    .maybeSingle();
  if (!conn?.refresh_token) throw new Error("Microsoft account not connected. Connect it in HR → Settings.");

  const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: conn.refresh_token });
  cached = { token: tok.access_token, expiresAt: Date.now() + (tok.expires_in - 120) * 1000 };
  if (tok.refresh_token && tok.refresh_token !== conn.refresh_token) {
    await admin.from("hr_ms_connection").update({ refresh_token: tok.refresh_token }).eq("id", 1);
  }
  return tok.access_token;
}

export function forgetCachedToken() {
  cached = null;
}

async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const res = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) msg = j.error.message;
    } catch {}
    throw new Error(`Microsoft Graph: ${msg}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ---------------- shares / items ---------------- */

export function shareId(url: string): string {
  const b64 = Buffer.from(url.trim(), "utf8")
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\//g, "_")
    .replace(/\+/g, "-");
  return `u!${b64}`;
}

export type DriveItem = {
  id: string;
  name: string;
  webUrl: string;
  parentReference: { driveId: string; id: string };
};

export async function resolveShareUrl(url: string): Promise<DriveItem> {
  return graph<DriveItem>(`/shares/${shareId(url)}/driveItem?$select=id,name,webUrl,parentReference`);
}

/** Short-lived embeddable preview URL (SharePoint / OneDrive for Business).
    Renders as the connected account, so it's only handed to signed-in users
    who can already see the candidate. */
export async function previewUrl(url: string): Promise<string | null> {
  const attempt = async (u: string) =>
    (
      await graph<{ getUrl?: string }>(`/shares/${shareId(u)}/driveItem/preview`, {
        method: "POST",
        body: JSON.stringify({}),
      })
    ).getUrl ?? null;
  try {
    return await attempt(url);
  } catch (e) {
    // Share links copied from OneDrive carry a ?e=… tracking token that the
    // shares endpoint sometimes rejects; the bare link resolves the same file.
    const bare = url.split("?")[0];
    if (bare === url) throw e;
    return attempt(bare);
  }
}

/** Current saved copy of a file (the .xlsx itself). Used only to read cell
    hyperlinks, which the workbook range API doesn't return. */
export async function downloadFile(driveId: string, itemId: string): Promise<ArrayBuffer> {
  const token = await accessToken();
  const res = await fetch(`${GRAPH}/drives/${driveId}/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Microsoft Graph: download failed (${res.status})`);
  return res.arrayBuffer();
}

/* ---------------- workbook ---------------- */

function wb(driveId: string, itemId: string) {
  return `/drives/${driveId}/items/${itemId}/workbook`;
}

export async function listWorksheets(driveId: string, itemId: string): Promise<string[]> {
  const r = await graph<{ value: { name: string }[] }>(`${wb(driveId, itemId)}/worksheets?$select=name`);
  return r.value.map((w) => w.name);
}

function sheetPath(driveId: string, itemId: string, sheet: string) {
  return `${wb(driveId, itemId)}/worksheets/${encodeURIComponent(sheet)}`;
}

/** Address of the used range (values only), e.g. "Sheet1!A1:M6012". Cheap:
    no cell values are returned. */
export async function usedRangeAddress(driveId: string, itemId: string, sheet: string): Promise<string | null> {
  const r = await graph<{ address: string; cellCount?: number }>(
    `${sheetPath(driveId, itemId, sheet)}/usedRange(valuesOnly=true)?$select=address`,
  );
  return r.address ?? null;
}

/** Values of an A1 range such as "A2:M1001". Callers keep blocks to ~1,000
    rows so responses stay well under Graph's size limits. */
export async function readRange(driveId: string, itemId: string, sheet: string, address: string): Promise<unknown[][]> {
  const r = await graph<{ values: unknown[][] }>(
    `${sheetPath(driveId, itemId, sheet)}/range(address='${address}')?$select=values`,
  );
  return r.values ?? [];
}

/** 0-based column index → Excel letters (0 → A, 26 → AA). */
export function colLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

/** Write a rectangular block whose top-left cell is (row 1-based, col 0-based).
    null entries leave the cell untouched. */
export async function writeBlock(
  driveId: string,
  itemId: string,
  sheet: string,
  row: number,
  startCol: number,
  values: (string | null)[][],
): Promise<void> {
  if (values.length === 0 || values[0].length === 0) return;
  const address =
    `${colLetter(startCol)}${row}:` +
    `${colLetter(startCol + values[0].length - 1)}${row + values.length - 1}`;
  await graph(`${sheetPath(driveId, itemId, sheet)}/range(address='${address}')`, {
    method: "PATCH",
    body: JSON.stringify({ values }),
  });
}
