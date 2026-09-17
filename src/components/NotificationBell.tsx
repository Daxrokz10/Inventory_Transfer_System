"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { markNotificationsRead } from "@/app/notifications-actions";

type Item = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const POLL_MS = 30_000;

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/** Sidebar bell. Polls every 30 s (and when the tab regains focus), shows the
    unread count, and lists recent notifications; clicking one marks it read
    and opens its page. */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [now, setNow] = useState(0);
  const lastUnread = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { unread: number; items: Item[] };
      setUnread(json.unread);
      setItems(json.items);
      setNow(Date.now());
      // A new one arrived while the tab is open: flag it in the tab title.
      if (lastUnread.current !== null && json.unread > lastUnread.current && document.hidden) {
        document.title = `(${json.unread}) ${document.title.replace(/^\(\d+\) /, "")}`;
      }
      lastUnread.current = json.unread;
    } catch {
      // offline / signed out: try again next tick
    }
  }, []);

  useEffect(() => {
    // Deferred so the first fetch isn't a synchronous setState inside the effect.
    const first = setTimeout(load, 0);
    const timer = setInterval(load, POLL_MS);
    const onFocus = () => {
      document.title = document.title.replace(/^\(\d+\) /, "");
      load();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openItem = async (n: Item) => {
    setOpen(false);
    if (!n.read_at) {
      setItems((cur) => cur.map((i) => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i)));
      setUnread((u) => Math.max(0, u - 1));
      await markNotificationsRead(n.id);
    }
    if (n.link) router.push(n.link);
  };

  const markAll = async () => {
    setItems((cur) => cur.map((i) => ({ ...i, read_at: i.read_at ?? new Date().toISOString() })));
    setUnread(0);
    await markNotificationsRead();
  };

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        className="relative rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-ink"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed left-60 top-4 z-50 w-96 max-w-[calc(100vw-16rem)] overflow-hidden rounded-lg border border-line bg-surface text-ink shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="text-xs font-medium text-accent hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-2">No notifications yet.</li>}
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className={cn(
                    "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2",
                    !n.read_at && "bg-accent-soft/40",
                  )}
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", n.read_at ? "text-ink-2" : "font-medium text-ink")}>{n.title}</span>
                    {n.body && <span className="block text-xs text-ink-2">{n.body}</span>}
                    <span className="block text-[11px] text-ink-3">{ago(n.created_at, now)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
