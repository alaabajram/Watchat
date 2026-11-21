// Shared replies: what the bot answers outside a series' chat (menu, links, my account, STOP, …), built on the
// flow builder canvas like series and sequence flows. Series chats are edited in Series flows.

import { Flash } from "@/components/admin/Flash";
import { FlowTabs } from "@/components/admin/FlowTabs";
import { requireAdmin } from "@/lib/admin/auth";
import { FixedTexts } from "@/components/flow/FixedTexts";
import { FlowBuilder } from "@/components/flow/FlowBuilder";
import { loadSharedBuilder } from "@/lib/flows/shared-store";
import { siteUrl } from "@/lib/site/store";
import { getBusinessProfile, type BusinessProfile } from "@/lib/whatsapp/profile";
import { setAccountLinkOnProfileAction } from "../../bot-actions";

export const dynamic = "force-dynamic";

export default async function SharedRepliesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; channel?: string }> }) {
  const admin = await requireAdmin("bot");
  const sp = await searchParams;
  // ?channel=telegram opens Telegram's own shared replies (when they're separate from WhatsApp's).
  const builder = await loadSharedBuilder(admin.tenantId, sp.channel === "telegram" ? "telegram" : null);
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
      <FlowBuilder {...builder} canPublish />
      <FixedTexts keys={builder.shared.fixedTexts} saved={builder.shared.saved} />

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
          The first link each viewer gets also carries a one-time tip: “📌 Pin this message” plus the account address (edit it under “Texts the bot sends by itself”).
        </p>
      </details>
    </>
  );
}
