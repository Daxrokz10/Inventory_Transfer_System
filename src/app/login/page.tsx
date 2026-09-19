"use client";

import { useActionState, useState } from "react";
import { login } from "./actions";

/* The login page wears the company's own colours — the gold and maroon of the
   SGC mark — rather than any one module's, since it leads into all three. */

const GOLD = "#d4a02f";
const MAROON = "#8e1b1b";

const MODULES = [
  {
    name: "Inventory",
    color: "#3b82e8",
    line: "Material transfers, stock and receiving across sites",
    icon: (
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Zm0 0L12 12m0 0 9-4.5M12 12v9" strokeLinejoin="round" />
    ),
  },
  {
    name: "Diesel",
    color: "#e8912a",
    line: "Fuel issues, machine efficiency and site reports",
    icon: (
      <path
        d="M12 3s6 6.2 6 10.5A6 6 0 0 1 6 13.5C6 9.2 12 3 12 3Zm-2.5 11a2.5 2.5 0 0 0 2.5 2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    name: "HR",
    color: "#2bb3a1",
    line: "Candidates, interviews and openings",
    icon: (
      <path
        d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm10 9v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.1a3.5 3.5 0 0 1 0 6.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
];

const inputClass =
  "w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink " +
  "placeholder:text-ink-3 transition-colors focus:border-[#d4a02f] focus:outline-none focus:ring-4 focus:ring-[#d4a02f]/20";

function Mark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/sgc-logo-mark.png" alt="SGC" width={303} height={201} className={className} />
  );
}

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(login, null);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="grid min-h-screen grid-cols-1 bg-page lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ---------- Brand panel ---------- */}
      <section
        className="relative hidden overflow-hidden px-14 py-10 text-white lg:flex lg:flex-col"
        style={{
          background:
            "radial-gradient(55rem 32rem at 0% 100%, rgba(212,160,47,0.16), transparent 60%)," +
            "radial-gradient(45rem 28rem at 100% 0%, rgba(142,27,27,0.28), transparent 60%)," +
            "#101318",
        }}
      >
        {/* faint blueprint grid — a nod to the construction work behind it */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse at 30% 40%, black 20%, transparent 75%)",
          }}
        />

        <div className="relative flex items-center gap-3">
          <Mark className="hidden h-8 w-auto [@media(max-height:760px)]:block" />
          <div className="leading-tight">
            <p className="text-sm font-bold uppercase tracking-[0.2em]">SGC Suite</p>
            <p className="text-[11px] text-white/55">Shree Ganesh Corporation</p>
          </div>
        </div>

        {/* Sized to fit a laptop screen without scrolling; on short windows the
            big mark steps aside so the text and modules still fit. */}
        <div className="relative my-auto max-w-lg py-6">
          <Mark className="mb-7 h-20 w-auto drop-shadow-[0_10px_30px_rgba(212,160,47,0.25)] [@media(max-height:760px)]:hidden" />
          <h1 className="text-[2.25rem] font-semibold leading-[1.12] tracking-tight">
            Everything the company runs on,{" "}
            <span style={{ color: GOLD }}>behind one sign-in.</span>
          </h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/60">
            You&apos;ll land on the modules your account has access to, and can move between them from the sidebar.
          </p>

          <ul className="mt-7 grid gap-2.5">
            {MODULES.map((m) => (
              <li
                key={m.name}
                className="flex items-center gap-4 rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3 backdrop-blur-sm"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: `${m.color}1f`, color: m.color }}
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
                    {m.icon}
                  </svg>
                </span>
                <span>
                  <span className="block text-sm font-semibold">{m.name}</span>
                  <span className="block text-[13px] text-white/55">{m.line}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11px] uppercase tracking-[0.18em] text-white/40">
          Internal use · Shree Ganesh Corporation
        </p>
      </section>

      {/* ---------- Sign-in ---------- */}
      <section className="flex min-w-0 items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[26rem]">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <Mark className="h-16 w-auto" />
            <p className="mt-3 text-xs font-bold uppercase tracking-[0.22em] text-ink-2">SGC Suite</p>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-7 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.45)] sm:p-8">
            <h2 className="text-center text-2xl font-semibold tracking-tight text-ink">Welcome back</h2>
            <p className="mt-1.5 text-center text-sm text-ink-2">Sign in to Inventory, Diesel and HR</p>

            <form action={formAction} className="mt-7 flex flex-col gap-5">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-2">Email</span>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@company.com"
                  className={inputClass}
                />
              </label>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="login-password" className="text-xs font-medium text-ink-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    className={`${inputClass} pr-16`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 rounded-r-lg px-3.5 text-xs font-medium text-ink-3 transition-colors hover:text-ink"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {error && (
                <p className="rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={pending}
                className="mt-1 w-full rounded-lg px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 active:brightness-95 disabled:opacity-60"
                style={{ background: `linear-gradient(180deg, #a52323, ${MAROON})` }}
              >
                {pending ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-ink-3">
            Forgot your password or need access? Ask the administrator.
          </p>

          {/* The module list lives in the brand panel on wide screens. */}
          <div className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.14em] text-ink-3 lg:hidden">
            {MODULES.map((m) => (
              <span key={m.name} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
                {m.name}
              </span>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
