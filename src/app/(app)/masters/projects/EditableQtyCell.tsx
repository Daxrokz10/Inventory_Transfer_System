"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { adjustStockQty } from "./actions";

// A closing-balance cell that becomes editable on TRIPLE click.
// Enter saves, Escape cancels, blur cancels. Only rendered as editable for
// the allow-listed accounts; everyone else gets a plain read-only cell.
export function EditableQtyCell({
  projectId,
  itemId,
  value,
  display,
  className,
  label,
}: {
  projectId: string;
  itemId: string;
  value: number;
  display: string;
  className: string;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const open = () => {
    setDraft(String(value));
    setError(null);
    setEditing(true);
  };

  const save = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setError("Not a number");
      return;
    }
    if (n === value) {
      setEditing(false);
      return;
    }
    const fd = new FormData();
    fd.set("project_id", projectId);
    fd.set("item_id", itemId);
    fd.set("qty", String(n));
    fd.set("reason", `Closing balance edit: ${label}`);
    startTransition(async () => {
      const result = await adjustStockQty(null, fd);
      if (result) setError(result);
      else setEditing(false);
    });
  };

  if (editing) {
    return (
      <td className={`${className} relative p-0`}>
        <input
          ref={inputRef}
          type="number"
          step="any"
          value={draft}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          onBlur={() => {
            if (!pending) setEditing(false);
          }}
          className="w-full bg-surface px-2 py-1 text-right text-xs tabular-nums outline-none ring-2 ring-accent"
        />
        {error && (
          <span className="absolute left-0 top-full z-40 whitespace-nowrap rounded bg-danger px-1.5 py-0.5 text-[10px] text-white shadow">
            {error}
          </span>
        )}
      </td>
    );
  }

  return (
    <td
      // MouseEvent.detail counts clicks in a burst — 3 means triple click.
      onClick={(e) => {
        if (e.detail >= 3) {
          window.getSelection()?.removeAllRanges();
          open();
        }
      }}
      title={`${label} — triple-click to edit`}
      className={`${className} cursor-cell select-none`}
    >
      {display}
    </td>
  );
}
