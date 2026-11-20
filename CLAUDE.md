# Watchat — notes for coding agents

- Arabic first: every viewer-facing string has Arabic and English, Arabic is the default, layouts are RTL.
- WhatsApp messages go through `src/lib/whatsapp/messages.ts` (it enforces Meta's limits: 3 buttons, 20-char titles, 10 list rows). Never call the Graph API with hand-built payloads.
- Bot behaviour lives in `src/lib/bot/flow.ts` behind the `BotDeps` interface; add a test in `flow.test.ts` for every new branch.
- Visual-builder flows: `src/lib/flows/` is pure (types, engine, validate, sanitize, preview) and runs both in the bot and in the browser preview. Never import server code there. Saved flows always pass through `sanitizeGraph`; publishing requires `validateFlow` with no errors. Add tests in `flows.test.ts`.
- Every series chat runs through a flow; a series without one gets the standard flow auto-published (`src/lib/flows/standard.ts`). Bot texts marked `flowDefault` in `copy.ts` are only starting text for flow cards; the rest are Shared replies.
- Database access is server-only via `db()` (service role). Never import `src/lib/supabase.ts` into client components.
- Never store raw phone numbers in events or logs; use `phone_hmac`.
- `wallet_ledger` is append-only: never update or delete rows.
- Schema changes: add a new file in `supabase/migrations/`, never edit an applied migration.
- Before committing: `npm test`, `npm run typecheck`, `npm run build`.
