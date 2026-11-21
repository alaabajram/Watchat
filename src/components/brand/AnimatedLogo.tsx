// The animated Watchat emblem (bubble strip + pulsing dot) with the wordmark — the same logo on every sign-in screen.

/* eslint-disable @next/next/no-img-element */
export function AnimatedLogo() {
  return (
    <h1 style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30, fontSize: "inherit", margin: 0 }}>
      <span className="wc-logo" aria-hidden="true">
        <span className="wc-logo-clip">
          <span className="wc-logo-strip">
            {[0, 1, 2, 3].map((i) => (
              <img key={i} src="/brand/emblem-bubble-light.png" alt="" />
            ))}
          </span>
        </span>
        <span className="wc-logo-dot">
          <span className="wc-ring" />
          <img src="/brand/emblem-dot.png" alt="" />
        </span>
      </span>
      <img src="/brand/lockup-text-light.png" alt="Watchat · واتشات" width={200} height={100} style={{ width: 200, height: "auto", display: "block" }} />
    </h1>
  );
}
