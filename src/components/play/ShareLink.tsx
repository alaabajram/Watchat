"use client";

// Share a Playground page: the phone's share sheet when there is one, else copy the link.

import { useState } from "react";
import { ShareIcon } from "@/components/brand/icons";
import { playCopy } from "@/lib/play/copy";

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
      if (event) navigator.sendBeacon?.("/api/play/share", JSON.stringify({ event }));
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
