"use client";

// Time left until the next round (Gulf midnight), ticking every second.

import { useEffect, useState } from "react";
import { hms, secondsToNextRound } from "@/lib/rooms/display";

export function Countdown({ initial }: { initial: number }) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    const t = setInterval(() => setLeft(secondsToNextRound()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span dir="ltr" suppressHydrationWarning>
      {hms(left)}
    </span>
  );
}
