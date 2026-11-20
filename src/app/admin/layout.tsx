// Admin wrapper: English, left-to-right, light theme, never indexed.

import type { Metadata } from "next";

export const metadata: Metadata = { title: "Watchat Admin", robots: { index: false, follow: false } };

export default function AdminRoot({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin" dir="ltr" lang="en">
      {children}
    </div>
  );
}
