// The Watchat chat agent's icon: the mint bubble with chat lines, and its red dot as its own layer so it can
// pulse. `float` makes the whole icon bob gently (both motions stop for people who prefer reduced motion).

export function AgentIcon({ height = 40, float = false }: { height?: number; float?: boolean }) {
  const width = Math.round((height * 604) / 818); // the artwork's proportions
  return (
    <span className={`wc-agent${float ? " wc-agent-float" : ""}`} style={{ width, height }} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/agent-bubble.png" alt="" width={width} height={height} />
      <span className="wc-agent-dot" />
    </span>
  );
}
