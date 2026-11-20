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
