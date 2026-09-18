import { resumeEmbedUrl } from "@/lib/hr/resume";

/* The resume viewer. Asking Microsoft for a preview link takes a moment, so
   this is rendered inside a <Suspense> boundary: the rest of the page — the
   candidate's details, the evaluation form — is usable while it arrives. */

export function ResumeSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`flex min-h-[60vh] items-center justify-center rounded-md border border-line bg-surface-2 ${className}`}>
      <p className="text-sm text-ink-3">Loading the resume…</p>
    </div>
  );
}

export async function ResumeFrame({
  url,
  name,
  className = "",
}: {
  url: string | null;
  name: string;
  className?: string;
}) {
  const embed = await resumeEmbedUrl(url);
  return (
    <>
      {embed.note && <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">{embed.note}</p>}
      {embed.src ? (
        <iframe
          src={embed.src}
          title={`Resume — ${name}`}
          className={`w-full rounded-md border border-line bg-white ${className}`}
        />
      ) : (
        <div className="rounded-md border border-dashed border-line-strong p-6 text-sm text-ink-2">
          {url ? (embed.error ?? "This link can't be previewed here.") : "No resume link."}
        </div>
      )}
    </>
  );
}
