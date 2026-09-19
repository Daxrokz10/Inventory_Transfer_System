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

/* A desktop (OS) notification. Only while you're away from the tab — when
   you're looking at the app, the bell is enough. The tag stops two open tabs
   from popping the same one twice. */
function showDesktop(n: Item, onClick: () => void) {
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  try {
    const popup = new Notification(n.title, {
      body: n.body ?? undefined,
      tag: `sgc-notification-${n.id}`,
      icon: "/sgc-logo.png",
    });
    popup.onclick = () => {
      window.focus();
      popup.close();
      onClick();
    };
  } catch {
    // some browsers (Android Chrome) only allow notifications from a service worker
  }
}

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/** Sidebar bell. Polls every 30 s (and when the tab regains focus), shows the
    unread count, and lists recent notifications; clicking one marks it read
    and opens its page. Once allowed, new ones also appear as desktop
    notifications while the app is open in another tab or minimised. */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [now, setNow] = useState(0);
  const lastUnread = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Ids already seen by this tab, so only notifications that arrive while the
  // app is open pop up on the desktop — not the backlog on first load.
  const seen = useRef<Set<number> | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  const load = useCallback(async () => {
    try {
      const supported = typeof window !== "undefined" && "Notification" in window;
      setPermission(supported ? Notification.permission : "unsupported");
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { unread: number; items: Item[] };
      setUnread(json.unread);
      setItems(json.items);
      setNow(Date.now());
      if (seen.current === null) {
        seen.current = new Set(json.items.map((n) => n.id));
      } else {
        const fresh = json.items.filter((n) => !n.read_at && !seen.current!.has(n.id));
        fresh.forEach((n) => seen.current!.add(n.id));
        if (supported && Notification.permission === "granted") {
          fresh.reverse().forEach((n) =>
            showDesktop(n, () => {
              void markNotificationsRead(n.id).then(() => setUnread((u) => Math.max(0, u - 1)));
              if (n.link) router.push(n.link);
            }),
          );
        }
      }
      // A new one arrived while the tab is open: flag it in the tab title.
      if (lastUnread.current !== null && json.unread > lastUnread.current && document.hidden) {
        document.title = `(${json.unread}) ${document.title.replace(/^\(\d+\) /, "")}`;
      }
      lastUnread.current = json.unread;
    } catch {
      // offline / signed out: try again next tick
    }
  }, [router]);

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

  const enableDesktop = async () => {
    if (!("Notification" in window)) return;
    setPermission(await Notification.requestPermission());
  };

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
          {permission === "default" && (
            <div className="flex items-center justify-between gap-3 border-b border-line bg-accent-soft/40 px-4 py-2.5">
              <p className="text-xs text-ink-2">Get a desktop alert when something new comes in while you&apos;re in another tab.</p>
              <button
                type="button"
                onClick={enableDesktop}
                className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-strong"
              >
                Turn on
              </button>
            </div>
          )}
          {permission === "denied" && (
            <p className="border-b border-line px-4 py-2 text-xs text-ink-3">
              Desktop alerts are blocked for this site. Allow notifications in the browser&apos;s site settings (the icon left of
              the address) to turn them on.
            </p>
          )}
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
