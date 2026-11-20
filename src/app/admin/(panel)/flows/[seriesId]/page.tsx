import { notFound } from "next/navigation";
import { FlowBuilder } from "@/components/flow/FlowBuilder";
import { can, requireAdmin } from "@/lib/admin/auth";
import { loadBuilder } from "@/lib/flows/store";

export const dynamic = "force-dynamic";

export default async function FlowBuilderPage({ params }: { params: Promise<{ seriesId: string }> }) {
  const admin = await requireAdmin("bot");
  const { seriesId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(seriesId)) notFound();
  const data = await loadBuilder(admin.tenantId, seriesId, admin.id);
  if (!data) notFound();
  return <FlowBuilder {...data} canPublish={can(admin, "bot")} />;
}
