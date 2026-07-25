"use client";

import { resolveRequirement, deleteRequirement } from "./actions";
import { Button } from "@/components/ui/Button";

export function RequirementResolveControls({ requirementId }: { requirementId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={resolveRequirement}>
        <input type="hidden" name="requirement_id" value={requirementId} />
        <input type="hidden" name="status" value="fulfilled" />
        <Button type="submit" size="sm" variant="secondary">
          Mark fulfilled
        </Button>
      </form>
      <form action={resolveRequirement}>
        <input type="hidden" name="requirement_id" value={requirementId} />
        <input type="hidden" name="status" value="cancelled" />
        <Button type="submit" size="sm" variant="ghost">
          Cancel
        </Button>
      </form>
      <form
        action={deleteRequirement}
        onSubmit={(e) => {
          if (!window.confirm("Delete this requirement? This can't be undone.")) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="requirement_id" value={requirementId} />
        <Button type="submit" size="sm" variant="ghost">
          Delete
        </Button>
      </form>
    </div>
  );
}
