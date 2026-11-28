"use client";

// Share a Playground page: the phone's share sheet when there is one, else copy the link.

import { useState } from "react";
import { ShareIcon } from "@/components/brand/icons";
import { playCopy } from "@/lib/play/copy";

/** One analytics event for a share tap (fire and forget). */
export function trackShare(event: string) {
  try {
    navigator.sendBeacon?.("/api/play/share", JSON.stringify({ event }));
  } catch {
    /* ignore */
  }
}

export function ShareLink({ path, text, locale, event }: { path: string; text: string; locale: "ar" | "en"; event?: string }) {
  const t = playCopy(locale);
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${window.location.origin}${path}`;
    try {
      if (navigator.share) {
        await navigator.share({ text, url });
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
      if (event) trackShare(event);
    } catch {
      /* cancelled */
    }
  };
  return (
    <button type="button" className="pl-btn pl-btn-soft" onClick={share}>
      <ShareIcon size={18} />
      {copied ? t.copied : t.share}
    </button>
  );
}
