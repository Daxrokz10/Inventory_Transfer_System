"use client";

import { useActionState } from "react";
import { login } from "./actions";
import { SgcLogo } from "@/components/SgcLogo";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(login, null);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-4">
          <SgcLogo size={56} />
          <div>
            <h1 className="text-xl font-bold uppercase tracking-[0.12em] text-ink">
              SGC <span className="text-ink-3">Suite</span>
            </h1>
            <p className="mt-0.5 text-xs text-ink-2">
              Shree Ganesh Corporation
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
          <p className="text-sm font-medium text-ink">Sign in to continue</p>
          <p className="mt-1 text-xs text-ink-3">
            One login for Inventory Transfers and the Diesel Report.
          </p>

          <form action={formAction} className="mt-5 flex flex-col gap-4">
            <Field label="Email">
              <Input name="email" type="email" required autoComplete="email" />
            </Field>
            <Field label="Password">
              <Input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </Field>

            {error && <p className="text-sm text-danger">{error}</p>}

            <Button type="submit" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>

        <div className="mt-4 flex justify-center gap-4 text-[11px] uppercase tracking-[0.1em] text-ink-3">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#1c5cab]" />
            Inventory
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#b45309]" />
            Diesel
          </span>
        </div>
      </div>
    </main>
  );
}
