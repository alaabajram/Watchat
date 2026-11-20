# Watchat · واتشات

**Real drama, in the chat · دراما حقيقية في الشات**

Arabic-first micro-dramas. Viewers discover a series and watch episodes 1–3 inside WhatsApp, then tap a personal link that opens episode 4 on a web player — no app download, no sign-up. The WhatsApp number is the account.

This repo is the **prototype starter**: the WhatsApp bot (welcome → language → trailer → episodes 1–3 → cliffhanger link → alerts opt-in), signed personal links, the web player for free episodes with a locked paywall placeholder, and the full database schema for the MVP.

## Stack

| Part | Choice |
| --- | --- |
| App (player, API, webhook) | Next.js 16 on **Vercel**, functions in Mumbai (`bom1`), next to the Supabase database (ap-south-1). Switch to Dubai (`dxb1`) when it is available to your account |
| Database | **Supabase** Postgres (all tables server-only via RLS) |
| WhatsApp | **Meta WhatsApp Cloud API**, direct (no BSP) |
| Web video | **Cloudflare Stream** (adaptive HLS, iframe player) |
| Chat video | Small MP4 files (H.264 + AAC, under 16 MB) at public URLs, e.g. a Supabase Storage public bucket |
| Payments | Tap Payments hosted checkout (Apple Pay, Google Pay, cards, mada), AED / SAR |

## How it works

```
Viewer taps ad / creator link ──► WhatsApp chat ──► Meta Cloud API ──► POST /api/whatsapp/webhook (Vercel)
                                                                           │ verify signature, answer 200
                                                                           ▼ after response
                                                         src/lib/bot/flow.ts (state machine)
                                                           │ reads/writes Supabase (viewers, chat_state, events…)
                                                           └─ sends replies via Meta Cloud API
Episode 3 → personal link  https://APP_URL/w/<token>
     └─► /w/[token]: token (hashed, 7 days, 3 uses) → session cookie → /watch/SECRETS01/4
```

| Path | What it is |
| --- | --- |
| `src/app/api/whatsapp/webhook/route.ts` | Webhook: Meta verification (GET), inbound messages + delivery statuses (POST) |
| `src/lib/bot/flow.ts` | The bot: one function per message (W1–W14 in the screens doc) |
| `src/lib/bot/copy.ts` | Bot texts in Arabic and English (drafts for a Gulf copywriter) |
| `src/lib/bot/intents.ts` | Turns a text or button tap into an intent (series code, next, STOP, menu…) |
| `src/lib/bot/deps-supabase.ts` | Database + Meta implementation used by the bot |
| `src/lib/whatsapp/*` | Message builders (enforce Meta's limits), webhook parser, signature check, API client |
| `src/lib/links.ts`, `src/lib/session.ts` | Signed links and device sessions (max 3 devices) |
| `src/app/w/[token]` | Opens a personal link |
| `src/app/watch/[code]/[episode]` | Player page (P4) with paywall placeholder (P8) |
| `src/app/series/[code]` | Series page with the episode grid (P6) |
| `supabase/migrations/` | Full MVP schema |
| `supabase/seed.sql` | Demo tenant, series `SECRETS01` (30 episodes) and coin packs |

## Setup

### 1. Supabase
1. Create a project (closest region to the Gulf: Mumbai).
2. Run `supabase/migrations/20261119000000_init.sql`, then `supabase/seed.sql` (SQL editor, or `supabase db push` with the CLI).
3. Create a **public** Storage bucket (e.g. `wa-clips`) and upload the trailer and episodes 1–3 as small MP4s. Put their public URLs in `series.trailer_video_url` and `episodes.wa_video_url_ar` / `wa_video_url_en`.

### 2. Meta WhatsApp (free test number)
1. [developers.facebook.com](https://developers.facebook.com) → create an app (type *Business*) → add **WhatsApp**.
2. In **WhatsApp → API Setup**: copy the test **Phone number ID** and a **temporary access token**; add your own number (and up to 4 others) as test recipients.
3. **App settings → Basic**: copy the **App secret**.
4. **WhatsApp → Configuration → Webhook**: callback URL `https://YOUR-APP.vercel.app/api/whatsapp/webhook`, verify token = your `WHATSAPP_VERIFY_TOKEN`. Subscribe to the **messages** field.
5. In parallel, start **business verification** and register the real Watchat number — that is what takes days.

> The test number can only message the numbers you add, and only someone who messages it first. To start the flow, send `SECRETS01` to the test number from WhatsApp.

### 3. Cloudflare Stream
Upload each episode, copy its video id into `episodes.stream_uid`, and set `CLOUDFLARE_STREAM_CUSTOMER_CODE`. Attach Arabic and English captions in Stream so one video serves both languages.

### 4. Vercel
1. Import this GitHub repo in Vercel.
2. Add every key from `.env.example` under **Settings → Environment Variables** (`APP_URL` = your Vercel URL).
3. Deploy. `vercel.json` pins functions to Mumbai (`bom1`), the same region as the database.

### Local development
```bash
cp .env.example .env.local   # fill in the keys
npm install
npm run dev
npm test                     # bot flow, intents, webhook parsing, Meta limits
```
To receive webhooks locally, expose port 3000 with a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`) and use that URL in Meta's webhook settings.

## Security notes
- Webhooks are rejected unless `X-Hub-Signature-256` matches the app secret.
- Link tokens and session cookies are stored only as SHA-256 hashes; links expire after 7 days or 3 opens.
- RLS is on for every table with no policies: only the server (service role key) reads the database.
- Events store a keyed hash of the phone number, never the number itself.
- **Before launch:** encrypt `viewers.phone_e164` at rest, switch to a System User token for Meta, and sign Cloudflare Stream playback URLs.

## Admin panel (`/admin`)

| Area | What the team can do | Roles |
| --- | --- | --- |
| Dashboard | Funnel by series, period and traffic source; episode-1 completion; paywall conversion; revenue; WhatsApp sends | all |
| Series & episodes | Create series, edit titles/synopsis/poster/trailer, **chat scenario** (language question, trailer, chat episodes, alerts question), free episodes, paywall, coin price, season pass; upload web videos to Cloudflare Stream and WhatsApp clips to storage; licences; family-safe review; publish gate | owner, content |
| Bot messages | Edit every WhatsApp text and button in Arabic and English, for all series or one series | owner, content, marketing |
| Templates | Draft, submit to Meta, sync approval status; starter templates (resume, new series, win-back) | owner, marketing |
| Sequences | Timed follow-ups: stopped mid-series, inactive, finished series — opted-in only | owner, marketing |
| Campaigns | Broadcasts to segments (series, language, country, paid, inactive/active days) with audience size and cost estimate, scheduled in Gulf time | owner, marketing |
| Viewers | Look up by number; progress, wallet, orders, consent history, devices, messages; grant coins, resend link, sign out devices, delete personal data | owner, support (finance: view) |
| Pricing | Coin packs in AED and SAR | owner, finance |
| Team / Audit log | Add people with roles, disable access; every change is logged | owner (audit: owner, finance) |

**First sign-in:** set `ADMIN_SETUP_TOKEN` in Vercel, open `/admin/setup`, create the owner account. Invite the rest of the team from **Team** (they get a one-time password and must change it).

## Viewer sign-in, memory and money
- The WhatsApp link signs the viewer in on that device (HttpOnly cookie, 90 days sliding, max 3 devices). No forms.
- Progress (position in each episode), unlocked episodes, season passes and coins are tied to the WhatsApp number and follow the viewer across devices.
- Spending needs a **trusted device**: a link opened within 30 minutes of being sent, or a browser confirmed by sending `CONFIRM 123456` from the viewer's own WhatsApp number. A forwarded link can watch free episodes but can't spend.
- All money moves inside Postgres functions (`unlock_episode`, `fulfil_order`, `grant_coins`): atomic, idempotent, append-only ledger. Prices always come from the database.
- Tap payments are confirmed by re-reading the charge from Tap's API and matching amount and currency to our order.

## Messaging rules (enforced in code)
Opted-in viewers only · approved templates only · no marketing 22:00–09:00 Gulf time · max one marketing message per viewer per 20 hours · each sequence moment sent once (claimed in the database before sending).

## Next steps (from the delivery plan)
- [x] Player (swipe, autoplay next, resume, progress), wallet, coin store, Tap checkout, device confirmation
- [x] Admin panel, editable bot, scenarios, sequences, campaigns
- [ ] Apply the design team's UI (screens doc P1–P16 and admin)
- [ ] First-visit sheet (18+ confirmation) and share sheet
- [ ] Nonce-based CSP; encrypt `viewers.phone_e164` at rest; signed Cloudflare Stream URLs
- [ ] Direct carrier billing (phase 2)

Planning docs: architecture plan, screens & buttons, and the journey whiteboard are in the Watchat project.
