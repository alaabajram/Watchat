// Shared replies: bot texts used outside series flows (menu, language change, alerts, links, support,
// data deletion), on a canvas that links what a viewer sends to the reply. Series chats are edited in Series flows.

import { Flash } from "@/components/admin/Flash";
import { FlowTabs } from "@/components/admin/FlowTabs";
import { requireAdmin } from "@/lib/admin/auth";
import { SharedRepliesCanvas } from "@/components/flow/SharedRepliesCanvas";
import { db } from "@/lib/supabase";
import { siteUrl } from "@/lib/site/store";
import { getBusinessProfile, type BusinessProfile } from "@/lib/whatsapp/profile";
import { setAccountLinkOnProfileAction } from "../../bot-actions";

export const dynamic = "force-dynamic";

export default async function SharedRepliesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("bot");
  const sp = await searchParams;
  const { data: rows } = await db().from("bot_messages").select("key, lang, body").eq("tenant_id", admin.tenantId).is("series_id", null);
  const current = Object.fromEntries((rows ?? []).map((r) => [`${r.key}.${r.lang}`, r.body as string]));
  const accountUrl = `${await siteUrl()}/me`;
  // The profile box is a nice-to-have: whatever Meta does, the replies below must still load.
  let profile: BusinessProfile | string;
  try {
    profile = await getBusinessProfile();
  } catch (e) {
    profile = e instanceof Error && e.name !== "TimeoutError" ? e.message : "WhatsApp didn't answer in time. Reload to try again.";
  }
  const onProfile = typeof profile !== "string" && profile.websites.some((w) => w.replace(/\/+$/, "") === accountUrl);

  return (
    <>
      <FlowTabs current="replies" />
      <Flash ok={sp.ok} err={sp.err} />
      <p className="muted" style={{ margin: "-6px 0 12px" }}>
        What the bot answers outside a series&apos; own chat, the same for every series. Each green bubble is what a viewer sends; the card next to it is
        the reply. Click a card to edit it.
      </p>
      <SharedRepliesCanvas current={current} />

      <details className="card" style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 16 }}>
          “My account” link on the WhatsApp profile{onProfile ? " ✓" : ""}
        </summary>
        <p style={{ marginTop: 0 }}>
          Viewers who tap <strong>Watchat</strong> at the top of the chat see the business profile. Putting <code>{accountUrl}</code> there gives every
          viewer a permanent way back to their series and coins, with no message from us (each bot reply is now charged by Meta). The page opens the
          viewer&apos;s own account on their phone; on a new phone it asks them to sign in through WhatsApp once.
        </p>
        {typeof profile === "string" ? (
          <p className="muted">Couldn&apos;t read the profile: {profile}</p>
        ) : (
          <p className="muted">
            Websites on the profile now: {profile.websites.length ? profile.websites.join(" · ") : "none"}
            {onProfile ? " ✓ the account link is there." : ""}
          </p>
        )}
        <form action={setAccountLinkOnProfileAction}>
          <button type="submit">{onProfile ? "Set it again" : "Add the account link to the profile"}</button>
        </form>
        <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>
          The first link each viewer gets also carries a one-time tip: “📌 Pin this message” plus the account address (the Pin tip card above).
        </p>
      </details>
    </>
  );
}
