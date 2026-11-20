// Records server errors in the app_errors table (path, message, stack; never request bodies or cookies),
// so a failing page can be diagnosed from the database. Best effort: it never throws.

import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { db } = await import("./lib/supabase");
    const e = err as Error & { digest?: string };
    await db()
      .from("app_errors")
      .insert({
        digest: e.digest ?? null,
        path: (request.path ?? "").split("?")[0].slice(0, 300),
        route: context.routePath?.slice(0, 300) ?? null,
        kind: `${context.routerKind}/${context.routeType}`,
        message: String(e.message ?? err).slice(0, 2000),
        stack: String(e.stack ?? "").slice(0, 6000),
      });
  } catch {
    // never let error reporting cause another error
  }
};
