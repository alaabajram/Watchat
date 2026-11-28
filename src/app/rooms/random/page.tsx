// Quick match: straight into a live room the viewer hasn't played today (any live room if they played them all).

import { redirect } from "next/navigation";
import { SignedOut } from "@/components/play/PlayShell";
import { quickMatch } from "@/lib/play/store";
import { getSessionViewer } from "@/lib/session";
import { currentTenantId } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function QuickMatch({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const viewer = await getSessionViewer();
  if (!viewer) return <SignedOut path="/rooms/random" lang={(await searchParams).lang} />;
  const slug = await quickMatch(await currentTenantId(), viewer.id);
  redirect(slug ? `/rooms/${slug}` : "/rooms");
}
