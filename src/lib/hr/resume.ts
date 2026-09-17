import { previewUrl } from "./graph";
import { getConnection, isExcelReady } from "./sync";

/** Turn a stored resume link into something an <iframe> can show.
    OneDrive / SharePoint links go through Graph's preview action (the plain
    share link refuses to be framed); Google Drive and direct PDFs are
    rewritten or used as-is. Returns null when no embed is possible. */
export async function resumeEmbedUrl(url: string | null): Promise<{ src: string | null; error?: string }> {
  if (!url) return { src: null };
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
        return {
          src: null,
          error:
            `The Microsoft account connected in HR → Settings (${conn.account_email ?? "unknown"}) can't open this file. ` +
            "Connect the account that owns the resumes, or share the resumes folder with this account.",
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
