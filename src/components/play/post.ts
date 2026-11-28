// Small JSON POST for the Playground's own API routes.

export async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; cost?: number }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, error: (data as { error?: string }).error ?? "failed", cost: (data as { cost?: number }).cost };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, error: "offline" };
  }
}
