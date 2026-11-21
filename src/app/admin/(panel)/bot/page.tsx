// Shared replies: bot texts used outside series flows (menu, language change, alerts, links, support,
// device confirmation, data deletion). Series chats themselves are edited in the Flow builder.

import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { FlowTabs } from "@/components/admin/FlowTabs";
import { requireAdmin } from "@/lib/admin/auth";
import { COPY, SHARED_KEYS } from "@/lib/bot/copy";
import { db } from "@/lib/supabase";
import { siteUrl } from "@/lib/site/store";
import { getBusinessProfile, type BusinessProfile } from "@/lib/whatsapp/profile";
import { saveBotMessagesAction, setAccountLinkOnProfileAction } from "../../bot-actions";

export const dynamic = "force-dynamic";

export default async function SharedRepliesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("bot");
  const sp = await searchParams;
  const { data: rows } = await db().from("bot_messages").select("key, lang, body").eq("tenant_id", admin.tenantId).is("series_id", null);
  const current = new Map((rows ?? []).map((r) => [`${r.key}.${r.lang}`, r.body as string]));
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
      <div className="card">
        <p style={{ marginTop: 0 }}>
          What the bot says outside a series&apos; chat flow: the menu, changing language, alerts on/off, &quot;send me my link&quot;, support, device
          confirmation and data deletion. They&apos;re the same for every series.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          The chat for each series (welcome, trailer, episodes, cliffhanger link, alerts question) is edited on its cards in the{" "}
          <Link href="/admin/flows">Flow builder</Link>. Leave a field empty to use the default (shown in grey). Placeholders: <code>{"{title}"}</code> series
          title · <code>{"{n}"}</code> episode. Buttons are limited to 20 characters.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>“My account” link on the WhatsApp profile</h2>
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
          The first link each viewer gets also carries a one-time tip: “📌 Pin this message” plus the account address (edit it below: “Pin tip”).
        </p>
      </div>

      <form action={saveBotMessagesAction}>
        <table className="card">
          <thead>
            <tr>
              <th style={{ width: 220 }}>Reply</th>
              <th>Arabic</th>
              <th>English</th>
            </tr>
          </thead>
          <tbody>
            {SHARED_KEYS.map((key) => {
              const entry = COPY[key];
              const isButton = entry.kind === "button";
              return (
                <tr key={key}>
                  <td>
                    <strong>{entry.label}</strong>
                    <div className="muted">{isButton ? "Button · max 20" : "Message"}</div>
                  </td>
                  {(["ar", "en"] as const).map((lang) =>
                    isButton ? (
                      <td key={lang}>
                        <input name={`${key}.${lang}`} dir={lang === "ar" ? "rtl" : "ltr"} maxLength={20} defaultValue={current.get(`${key}.${lang}`) ?? ""} placeholder={entry[lang]} style={{ width: "100%" }} />
                      </td>
                    ) : (
                      <td key={lang}>
                        <textarea name={`${key}.${lang}`} dir={lang === "ar" ? "rtl" : "ltr"} maxLength={1000} defaultValue={current.get(`${key}.${lang}`) ?? ""} placeholder={entry[lang]} />
                      </td>
                    ),
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p>
          <button type="submit">Save replies</button>
        </p>
      </form>
    </>
  );
}
