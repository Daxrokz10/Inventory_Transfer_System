"use client";

import { useActionState, useOptimistic, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { createUserWithAccess, setAccessFlag } from "./actions";
import { ACCESS_FLAGS, ACCESS_LABELS, type AccessFlag } from "./constants";

type Project = { id: string; code: string; name: string };

export function CreateUserWithAccessForm({ projects }: { projects: Project[] }) {
  const [error, action, pending] = useActionState(async (prev: string | null, fd: FormData) => {
    const r = await createUserWithAccess(prev, fd);
    if (!r) (document.getElementById("console-create-user") as HTMLFormElement | null)?.reset();
    return r;
  }, null);

  return (
    <form id="console-create-user" action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Full name *">
          <Input name="full_name" required />
        </Field>
        <Field label="Email (username) *">
          <Input name="email" type="email" required />
        </Field>
        <Field label="Password *" hint="At least 8 characters.">
          <Input name="password" type="password" required minLength={8} />
        </Field>
        <Field label="Home site" className="lg:col-span-3">
          <Select name="home_project_id" defaultValue="">
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-ink-2">Module access *</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {ACCESS_FLAGS.map((f) => (
            <label key={f} className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name={f} className="h-4 w-4 accent-[var(--color-accent)]" />
              {ACCESS_LABELS[f]}
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create user"}
      </Button>
    </form>
  );
}

/** One checkbox per access flag; saves on click and shows the new state at once. */
export function AccessToggle({ userId, flag, value }: { userId: string; flag: AccessFlag; value: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(value);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <label className="flex flex-col items-center gap-0.5" title={error ?? ACCESS_LABELS[flag]}>
      <input
        type="checkbox"
        checked={optimistic}
        disabled={pending}
        aria-label={ACCESS_LABELS[flag]}
        className="h-4 w-4 cursor-pointer accent-[var(--color-accent)] disabled:opacity-60"
        onChange={(e) => {
          const next = e.target.checked;
          const fd = new FormData();
          fd.set("user_id", userId);
          fd.set("flag", flag);
          fd.set("value", String(next));
          startTransition(async () => {
            setOptimistic(next);
            setError(await setAccessFlag(null, fd));
          });
        }}
      />
      {error && <span className="max-w-24 text-[10px] leading-tight text-danger">{error}</span>}
    </label>
  );
}
