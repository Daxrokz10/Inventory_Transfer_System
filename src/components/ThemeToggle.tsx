"use client";

import { useEffect, useState } from "react";

type Mode = "light" | "dark";

// Lets the viewer pick Daylight or Instrument. The choice is written to
// <html data-mode> and persisted; the no-flash script in the root layout
// re-applies it before first paint. Absent a choice we follow the OS.
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    const saved =
      document.documentElement.getAttribute("data-mode") ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    setMode(saved as Mode);
  }, []);

  function apply(next: Mode) {
    document.documentElement.setAttribute("data-mode", next);
    try {
      localStorage.setItem("sgc-theme", next);
    } catch {
      // storage unavailable — the choice just won't persist
    }
    setMode(next);
  }

  const next: Mode = mode === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => apply(next)}
      aria-label={`Switch to ${next === "dark" ? "Instrument (dark)" : "Daylight (light)"} theme`}
      title={mode === "dark" ? "Instrument" : "Daylight"}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-ink"
    >
      <span aria-hidden className="text-sm leading-none">
        {mode === "dark" ? "◐" : "◑"}
      </span>
      {mode === "dark" ? "Instrument" : "Daylight"}
    </button>
  );
}
