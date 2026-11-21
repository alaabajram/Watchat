// The Ping (بينج) coin: gold with mint double ticks. Decorative; the amount next to it carries the meaning.

export function PingIcon({ size = 20, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={size > 64 ? "/brand/ping-256.png" : "/brand/ping-128.png"}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ width: size, height: size, flexShrink: 0, display: "inline-block", ...style }}
    />
  );
}
