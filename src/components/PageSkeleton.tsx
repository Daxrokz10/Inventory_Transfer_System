import { cn } from "@/lib/cn";

/* Instant placeholder shown by each route's loading.tsx while the server
   fetches the page's data, so a click in the sidebar responds immediately
   instead of leaving the old page on screen. */

function Bar({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} />;
}

export function PageSkeleton({ variant = "table" }: { variant?: "table" | "detail" | "form" }) {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Bar className="h-7 w-56" />
        <Bar className="h-4 w-80 max-w-full" />
      </div>

      {variant === "table" && (
        <>
          <div className="flex flex-wrap gap-3">
            <Bar className="h-9 w-48" />
            <Bar className="h-9 w-40" />
            <Bar className="h-9 w-20" />
          </div>
          <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <Bar className="mb-4 h-5 w-full" />
            <div className="space-y-3">
              {Array.from({ length: 10 }, (_, i) => (
                <Bar key={i} className="h-4 w-full" />
              ))}
            </div>
          </div>
        </>
      )}

      {variant === "detail" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-3 rounded-lg border border-line bg-surface p-5 shadow-sm lg:col-span-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Bar key={i} className="h-4 w-full" />
            ))}
          </div>
          <div className="space-y-3 rounded-lg border border-line bg-surface p-5 shadow-sm">
            {Array.from({ length: 5 }, (_, i) => (
              <Bar key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      )}

      {variant === "form" && (
        <div className="max-w-3xl space-y-4 rounded-lg border border-line bg-surface p-5 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Bar className="h-3 w-24" />
                <Bar className="h-9 w-full" />
              </div>
            ))}
          </div>
          <Bar className="h-9 w-32" />
        </div>
      )}
    </div>
  );
}
