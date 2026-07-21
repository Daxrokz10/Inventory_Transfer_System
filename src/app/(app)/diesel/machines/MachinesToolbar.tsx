"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Input } from "@/components/ui/Field";
import { cn } from "@/lib/cn";

// Owns the group-toggle + search box as one piece of state, so switching
// "By site"/"By type" always carries whatever is CURRENTLY typed in the
// search box — not a value baked into a link from the last page load.
// (Two separate uncoordinated controls for the same ?q= param was the
// bug: clearing the search box then clicking the toggle re-navigated
// using the toggle's stale, pre-clear href.)
export function MachinesToolbar({
  groupBy,
  initialQuery,
  showGroupToggle,
}: {
  groupBy: "site" | "type";
  initialQuery: string;
  showGroupToggle: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery);

  function navigate(nextGroup: "site" | "type", nextQuery: string) {
    const params = new URLSearchParams();
    params.set("group", nextGroup);
    if (nextQuery) params.set("q", nextQuery);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {showGroupToggle && (
        <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-1 text-xs font-semibold">
          {(["site", "type"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => navigate(g, query)}
              className={cn(
                "rounded-md px-3 py-1.5 capitalize transition-colors",
                groupBy === g ? "bg-accent text-white" : "text-ink-2 hover:text-ink",
              )}
            >
              By {g}
            </button>
          ))}
        </div>
      )}

      <form
        className="relative ml-auto w-full max-w-xs"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(groupBy, query);
        }}
      >
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search machine, type, plate, site…"
          className="pr-7"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              navigate(groupBy, "");
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink"
          >
            ×
          </button>
        )}
      </form>
    </div>
  );
}
