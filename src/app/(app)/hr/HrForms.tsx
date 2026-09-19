"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { FIELD_LABELS } from "@/lib/hr/sheet";
import {
  addPanelInterviewer,
  assignPanel,
  cancelPanel,
  createOpening,
  disconnectMicrosoft,
  addStage,
  quickAddCandidate,
  removePanelInterviewer,
  saveHrDecision,
  saveStages,
  saveWorkbook,
  setCandidateOpening,
  setCandidateResume,
  setCandidateStatus,
  setOpeningStatus,
  submitFeedback,
  syncNow,
  tagCandidateToOpening,
  updateCandidate,
  type QuickAddState,
} from "./actions";

function ErrorLine({ msg }: { msg: string | null | undefined }) {
  if (!msg) return null;
  return <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{msg}</p>;
}

// Enter in a text input shouldn't submit a long form by accident.
const blockEnter = (e: React.KeyboardEvent<HTMLFormElement>) => {
  if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
};

export type OpeningOption = { code: string; designation: string; site?: string | null };
export type PersonOption = { id: string; label: string };

/* ---------------- candidates ---------------- */

/** Built for speed: one row of essentials, Enter moves to the next field,
    Ctrl+Enter saves, the form clears and focuses Name again after each add. */
export function QuickAddForm({
  stages,
  openings,
  designations,
  defaultStatus,
}: {
  stages: string[];
  openings: OpeningOption[];
  designations: string[];
  defaultStatus: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [more, setMore] = useState(false);
  const [state, action, pending] = useActionState(async (prev: QuickAddState, fd: FormData) => {
    const r = await quickAddCandidate(prev, fd);
    if (r?.added) {
      formRef.current?.reset();
      formRef.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
    }
    return r;
  }, null);

  const onKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    const el = e.target as HTMLElement;
    if (e.key !== "Enter" || el.tagName === "TEXTAREA") return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      formRef.current?.requestSubmit();
      return;
    }
    const fields = [...(formRef.current?.querySelectorAll<HTMLElement>("input:not([type=hidden]), select, textarea") ?? [])];
    fields[fields.indexOf(el) + 1]?.focus();
  };

  return (
    <form ref={formRef} action={action} onKeyDown={onKeyDown} className="space-y-3">
      {state?.duplicate && <input type="hidden" name="confirm_duplicate" value="yes" />}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Name *" className="lg:col-span-2">
          <Input name="name" required autoFocus />
        </Field>
        <Field label="Designation">
          <Input name="designation" list="hr-designations" autoComplete="off" />
          <datalist id="hr-designations">
            {designations.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </Field>
        <Field label="Phone">
          <Input name="phone" inputMode="tel" />
        </Field>
        <Field label="Experience">
          <Input name="experience_years" />
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={defaultStatus ?? ""}>
            <option value="">—</option>
            {stages.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Current salary">
          <Input name="current_salary" />
        </Field>
        <Field label="Expected salary">
          <Input name="expected_salary" />
        </Field>
        <Field label="Opening (optional)">
          <Select name="opening_code" defaultValue="">
            <option value="">None</option>
            {openings.map((o) => (
              <option key={o.code} value={o.code}>
                {o.code}
                {o.site ? ` · ${o.site}` : ""} · {o.designation}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Resume (OneDrive link)" className="sm:col-span-3 lg:col-span-3">
          <Input name="resume_url" type="url" placeholder="https://…sharepoint.com/…" />
        </Field>
      </div>

      {more && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={FIELD_LABELS.industry_experience}>
            <Input name="industry_experience" />
          </Field>
          <Field label={FIELD_LABELS.job_change_reason}>
            <Input name="job_change_reason" />
          </Field>
          <Field label={FIELD_LABELS.hr_remarks}>
            <Input name="hr_remarks" />
          </Field>
        </div>
      )}

      {state?.duplicate && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          This phone number is already on file: {state.duplicate}. Press <b>Add</b> again to add anyway.
        </p>
      )}
      <ErrorLine msg={state?.error} />
      {state?.added && <p className="text-sm text-good">{state.added}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
        <button type="button" onClick={() => setMore((m) => !m)} className="text-sm text-accent hover:underline">
          {more ? "Fewer fields" : "Remarks, reason, industry…"}
        </button>
        <span className="text-xs text-ink-3">Enter = next field · Ctrl+Enter = add</span>
      </div>
    </form>
  );
}

type CandidateFormValues = Partial<Record<keyof typeof FIELD_LABELS, string | null>> & { id: string };

export function EditCandidateForm({ c }: { c: CandidateFormValues }) {
  const [open, setOpen] = useState(false);
  const [error, action, pending] = useActionState(async (prev: string | null, fd: FormData) => {
    const r = await updateCandidate(prev, fd);
    if (!r) setOpen(false);
    return r;
  }, null);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Edit details
      </Button>
    );
  }
  const v = (k: keyof typeof FIELD_LABELS) => c[k] ?? "";
  return (
    <form action={action} onKeyDown={blockEnter} className="space-y-4 rounded-lg border border-line bg-inset p-4">
      <input type="hidden" name="id" value={c.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        {(["name", "designation", "phone", "experience_years", "current_salary", "expected_salary", "industry_experience"] as const).map(
          (f) => (
            <Field key={f} label={FIELD_LABELS[f] + (f === "name" ? " *" : "")}>
              <Input name={f} defaultValue={v(f)} required={f === "name"} />
            </Field>
          ),
        )}
        <Field label={FIELD_LABELS.job_change_reason} className="sm:col-span-2">
          <Textarea name="job_change_reason" rows={2} defaultValue={v("job_change_reason")} />
        </Field>
        <Field label={FIELD_LABELS.hr_remarks} className="sm:col-span-2">
          <Textarea name="hr_remarks" rows={3} defaultValue={v("hr_remarks")} />
        </Field>
      </div>
      <p className="text-xs text-ink-3">Only the fields you change are written to the Excel.</p>
      <ErrorLine msg={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Which statuses ask for a date: Joined needs one, an accepted offer takes
    the expected joining day if HR knows it. */
export type JoiningStages = { joined: string | null; accepted: string[] };

function JoiningDate({ status, stages, defaultDate }: { status: string; stages?: JoiningStages; defaultDate?: string | null }) {
  if (!stages || !status) return null;
  const isJoined = status === stages.joined;
  if (!isJoined && !stages.accepted.includes(status)) return null;
  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-2">
      {isJoined ? "Joined on *" : "Expected joining"}
      <Input
        name="joining_date"
        type="date"
        required={isJoined}
        defaultValue={isoDay(defaultDate ?? null)}
        className="w-auto py-1 text-xs"
      />
    </label>
  );
}

export function StatusForm({
  id,
  status,
  stages,
  joining,
  dateOfJoining,
}: {
  id: string;
  status: string | null;
  stages: string[];
  joining?: JoiningStages;
  dateOfJoining?: string | null;
}) {
  const known = !status || stages.includes(status);
  const [choice, setChoice] = useState(known ? (status ?? "") : "__custom");
  const [error, action, pending] = useActionState(setCandidateStatus, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Select name="status" value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">—</option>
        {stages.map((s) => (
          <option key={s}>{s}</option>
        ))}
        <option value="__custom">Other…</option>
      </Select>
      {choice === "__custom" && <Input name="status_custom" defaultValue={known ? "" : (status ?? "")} placeholder="Status" />}
      <JoiningDate status={choice} stages={joining} defaultDate={dateOfJoining} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Set status"}
      </Button>
      {error && <span className="max-w-md text-xs text-danger">{error}</span>}
    </form>
  );
}

export function ResumeLinkForm({ id, url }: { id: string; url: string | null }) {
  const [open, setOpen] = useState(!url);
  const [error, action, pending] = useActionState(async (prev: string | null, fd: FormData) => {
    const r = await setCandidateResume(prev, fd);
    if (!r) setOpen(false);
    return r;
  }, null);
  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Change link
      </Button>
    );
  }
  return (
    <form action={action} onKeyDown={blockEnter} className="flex w-full flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="resume_url" type="url" defaultValue={url ?? ""} placeholder="OneDrive link" className="min-w-72 flex-1" />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save link"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </form>
  );
}

export function OpeningForm({ id, code, openings }: { id: string; code: string | null; openings: OpeningOption[] }) {
  const [error, action, pending] = useActionState(setCandidateOpening, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Select
        name="opening_code"
        defaultValue={code ?? ""}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="py-1 text-xs"
      >
        <option value="">No opening</option>
        {openings.map((o) => (
          <option key={o.code} value={o.code}>
            {o.code}
            {o.site ? ` · ${o.site}` : ""} · {o.designation}
          </option>
        ))}
      </Select>
      {error && <span className="text-xs text-danger">{error}</span>}
    </form>
  );
}

/* ---------------- interview panels ---------------- */

export function AssignPanelForm({
  candidateId,
  nextRound,
  existingRounds,
  people,
}: {
  candidateId: string;
  nextRound: number;
  existingRounds: number[];
  people: PersonOption[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, action, pending] = useActionState(async (prev: string | null, fd: FormData) => {
    const r = await assignPanel(prev, fd);
    if (!r) {
      formRef.current?.reset();
      setPicked([]);
      setQ("");
    }
    return r;
  }, null);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? people.filter((p) => p.label.toLowerCase().includes(s)) : people;
  }, [q, people]);
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const labelOf = new Map(people.map((p) => [p.id, p.label]));

  return (
    <form ref={formRef} action={action} onKeyDown={blockEnter} className="space-y-4">
      <input type="hidden" name="candidate_id" value={candidateId} />
      {picked.map((id) => (
        <input key={id} type="hidden" name="interviewer_id" value={id} />
      ))}

      <Field label="Interviewers * (pick one or more)">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" />
      </Field>
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {picked.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id)}
              className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent-strong hover:bg-danger-soft hover:text-danger"
            >
              {labelOf.get(id)} ✕
            </button>
          ))}
        </div>
      )}
      <div className="max-h-48 overflow-y-auto rounded-md border border-line">
        {shown.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-surface-2">
            <input
              type="checkbox"
              checked={picked.includes(p.id)}
              onChange={() => toggle(p.id)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            {p.label}
          </label>
        ))}
        {shown.length === 0 && <p className="px-3 py-2 text-sm text-ink-3">No match.</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date & time">
          <Input name="scheduled_at" type="datetime-local" />
        </Field>
        <Field label="Which round *" hint="Each round is a separate step in the candidate's progress.">
          <Select name="round" defaultValue={String(nextRound)}>
            {existingRounds.map((r) => (
              <option key={r} value={r}>
                Round {r} — add interviewers to this round
              </option>
            ))}
            <option value={nextRound}>Round {nextRound} — new round</option>
          </Select>
        </Field>
        <Field label="Mode / location" className="sm:col-span-2">
          <Input name="mode" placeholder="In person — Head office, Phone, Video call…" />
        </Field>
        <Field label="Note for the interviewers" className="sm:col-span-2">
          <Textarea name="hr_note" rows={2} />
        </Field>
      </div>
      <ErrorLine msg={error} />
      <Button type="submit" disabled={pending || picked.length === 0}>
        {pending ? "Sending…" : `Send to ${picked.length || ""} interviewer${picked.length === 1 ? "" : "s"}`}
      </Button>
    </form>
  );
}

export function AddPanelInterviewerForm({ panelId, people }: { panelId: string; people: PersonOption[] }) {
  const [open, setOpen] = useState(false);
  const [error, action, pending] = useActionState(async (prev: string | null, fd: FormData) => {
    const r = await addPanelInterviewer(prev, fd);
    if (!r) setOpen(false);
    return r;
  }, null);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-accent hover:underline">
        + Add interviewer
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="panel_id" value={panelId} />
      <Select name="interviewer_id" required defaultValue="" className="py-1 text-xs">
        <option value="" disabled>
          Choose…
        </option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" disabled={pending}>
        Add
      </Button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-3">
        Cancel
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </form>
  );
}

export function RemoveInterviewerButton({ id }: { id: string }) {
  const [error, action, pending] = useActionState(removePanelInterviewer, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Remove this interviewer from the panel?")) e.preventDefault();
      }}
      className="inline-flex items-center gap-1"
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="text-xs text-danger hover:underline disabled:opacity-60">
        remove
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </form>
  );
}

export function CancelPanelButton({ panelId, candidateId }: { panelId: string; candidateId: string }) {
  const [error, action, pending] = useActionState(cancelPanel, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Cancel this interview for everyone who hasn't submitted feedback?")) e.preventDefault();
      }}
      className="inline-flex items-center gap-2"
    >
      <input type="hidden" name="panel_id" value={panelId} />
      <input type="hidden" name="candidate_id" value={candidateId} />
      <button type="submit" disabled={pending} className="text-xs font-medium text-danger hover:underline disabled:opacity-60">
        {pending ? "Cancelling…" : "Cancel interview"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </form>
  );
}

export function FeedbackForm({ id }: { id: string }) {
  const [error, action, pending] = useActionState(submitFeedback, null);
  return (
    <form action={action} onKeyDown={blockEnter} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <Field label="Feedback *">
        <Textarea name="feedback" rows={5} required placeholder="Technical knowledge, communication, attitude, fit for the role…" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Rating *">
          <Select name="rating" required defaultValue="">
            <option value="" disabled>
              Choose
            </option>
            <option value="5">5 — Excellent</option>
            <option value="4">4 — Good</option>
            <option value="3">3 — Average</option>
            <option value="2">2 — Below average</option>
            <option value="1">1 — Poor</option>
          </Select>
        </Field>
        <Field label="Recommendation *" hint="HR makes the final decision.">
          <Select name="recommendation" required defaultValue="">
            <option value="" disabled>
              Choose
            </option>
            <option value="hire">Hire</option>
            <option value="next_round">Next round</option>
            <option value="hold">On hold</option>
            <option value="reject">Reject</option>
          </Select>
        </Field>
      </div>
      <ErrorLine msg={error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Submit feedback"}
      </Button>
    </form>
  );
}

/* ---------------- openings ---------------- */

export function NewOpeningForm({
  projects,
  designations,
}: {
  projects: { id: string; code: string; name: string }[];
  designations: string[];
}) {
  const [error, action, pending] = useActionState(createOpening, null);
  const [title, setTitle] = useState("");
  return (
    <form action={action} onKeyDown={blockEnter} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Designation / post *" hint="Same titles the candidate sheet uses.">
          <Select name="designation" required value={title} onChange={(e) => setTitle(e.target.value)}>
            <option value="" disabled>
              Choose a title
            </option>
            {designations.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            <option value="__other">Other…</option>
          </Select>
        </Field>
        {title === "__other" && (
          <Field label="New title *">
            <Input name="designation_other" required placeholder="e.g. Quantity Surveyor" />
          </Field>
        )}
        <Field label="Site">
          <Select name="project_id" defaultValue="">
            <option value="">Not site-specific</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="How many people *">
          <Input name="headcount" type="number" min={1} defaultValue={1} required />
        </Field>
        <Field label="Needed by">
          <Input name="required_by" type="date" />
        </Field>
        <Field label="Experience">
          <Input name="experience" placeholder="3–5 years in road projects" />
        </Field>
        <Field label="Salary range">
          <Input name="salary_range" placeholder="₹30,000–40,000 / month" />
        </Field>
        <Field label="Priority">
          <Select name="priority" defaultValue="normal">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        </Field>
        <Field label="Details / requirements" className="sm:col-span-2">
          <Textarea name="description" rows={4} />
        </Field>
      </div>
      <ErrorLine msg={error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Raise opening"}
      </Button>
    </form>
  );
}

export function OpeningStatusForm({ id, status }: { id: string; status: string }) {
  const [error, action, pending] = useActionState(setOpeningStatus, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Select name="status" defaultValue={status} disabled={pending} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        <option value="open">Open</option>
        <option value="in_progress">In progress</option>
        <option value="accepted">Completed — not yet joined</option>
        <option value="filled">Filled</option>
        <option value="cancelled">Cancelled</option>
      </Select>
      {error && <span className="text-xs text-danger">{error}</span>}
    </form>
  );
}

export function TagCandidateForm({ openingCode }: { openingCode: string }) {
  const [error, action, pending] = useActionState(async (prev: string | null, fd: FormData) => {
    const r = await tagCandidateToOpening(prev, fd);
    if (!r) (document.getElementById("tag-candidate") as HTMLFormElement | null)?.reset();
    return r;
  }, null);
  return (
    <form id="tag-candidate" action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="opening_code" value={openingCode} />
      <Input name="candidate_code" placeholder="Candidate ID, e.g. CAND-0123" required />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Tagging…" : "Tag candidate"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </form>
  );
}

/* ---------------- settings ---------------- */

export function SyncButton() {
  const [msg, action, pending] = useActionState(syncNow, null);
  return (
    <form action={action} className="flex items-center gap-2">
      {msg && <span className={msg.startsWith("Sync failed") ? "text-xs text-danger" : "text-xs text-good"}>{msg}</span>}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Syncing…" : "Sync now"}
      </Button>
    </form>
  );
}

export function WorkbookForm({ url, sheet }: { url: string | null; sheet: string | null }) {
  const [msg, action, pending] = useActionState(saveWorkbook, null);
  const bad = msg && !msg.startsWith("Synced");
  return (
    <form action={action} onKeyDown={blockEnter} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Excel share link *" className="sm:col-span-2" hint="In Excel Online: Share → Copy link.">
          <Input name="workbook_url" type="url" required defaultValue={url ?? ""} />
        </Field>
        <Field label="Sheet name" hint="Blank = first sheet.">
          <Input name="sheet_name" defaultValue={sheet ?? ""} />
        </Field>
      </div>
      {msg && <p className={bad ? "text-sm text-danger" : "text-sm text-good"}>{msg}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Connecting & syncing (can take a minute)…" : "Save & sync"}
      </Button>
    </form>
  );
}

export function DisconnectButton() {
  const [error, action, pending] = useActionState(disconnectMicrosoft, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Disconnect Microsoft? Excel sync and resume previews stop until reconnected.")) e.preventDefault();
      }}
      className="inline-flex items-center gap-2"
    >
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? "Disconnecting…" : "Disconnect"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </form>
  );
}

export type StageRow = { name: string; sort_order: number; kind: string; count: number };

export function StagesForm({ stages }: { stages: StageRow[] }) {
  const [msg, action, pending] = useActionState(saveStages, null);
  return (
    <form action={action} onKeyDown={blockEnter} className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink-3">
              <th className="py-2 pr-3">Order</th>
              <th className="py-2 pr-3">Status (from the Excel)</th>
              <th className="py-2 pr-3">Candidates</th>
              <th className="py-2">Kind</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.name} className="border-t border-line">
                <td className="py-1.5 pr-3">
                  <input type="hidden" name="name" value={s.name} />
                  <Input
                    name="sort_order"
                    type="number"
                    defaultValue={s.sort_order >= 1000 ? "" : s.sort_order}
                    placeholder="—"
                    className="w-20 py-1"
                  />
                </td>
                <td className="py-1.5 pr-3 font-medium text-ink">
                  {s.name}
                  {s.sort_order >= 1000 && <span className="ml-2 text-xs text-warn">unsorted</span>}
                </td>
                <td className="py-1.5 pr-3 tabular-nums text-ink-2">{s.count}</td>
                <td className="py-1.5">
                  <Select name="kind" defaultValue={s.kind} className="py-1">
                    <option value="active">In process</option>
                    <option value="hold">On hold</option>
                    <option value="success">Success (selected / joined)</option>
                    <option value="closed">Closed (rejected / dropped)</option>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <p className={msg === "Saved." ? "text-sm text-good" : "text-sm text-danger"}>{msg}</p>}
      <Button type="submit" disabled={pending || stages.length === 0}>
        {pending ? "Saving…" : "Save stage order"}
      </Button>
    </form>
  );
}

/** Status dropdown on the Candidates list: changes save as soon as a value
    is picked (only the Status cell of that row is written to the Excel). */
export function InlineStatusSelect({
  id,
  status,
  stages,
  joining,
}: {
  id: string;
  status: string | null;
  stages: string[];
  joining?: JoiningStages;
}) {
  const [error, action, pending] = useActionState(setCandidateStatus, null);
  const [choice, setChoice] = useState(status ?? "");
  const options = status && !stages.includes(status) ? [status, ...stages] : stages;
  // Most statuses save the moment they are picked; joining ones wait for a date.
  const needsDate = Boolean(joining && choice && (choice === joining.joined || joining.accepted.includes(choice)));
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <select
        name="status"
        value={choice}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          setChoice(next);
          const asks = Boolean(joining && next && (next === joining.joined || joining.accepted.includes(next)));
          if (!asks) e.currentTarget.form?.requestSubmit();
        }}
        className="max-w-48 rounded-md border border-line-strong bg-surface px-2 py-1 text-xs text-ink disabled:opacity-60"
        title={error ?? "Change status"}
      >
        <option value="">—</option>
        {options.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      {needsDate && choice !== status && (
        <span className="flex flex-wrap items-center gap-1.5">
          <JoiningDate status={choice} stages={joining} />
          <Button type="submit" size="sm" disabled={pending}>
            Save
          </Button>
        </span>
      )}
      {pending && <span className="text-[10px] text-ink-3">Saving…</span>}
      {error && <span className="max-w-48 text-[10px] leading-tight text-danger">{error}</span>}
    </form>
  );
}

/** Quick add is hidden until needed, so the list is the first thing you see. */
export function QuickAddPanel(props: React.ComponentProps<typeof QuickAddForm>) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button onClick={() => setOpen(true)}>+ Add candidate</Button>;
  return (
    <div className="w-full rounded-lg border border-line bg-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Quick add</p>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-ink-2 hover:underline">
          Close
        </button>
      </div>
      <QuickAddForm {...props} />
    </div>
  );
}

/** The HR block at the foot of the evaluation form: what was offered and when
    they join. Kept in the app, not written to the Excel. */
/** A date input needs yyyy-mm-dd; older rows may hold dd/mm/yyyy text. */
function isoDay(v: string | null): string {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}

export function HrDecisionForm({
  id,
  offeredSalary,
  dateOfJoining,
  comments,
}: {
  id: string;
  offeredSalary: string | null;
  dateOfJoining: string | null;
  comments: string | null;
}) {
  const [msg, action, pending] = useActionState(saveHrDecision, null);
  return (
    <form action={action} onKeyDown={blockEnter} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Offered salary">
          <Input name="offered_salary" defaultValue={offeredSalary ?? ""} />
        </Field>
        <Field label="Date of joining" hint="Compared with the opening's required-by date.">
          <Input name="date_of_joining" type="date" defaultValue={isoDay(dateOfJoining)} />
        </Field>
      </div>
      <Field label="Comments">
        <Textarea name="hr_comments" rows={2} defaultValue={comments ?? ""} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {msg && <span className={msg === "Saved." ? "text-xs text-good" : "text-xs text-danger"}>{msg}</span>}
      </div>
    </form>
  );
}

export function AddStageForm() {
  const [msg, action, pending] = useActionState(async (prev: string | null, fd: FormData) => {
    const r = await addStage(prev, fd);
    if (r === "Added.") (document.getElementById("add-stage") as HTMLFormElement | null)?.reset();
    return r;
  }, null);
  return (
    <form id="add-stage" action={action} className="flex flex-wrap items-center gap-2">
      <Input name="name" placeholder="New status, e.g. Telephonic Rejection" required className="w-72" />
      <Select name="kind" defaultValue="active">
        <option value="active">In process</option>
        <option value="hold">On hold</option>
        <option value="success">Success (selected / joined)</option>
        <option value="closed">Closed (rejected / dropped)</option>
      </Select>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add status"}
      </Button>
      {msg && <span className={msg === "Added." ? "text-xs text-good" : "text-xs text-danger"}>{msg}</span>}
    </form>
  );
}
