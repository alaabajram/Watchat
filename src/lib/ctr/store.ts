// Server side of the CTR meters: loads clicks per sequence, campaign and flow card.

import { db } from "../supabase";
import type { CardStat } from "./ctr";

export const CTR_DAYS = 30;
const since = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

export type MessageCtr = { sent: number; delivered: number; read: number; failed: number; clicked: number; watched: number };

/** Sequences and campaigns over the last `days`, keyed "sequence:<id>" / "campaign:<id>". */
export async function loadMessageCtr(tenantId: string, days = CTR_DAYS): Promise<Map<string, MessageCtr>> {
  const { data, error } = await db().rpc("ctr_messages", { p_tenant: tenantId, p_since: since(days) });
  if (error) throw new Error(`ctr_messages failed: ${error.message}`);
  const out = new Map<string, MessageCtr>();
  for (const r of (data ?? []) as Record<string, string | number>[]) {
    out.set(`${r.ref_type}:${r.ref_id}`, {
      sent: Number(r.sent),
      delivered: Number(r.delivered),
      read: Number(r.read),
      failed: Number(r.failed),
      clicked: Number(r.clicked),
      watched: Number(r.watched),
    });
  }
  return out;
}

/** Flow cards over the last `days`: seriesId → nodeId → viewers reached / clicked (tapped or opened). */
export async function loadFlowCtr(tenantId: string, days = CTR_DAYS): Promise<Record<string, Record<string, CardStat>>> {
  const { data, error } = await db().rpc("ctr_flow_cards", { p_tenant: tenantId, p_since: since(days) });
  if (error) throw new Error(`ctr_flow_cards failed: ${error.message}`);
  const out: Record<string, Record<string, CardStat>> = {};
  for (const r of (data ?? []) as Record<string, string | number>[]) {
    const reached = Number(r.reached);
    (out[String(r.series_id)] ??= {})[String(r.node_id)] = { reached, clicked: Math.min(reached, Number(r.tapped) + Number(r.opened)) };
  }
  return out;
}

/** Flow cards per chat app: seriesId → nodeId → { whatsapp, telegram }. */
export async function loadFlowCtrByChannel(tenantId: string, days = CTR_DAYS): Promise<Record<string, Record<string, NonNullable<CardStat["byChannel"]>>>> {
  const { data, error } = await db().rpc("ctr_flow_cards_by_channel", { p_tenant: tenantId, p_since: since(days) });
  if (error) throw new Error(`ctr_flow_cards_by_channel failed: ${error.message}`);
  const out: Record<string, Record<string, NonNullable<CardStat["byChannel"]>>> = {};
  for (const r of (data ?? []) as Record<string, string | number>[]) {
    const reached = Number(r.reached);
    const ch = String(r.channel) as "whatsapp" | "telegram";
    ((out[String(r.series_id)] ??= {})[String(r.node_id)] ??= {})[ch] = { reached, clicked: Math.min(reached, Number(r.tapped) + Number(r.opened)) };
  }
  return out;
}

/** Sequences and campaigns per chat app, keyed "sequence:<id>" → { whatsapp, telegram } (sent, clicked). */
export async function loadMessageCtrByChannel(tenantId: string, days = CTR_DAYS): Promise<Map<string, Partial<Record<"whatsapp" | "telegram", { sent: number; clicked: number }>>>> {
  const { data, error } = await db().rpc("ctr_messages_by_channel", { p_tenant: tenantId, p_since: since(days) });
  if (error) throw new Error(`ctr_messages_by_channel failed: ${error.message}`);
  const out = new Map<string, Partial<Record<"whatsapp" | "telegram", { sent: number; clicked: number }>>>();
  for (const r of (data ?? []) as Record<string, string | number>[]) {
    const key = `${r.ref_type}:${r.ref_id}`;
    const cur = out.get(key) ?? {};
    cur[String(r.channel) as "whatsapp" | "telegram"] = { sent: Number(r.sent), clicked: Number(r.clicked) };
    out.set(key, cur);
  }
  return out;
}
