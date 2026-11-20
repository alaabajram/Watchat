"use client";

// Shown inside the admin when a page fails to load, instead of a blank error screen.
// The reference lets us find the exact error in the server logs.

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card">
      <h1 style={{ marginTop: 0 }}>This page didn&apos;t load</h1>
      <p>Something went wrong while loading it. The rest of the admin still works.</p>
      <p className="muted">
        Reference: <code>{error.digest ?? "n/a"}</code>
        {error.message && !error.message.startsWith("An error occurred in the Server Components render") ? ` · ${error.message}` : ""}
      </p>
      <button type="button" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
