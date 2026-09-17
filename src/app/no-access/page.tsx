export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page p-6">
      <div className="max-w-sm space-y-3 rounded-lg border border-line bg-surface p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-ink">No modules assigned</h1>
        <p className="text-sm text-ink-2">
          Your account doesn&apos;t have access to any module yet. Ask the administrator to enable one for you.
        </p>
        <form action="/auth/signout" method="post">
          <button className="text-sm font-medium text-accent hover:underline" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
