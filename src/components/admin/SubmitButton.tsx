"use client";

import { useFormStatus } from "react-dom";

/** Submit button that shows a waiting label while the server action runs (AI drafts take up to a minute). */
export function SubmitButton({ children, pending, className }: { children: React.ReactNode; pending: string; className?: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={busy} aria-busy={busy}>
      {busy ? pending : children}
    </button>
  );
}
