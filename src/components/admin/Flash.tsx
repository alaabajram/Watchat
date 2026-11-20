// One-line success / error message from ?ok= / ?err= after an admin action.

export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null;
  return (
    <p className={err ? "flash flash-err" : "flash flash-ok"} role="status">
      {err ?? ok}
    </p>
  );
}
