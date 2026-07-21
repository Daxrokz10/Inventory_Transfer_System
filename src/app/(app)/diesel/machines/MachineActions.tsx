"use client";

import { useMemo, useState } from "react";
import {
  deactivateMachine,
  deleteMachine,
  reactivateMachine,
  transferMachine,
} from "./actions";
import { Input } from "@/components/ui/Field";
import { cn } from "@/lib/cn";
import type { Machine } from "@/lib/diesel/types";
import { EditMachineForm } from "./EditMachineForm";

type Site = { id: string; name: string; code: string | null };

// A left-aligned item inside the actions dropdown.
function MenuItem({
  onClick,
  danger,
  children,
}: {
  onClick?: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-2",
        danger ? "text-danger" : "text-ink",
      )}
    >
      {children}
    </button>
  );
}

// A form whose submit button looks like a menu item, with an optional
// confirm() gate. Used for deactivate/delete/reactivate.
function MenuFormItem({
  action,
  machineId,
  confirmText,
  danger,
  onDone,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  machineId: string;
  confirmText?: string;
  danger?: boolean;
  onDone: () => void;
  children: React.ReactNode;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) {
          e.preventDefault();
          return;
        }
        onDone();
      }}
    >
      <input type="hidden" name="machine_id" value={machineId} />
      <button
        type="submit"
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-2",
          danger ? "text-danger" : "text-ink",
        )}
      >
        {children}
      </button>
    </form>
  );
}

// Searchable site picker for the transfer modal — a plain <select> can't
// hold a list this long (hundreds of sites) without overflowing whatever
// modal it's in, and it can't show the site code alongside the name.
function TransferPicker({
  machine,
  sites,
  onDone,
}: {
  machine: Machine;
  sites: Site[];
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Site | null>(null);

  // Sorted by site code (falling back to name for sites without one) so
  // the list reads as an ordered index rather than the name-sorted order
  // it's fetched in.
  const options = useMemo(
    () =>
      sites
        .filter((s) => s.id !== machine.project_id)
        .sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name)),
    [sites, machine.project_id],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.code ?? "").toLowerCase().includes(q),
    );
  }, [query, options]);

  return (
    <form
      action={transferMachine}
      className="space-y-3"
      onSubmit={(e) => {
        if (!selected) {
          e.preventDefault();
          return;
        }
        onDone();
      }}
    >
      <input type="hidden" name="machine_id" value={machine.id} />
      <input type="hidden" name="project_id" value={selected?.id ?? ""} />

      <Input
        autoFocus
        placeholder="Search site by name or code…"
        value={selected ? `${selected.code ? `${selected.code} · ` : ""}${selected.name}` : query}
        onChange={(e) => {
          setSelected(null);
          setQuery(e.target.value);
        }}
      />

      {!selected && (
        <div className="max-h-72 overflow-y-auto rounded-md border border-line">
          {filtered.length === 0 ? (
            <p className="p-3 text-sm text-ink-3">No matching site.</p>
          ) : (
            filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSelected(s);
                  setQuery("");
                }}
                className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-sm last:border-0 hover:bg-surface-2"
              >
                {s.code && (
                  <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-ink-2">
                    {s.code}
                  </span>
                )}
                <span className="truncate">{s.name}</span>
              </button>
            ))
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={!selected}
        className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-strong disabled:opacity-50"
      >
        Move to {selected ? selected.name : "…"}
      </button>
    </form>
  );
}

// Admin actions for a machine, collapsed into one kebab menu so the table
// row stays tidy. The menu is fixed-positioned (anchored to the trigger)
// so it escapes the table's horizontal-scroll clipping.
export function MachineActions({
  machine,
  isAdmin,
  sites,
}: {
  machine: Machine;
  isAdmin: boolean;
  sites: Site[];
}) {
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [transferring, setTransferring] = useState(false);

  if (!isAdmin) {
    return <span className="text-xs text-ink-3">—</span>;
  }

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ top: r.bottom + 4, right: window.innerWidth - r.right });
  };
  const closeMenu = () => setMenu(null);

  const modalShell = (
    title: string,
    body: React.ReactNode,
    max = "max-w-3xl",
  ) => (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6"
      onClick={() => {
        setEditing(false);
        setTransferring(false);
      }}
    >
      <div
        className={cn("mt-10 w-full rounded-lg bg-surface p-5 shadow-xl", max)}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold">{title}</h3>
        {body}
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={openMenu}
        aria-label="Actions"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-strong text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>

      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeMenu} />
          <div
            className="fixed z-50 w-44 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg"
            style={{ top: menu.top, right: menu.right }}
          >
            <MenuItem
              onClick={() => {
                setEditing(true);
                closeMenu();
              }}
            >
              Edit
            </MenuItem>

            {machine.is_active ? (
              <>
                {machine.ownership === "internal" && (
                  <MenuItem
                    onClick={() => {
                      setTransferring(true);
                      closeMenu();
                    }}
                  >
                    Transfer site
                  </MenuItem>
                )}
                <div className="my-1 border-t border-line" />
                {machine.ownership === "external" ? (
                  <MenuFormItem
                    action={deleteMachine}
                    machineId={machine.id}
                    danger
                    onDone={closeMenu}
                    confirmText={`Permanently delete ${machine.name} and all its fuel history? This can't be undone.`}
                  >
                    Delete
                  </MenuFormItem>
                ) : (
                  <MenuFormItem
                    action={deactivateMachine}
                    machineId={machine.id}
                    onDone={closeMenu}
                    confirmText={`Deactivate ${machine.name}? It'll disappear from the daily report, but its fuel history stays intact.`}
                  >
                    Deactivate
                  </MenuFormItem>
                )}
              </>
            ) : (
              <MenuFormItem
                action={reactivateMachine}
                machineId={machine.id}
                onDone={closeMenu}
                confirmText={`Reactivate ${machine.name}?`}
              >
                Reactivate
              </MenuFormItem>
            )}
          </div>
        </>
      )}

      {editing &&
        modalShell(
          `Edit ${machine.name}`,
          <EditMachineForm machine={machine} onDone={() => setEditing(false)} />,
        )}

      {transferring &&
        modalShell(
          `Transfer ${machine.name}`,
          <TransferPicker
            machine={machine}
            sites={sites}
            onDone={() => setTransferring(false)}
          />,
          "max-w-lg",
        )}
    </>
  );
}
