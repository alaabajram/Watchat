// Funnel events. Stored server-side with a hashed viewer id (never the phone number).

import { currentTenantId, db } from "./supabase";

export async function trackEvent(params: {
  viewerHmac: string | null;
  name: string;
  seriesId?: string | null;
  episodeNumber?: number | null;
  sourceId?: string | null;
  props?: Record<string, unknown>;
}): Promise<void> {
  try {
    const tenantId = await currentTenantId();
    const { error } = await db()
      .from("events")
      .insert({
        tenant_id: tenantId,
        viewer_hmac: params.viewerHmac,
        name: params.name,
        series_id: params.seriesId ?? null,
        episode_number: params.episodeNumber ?? null,
        source_id: params.sourceId ?? null,
        props: params.props ?? {},
      });
    if (error) console.error("[events] insert failed", error.message);
  } catch (err) {
    // Analytics must never break the viewer's flow.
    console.error("[events] track threw", err);
  }
}
