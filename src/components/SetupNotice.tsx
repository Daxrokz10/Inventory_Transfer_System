// Shown until the Supabase project is connected via .env.local.
export function SetupNotice() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <div>
        <p className="text-sm font-medium text-blue-600">Setup required</p>
        <h1 className="mt-1 text-2xl font-semibold">
          Connect your Supabase project
        </h1>
      </div>
      <p className="text-gray-600">
        The app is scaffolded and ready, but it isn&apos;t connected to a
        database yet. Once you create a Supabase project, fill in the keys and
        the app will come to life.
      </p>
      <ol className="list-decimal space-y-3 pl-5 text-gray-700">
        <li>
          Create a free project at{" "}
          <a
            className="text-blue-600 underline"
            href="https://supabase.com/dashboard"
            target="_blank"
            rel="noreferrer"
          >
            supabase.com/dashboard
          </a>
          .
        </li>
        <li>
          In the SQL editor, run the two files in{" "}
          <code className="rounded bg-gray-100 px-1">supabase/migrations/</code>{" "}
          (schema, then RLS).
        </li>
        <li>
          Copy{" "}
          <code className="rounded bg-gray-100 px-1">.env.local.example</code> to{" "}
          <code className="rounded bg-gray-100 px-1">.env.local</code> and paste
          your Project URL and anon key (Settings → API).
        </li>
        <li>
          Restart{" "}
          <code className="rounded bg-gray-100 px-1">npm run dev</code>.
        </li>
      </ol>
    </main>
  );
}
