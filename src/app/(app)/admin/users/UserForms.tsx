"use client";

import { useActionState, useState } from "react";
import { createUser, assignSite, changePassword, changeEmail, deleteUser } from "./actions";

type Project = { id: string; code: string; name: string };

const field =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full";

export function CreateUserForm({
  projects,
  isSuperadmin,
}: {
  projects: Project[];
  isSuperadmin: boolean;
}) {
  const [error, action, pending] = useActionState(
    async (prev: string | null, fd: FormData) => {
      const result = await createUser(prev, fd);
      if (!result) {
        (document.getElementById("create-user-form") as HTMLFormElement)?.reset();
      }
      return result;
    },
    null,
  );

  return (
    <form id="create-user-form" action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Full name *
          <input name="full_name" required className={field} placeholder="Ramesh Patel" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Email *
          <input name="email" type="email" required className={field} placeholder="ramesh@shreeganeshcorp.com" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Password *
          <input name="password" type="password" required minLength={8} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600">
          Role *
          <select name="role" defaultValue="supervisor" className={field}>
            <option value="supervisor">Store Manager</option>
            {isSuperadmin && <option value="admin">Admin</option>}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-gray-600 sm:col-span-2">
          Assign site
          <select name="home_project_id" className={field}>
            <option value="">— None (assign later) —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}

export function AssignSiteForm({
  userId,
  currentProjectId,
  projects,
}: {
  userId: string;
  currentProjectId: string | null;
  projects: Project[];
}) {
  const [error, action, pending] = useActionState(assignSite, null);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <select
        name="home_project_id"
        defaultValue={currentProjectId ?? ""}
        className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none"
      >
        <option value="">— None —</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} — {p.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}

export function ChangeEmailForm({ userId, currentEmail }: { userId: string; currentEmail: string }) {
  const [open, setOpen] = useState(false);
  const [error, action, pending] = useActionState(
    async (prev: string | null, fd: FormData) => {
      const result = await changeEmail(prev, fd);
      if (!result) setOpen(false);
      return result;
    },
    null,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-blue-600 hover:underline"
      >
        Change email
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <input
        name="email"
        type="email"
        required
        defaultValue={currentEmail}
        placeholder="New email"
        className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-gray-400 hover:text-gray-600"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}

export function ChangePasswordForm({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [error, action, pending] = useActionState(
    async (prev: string | null, fd: FormData) => {
      const result = await changePassword(prev, fd);
      if (!result) setOpen(false);
      return result;
    },
    null,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-blue-600 hover:underline"
      >
        Change password
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <input
        name="password"
        type="password"
        required
        minLength={8}
        placeholder="New password"
        className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:outline-none"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-gray-400 hover:text-gray-600"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}

export function RemoveUserForm({ userId }: { userId: string }) {
  const [error, action, pending] = useActionState(deleteUser, null);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Remove this user? This cannot be undone.")) {
          e.preventDefault();
        }
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="user_id" value={userId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60"
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
