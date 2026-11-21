import { notFound } from "next/navigation";
import { FlowBuilder } from "@/components/flow/FlowBuilder";
import { can, requireAdmin } from "@/lib/admin/auth";
import { loadSequenceBuilder } from "@/lib/flows/sequence-store";

export const dynamic = "force-dynamic";

export default async function SequenceBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin("messaging");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await loadSequenceBuilder(admin.tenantId, id);
  if (!data) notFound();
  return <FlowBuilder {...data} canPublish={can(admin, "messaging")} />;
}
