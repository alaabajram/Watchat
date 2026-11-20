"use client";

// The template editor on the WhatsApp templates page (the same editor as the flow builder's Template card).

import { useRouter } from "next/navigation";
import { saveTemplateFromPage } from "@/app/admin/messaging-actions";
import type { TemplateForEdit, TemplateUse } from "@/lib/messaging/template-store";
import { TemplateEditor } from "./TemplateEditor";

export function TemplatesEditorCard({ editing, uses }: { editing: TemplateForEdit | null; uses: TemplateUse[] }) {
  const router = useRouter();
  return (
    <div className="card" id="editor">
      <h2 style={{ marginTop: 0 }}>{editing ? "Edit template" : "New template"}</h2>
      <TemplateEditor
        key={editing?.name ?? "new"}
        initial={editing?.draft}
        editing={editing ? { name: editing.name, status: editing.status, categoryLocked: editing.categoryLocked, blocked: editing.blocked, uses } : null}
        onCancel={editing ? () => router.push("/admin/templates") : undefined}
        onSave={async (draft) => {
          const r = await saveTemplateFromPage(draft, editing?.name ?? null);
          router.refresh();
          return r;
        }}
      />
    </div>
  );
}
