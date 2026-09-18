import { previewUrl } from "./graph";
import { getConnection, isExcelReady } from "./sync";

/** Turn a stored resume link into something an <iframe> can show.
    OneDrive / SharePoint links go through Graph's preview action (the plain
    share link refuses to be framed); Google Drive and direct PDFs are
    rewritten or used as-is. Returns null when no embed is possible. */
export type ResumeEmbed = { src: string | null; error?: string; note?: string };

/* Asking Graph for a preview link costs a round trip to Microsoft (two when
   the ?e=… token has to be dropped), which is the slow part of opening a
   candidate. The links Graph hands back stay valid for a while, so keep them
   for a few minutes: opening the same resume again, or a second person opening
   it, is then instant. */
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: ResumeEmbed }>();

export async function resumeEmbedUrl(url: string | null): Promise<ResumeEmbed> {
  if (!url) return { src: null };
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await resolveEmbed(url);
  // Errors aren't cached: a permission fix should show up straight away.
  if (value.src) {
    if (cache.size > 500) cache.clear();
    cache.set(url, { at: Date.now(), value });
  }
  return value;
}

async function resolveEmbed(url: string): Promise<ResumeEmbed> {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { src: null, error: "The resume link is not a valid URL." };
  }

  if (host.endsWith("sharepoint.com") || host.includes("onedrive") || host === "1drv.ms") {
    const conn = await getConnection();
    if (!isExcelReady(conn)) {
      return { src: null, error: "Connect Microsoft 365 in HR → Settings to preview OneDrive resumes here." };
    }
    try {
      return { src: await previewUrl(url) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/permission|no longer exists|accessDenied|itemNotFound/i.test(msg)) {
        // The connected account can't open this file (HR shared it with named
        // people only). Fall back to SharePoint's own embed view, which loads
        // with the *viewer's* Microsoft login instead of the app's.
        return {
          src: `${url}${url.includes("?") ? "&" : "?"}action=embedview`,
          note:
            `Shown with your own Microsoft sign-in: the account connected in HR → Settings ` +
            `(${conn.account_email ?? "unknown"}) doesn't have access to this file.`,
        };
      }
      return { src: null, error: msg };
    }
  }

  const drive = /drive\.google\.com\/file\/d\/([^/]+)/.exec(url);
  if (drive) return { src: `https://drive.google.com/file/d/${drive[1]}/preview` };
  if (/\.pdf($|\?)/i.test(url)) return { src: url };
  return { src: null };
}
