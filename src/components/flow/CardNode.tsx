"use client";

// One card on the canvas, drawn like the WhatsApp message it sends. Each button / choice has its own
// connection dot on the right; drag from it to the next card.

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { createContext, useContext } from "react";
import { formatMinutes } from "@/lib/flows/preview";
import { CARD_LABELS, CHANNEL_COLOR, portsOf, type FlowChannel, type NodeData, SEQUENCE_TRIGGERS, SHARED_ACTIONS } from "@/lib/flows/types";
import { CLICKABLE_KINDS, ctr, health, HEALTH_COLOR, HEALTH_LABEL, type CardStat } from "@/lib/ctr/ctr";
import { CARD_STYLE } from "./cards";

export type CardNodeData = {
  card: NodeData;
  name?: string;
  thumb: string | null;
  errors: number;
  warnings: number;
  templateBody?: string | null;
  /** Last 30 days of the live flow: viewers who got this card and who tapped / opened. */
  stat?: CardStat | null;
};
export type CardFlowNode = Node<CardNodeData, "card">;

const CONDITION_TEXT = {
  opted_in: "Viewer turned on alerts?",
  language_en: "Viewer watches with English subtitles?",
  paid: "Viewer has paid before?",
  reached_episode: "Viewer reached episode",
  started: "Viewer already started this series?",
  watched_within: "Watched on the web in the last",
  came_back: "Came back since the sequence started?",
  paid_since: "Paid since the sequence started?",
  has_series: "Following a series?",
  on_telegram: "Viewer is on Telegram?",
} as const;

function summary(d: NodeData, templateBody?: string | null): { text: string; dir: "rtl" | "ltr" } {
  switch (d.kind) {
    case "start":
      return { text: "Viewer sends the series code", dir: "ltr" };
    case "web":
      return { text: "Viewer starts watching this series on the web", dir: "ltr" };
    case "message":
      return { text: d.body.ar || d.body.en || (d.media ? "" : "(empty message)"), dir: "rtl" };
    case "language":
      return { text: d.body.ar, dir: "rtl" };
    case "episode":
      return { text: `Episode ${d.episode}${d.skipIfWatched ? " (skipped if watched)" : ""} · ${d.caption.ar}`, dir: "rtl" };
    case "link":
      return { text: `${d.episode === "resume" ? "Where they left off" : `Episode ${d.episode}`} · ${d.body.ar}`, dir: "rtl" };
    case "optin":
      return { text: d.body.ar, dir: "rtl" };
    case "wait":
      return { text: `Wait ${formatMinutes(d.minutes)}`, dir: "ltr" };
    case "condition":
      return {
        text:
          d.condition.check === "reached_episode"
            ? `${CONDITION_TEXT.reached_episode} ${d.condition.episode}?`
            : d.condition.check === "watched_within"
              ? `${CONDITION_TEXT.watched_within} ${d.condition.hours} h?`
              : CONDITION_TEXT[d.condition.check],
        dir: "ltr",
      };
    case "template":
      return { text: d.name ? `${d.name}${templateBody ? ` · ${templateBody}` : ""}` : "(pick a template)", dir: d.name && templateBody ? "rtl" : "ltr" };
    case "suggest":
      return { text: "Other series list", dir: "ltr" };
    case "choice":
      return { text: `${d.body.ar}\n${d.options.map((o) => `▢ ${o.label.ar || (o.code === "AUTO" ? "Recommended" : o.code)}`).join("\n")}`, dir: "rtl" };
    case "trigger":
      return { text: `${SEQUENCE_TRIGGERS.find((t) => t.value === d.trigger)?.label ?? d.trigger} · after ${formatMinutes(d.delayHours * 60)}${d.seriesCode ? ` · ${d.seriesCode}` : " · any series"}`, dir: "ltr" };
    case "end":
      return { text: "The sequence ends here", dir: "ltr" };
    case "keyword":
      return { text: d.anythingElse ? [...d.words, "anything else"].join(" · ") : d.words.join(" · ") || "(add words)", dir: "rtl" };
    case "list":
      return { text: d.body.ar, dir: "rtl" };
    case "account":
      return { text: d.body.ar, dir: "rtl" };
    case "action":
      return { text: SHARED_ACTIONS.find((a) => a.value === d.action)?.label ?? d.action, dir: "ltr" };
  }
}

const MINT = "#31e5a0";
const INK = "#1f1b24";
/** Cards drawn as what the viewer does (green chat bubble), not as a bot message. */
const VIEWER_SIDE = new Set<NodeData["kind"]>(["start", "web", "trigger", "keyword"]);
/** Cards that are logic, not a message: drawn without the chat background. */
const LOGIC = new Set<NodeData["kind"]>(["wait", "condition", "action", "end", "template"]);
const handle = (color: string) => ({ width: 11, height: 11, background: color, border: "2px solid #fff", boxShadow: "0 0 0 1px #0001" });

/** The chat app the canvas runs for (set by the builder). */
export const CanvasChannel = createContext<FlowChannel>("both");

/** What a Template card does on each app: a paid, approved template on WhatsApp; a free normal message on Telegram. */
const TEMPLATE_NOTE: Record<FlowChannel, string> = {
  both: "WhatsApp: paid template · Telegram: free message",
  whatsapp: "WhatsApp: paid template (needs Meta approval)",
  telegram: "Telegram: sent as a free message",
};

function ChannelNote({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderTop: "1px solid #f1f5f9", fontSize: 11, color: "#475569" }}>
      <span aria-hidden="true">ⓘ</span>
      {text}
    </div>
  );
}

export function CardNode({ data, selected }: NodeProps<CardFlowNode>) {
  const channel = useContext(CanvasChannel);
  const d = data.card;
  const style = CARD_STYLE[d.kind];
  const s = summary(d, data.templateBody);
  const ports = portsOf(d);
  const isVideo = (d.kind === "message" || d.kind === "language") && d.media?.type === "video";
  const title = data.name || CARD_LABELS[d.kind].split(":")[0];
  const ring = selected ? MINT : data.errors ? "#e0453a" : "transparent";
  const badge = data.errors > 0 ? { n: data.errors, bg: "#fde4e1", fg: "#b42318", t: "Errors" } : data.warnings > 0 ? { n: data.warnings, bg: "#fff3d6", fg: "#9a6700", t: "Warnings" } : null;

  if (VIEWER_SIDE.has(d.kind)) {
    const words = d.kind === "keyword" ? d.words : [];
    return (
      <div style={{ width: 250 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#6b6474", marginBottom: 6 }}>
          <span>{style.icon}</span>
          <span style={{ flex: 1 }} dir="auto">
            {d.kind === "keyword" ? (data.name ? `${data.name} · viewer sends` : "Viewer sends") : title}
          </span>
          {badge && <span title={badge.t} style={{ background: badge.bg, color: badge.fg, borderRadius: 8, padding: "0 7px" }}>{badge.n}</span>}
        </div>
        <div
          style={{
            background: "#d9fdd3",
            borderRadius: "16px 16px 4px 16px",
            padding: "10px 14px",
            boxShadow: selected ? `0 0 0 3px ${MINT}66, 0 6px 18px #1f1b2414` : "0 2px 8px #1f1b2412",
            outline: data.errors && !selected ? "2px solid #e0453a" : "none",
            color: INK,
            position: "relative",
          }}
        >
          {d.kind === "keyword" ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }} dir="rtl">
              {words.map((w) => (
                <span key={w} dir="auto" style={{ background: "#fff9", borderRadius: 999, padding: "2px 10px", fontSize: 13, fontWeight: 700 }}>
                  {w}
                </span>
              ))}
              {d.anythingElse && <span style={{ background: "#fff", borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 600, color: "#027eb5" }}>✱ anything else</span>}
              {!words.length && !d.anythingElse && <span style={{ fontSize: 12, color: "#6b6474" }}>Add the words in the editor</span>}
            </div>
          ) : (
            <div dir={s.dir} style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>
              {s.text}
            </div>
          )}
          {ports.map((p) => (
            <Handle key={p.id} type="source" id={p.id} position={Position.Right} style={handle(MINT)} />
          ))}
        </div>
      </div>
    );
  }

  const logic = LOGIC.has(d.kind);
  return (
    <div
      style={{
        width: 270,
        background: "#fff",
        borderRadius: 18,
        border: `2px solid ${ring}`,
        boxShadow: selected ? `0 0 0 4px ${MINT}40, 0 8px 24px #1f1b2414` : "0 4px 18px #1f1b2412",
        fontSize: 12,
        overflow: "visible",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ ...handle("#9aa3ad"), top: 24 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px 8px" }}>
        <span style={{ width: 26, height: 26, flex: "none", borderRadius: 9, background: `${style.color}1f`, color: style.color, display: "grid", placeItems: "center", fontSize: 13 }}>{style.icon}</span>
        <strong style={{ flex: 1, fontSize: 13.5, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} dir="auto">
          {title}
        </strong>
        {data.name && <span style={{ color: "#6b6474", fontSize: 10 }}>{CARD_LABELS[d.kind].split(/[ :(]/)[0]}</span>}
        {badge && <span title={badge.t} style={{ background: badge.bg, color: badge.fg, borderRadius: 8, padding: "0 7px", fontWeight: 700 }}>{badge.n}</span>}
      </div>
      <div style={{ padding: logic ? "0 12px 10px" : "8px 10px 10px", background: logic ? "transparent" : "#efeae2", margin: logic ? 0 : "0 8px", borderRadius: logic ? 0 : 12 }}>
        <div style={logic ? { background: "#f7f5f2", borderRadius: 10, padding: "8px 10px" } : { background: "#fff", borderRadius: "4px 12px 12px 12px", padding: 8, boxShadow: "0 1px 1px #0002" }}>
          {data.thumb &&
            (isVideo ? (
              <div style={{ height: 70, background: "#111", color: "#fff", borderRadius: 8, display: "grid", placeItems: "center", marginBottom: 6 }}>▶ video</div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.thumb} alt="" style={{ width: "100%", height: 84, objectFit: "cover", borderRadius: 8, marginBottom: 6 }} />
            ))}
          {d.kind === "episode" && !data.thumb && (
            <div style={{ height: 50, background: "#111", color: "#fff", borderRadius: 8, display: "grid", placeItems: "center", marginBottom: 6 }}>🎬 Episode {d.episode}</div>
          )}
          <div dir={s.dir} style={{ whiteSpace: "pre-wrap", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", color: INK, fontSize: 12.5, lineHeight: 1.45 }}>
            {s.text}
          </div>
          {(d.kind === "link" || d.kind === "account") && (
            <div dir="auto" style={{ borderTop: "1px solid #eef0f2", marginTop: 6, paddingTop: 6, textAlign: "center", color: "#027eb5", fontSize: 12.5 }}>
              ↗ {d.button.ar || d.button.en}
            </div>
          )}
          {d.kind === "list" && (
            <div dir="auto" style={{ borderTop: "1px solid #eef0f2", marginTop: 6, paddingTop: 6, textAlign: "center", color: "#027eb5", fontSize: 12.5 }}>
              ☰ {d.button.ar || d.button.en}
            </div>
          )}
        </div>
      </div>
      {d.kind === "template" && <ChannelNote text={TEMPLATE_NOTE[channel]} />}
      {data.stat && CLICKABLE_KINDS.has(d.kind) && <CtrStrip stat={data.stat} />}
      <div style={{ padding: ports.length ? "6px 0 4px" : 0 }}>
        {ports.map((p) => (
          <div
            key={p.id}
            style={{ position: "relative", margin: "0 10px 4px", padding: "6px 14px", borderRadius: 10, background: logic ? "#f7f5f2" : "#f2fbf7", color: logic ? "#475569" : "#027eb5", textAlign: "center", fontWeight: 600 }}
            dir="auto"
          >
            {d.kind === "list" ? "◯ " : ""}
            {p.label}
            <Handle type="source" id={p.id} position={Position.Right} style={{ ...handle(logic ? "#9aa3ad" : MINT), right: -16 }} />
          </div>
        ))}
      </div>
      {ports.length === 0 && <div style={{ padding: "8px 12px", color: "#6b6474", textAlign: "center", borderTop: "1px solid #f1eee9", fontSize: 11 }}>{d.kind === "end" ? "Ends the sequence" : "Ends here"}</div>}
    </div>
  );
}

function CtrStrip({ stat }: { stat: CardStat }) {
  const h = health(stat.clicked, stat.reached, "card");
  const rate = ctr(stat.clicked, stat.reached);
  return (
    <div
      title={`Last 30 days: ${stat.clicked} of ${stat.reached} viewers tapped or opened · ${HEALTH_LABEL[h]}`}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderTop: "1px solid #f1f5f9", fontSize: 11, color: "#475569" }}
    >
      <span style={{ fontWeight: 700, color: HEALTH_COLOR[h] }}>CTR {rate == null ? "—" : `${Math.round(rate * 100)}%`}</span>
      <div style={{ flex: 1, height: 4, background: "#e5e7eb", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${Math.round((rate ?? 0) * 100)}%`, height: 4, background: HEALTH_COLOR[h] }} />
      </div>
      <span>{stat.reached} viewers</span>
      {stat.byChannel && stat.byChannel.whatsapp && stat.byChannel.telegram && (
        <span title="CTR on WhatsApp · on Telegram" style={{ display: "inline-flex", gap: 6 }}>
          <span style={{ color: CHANNEL_COLOR.whatsapp, fontWeight: 700 }}>WA {pctOf(stat.byChannel.whatsapp)}</span>
          <span style={{ color: CHANNEL_COLOR.telegram, fontWeight: 700 }}>TG {pctOf(stat.byChannel.telegram)}</span>
        </span>
      )}
    </div>
  );
}

const pctOf = (s: { clicked: number; reached: number }) => {
  const r = ctr(s.clicked, s.reached);
  return r == null ? "—" : `${Math.round(r * 100)}%`;
};
