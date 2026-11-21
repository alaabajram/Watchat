import { notFound, redirect } from "next/navigation";
import { FlowBuilder } from "@/components/flow/FlowBuilder";
import { can, requireAdmin } from "@/lib/admin/auth";
import { loadBuilder } from "@/lib/flows/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Build with AI can take up to two AI calls

export default async function FlowBuilderPage({ params, searchParams }: { params: Promise<{ seriesId: string }>; searchParams: Promise<{ channel?: string }> }) {
  const admin = await requireAdmin("bot");
  const { seriesId } = await params;
  const { channel } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(seriesId)) notFound();
  // ?channel=telegram opens the series' Telegram flow (when it has its own); otherwise WhatsApp's / the one for both.
  const want = channel === "telegram" ? "telegram" : null;
  const data = await loadBuilder(admin.tenantId, seriesId, admin.id, want);
  if (!data) redirect(`/admin/flows/${seriesId}`);
  return <FlowBuilder {...data} canPublish={can(admin, "bot")} />;
}
