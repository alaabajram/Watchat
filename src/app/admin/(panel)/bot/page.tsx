// Shared replies: bot texts used outside series flows (menu, language change, alerts, links, support,
// device confirmation, data deletion). Series chats themselves are edited in the Flow builder.

import Link from "next/link";
import { Flash } from "@/components/admin/Flash";
import { requireAdmin } from "@/lib/admin/auth";
import { COPY, SHARED_KEYS } from "@/lib/bot/copy";
import { db } from "@/lib/supabase";
import { saveBotMessagesAction } from "../../bot-actions";

export const dynamic = "force-dynamic";

export default async function SharedRepliesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await requireAdmin("bot");
  const sp = await searchParams;
  const { data: rows } = await db().from("bot_messages").select("key, lang, body").eq("tenant_id", admin.tenantId).is("series_id", null);
  const current = new Map((rows ?? []).map((r) => [`${r.key}.${r.lang}`, r.body as string]));

  return (
    <>
      <h1>Shared replies</h1>
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
