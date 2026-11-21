"use client";

// Shared replies on a canvas: each thing a viewer sends (left, green bubble) is linked to the bot's
// WhatsApp reply (white card), and each button or menu row is linked to the reply it leads to.
// Click a card to edit its Arabic and English texts on the right; the card shows the result live.

import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  useTransition,
} from "react";
import { saveSharedRepliesCanvas } from "@/app/admin/bot-actions";
import { COPY, renderCopy, type CopyKey, type CopyLang } from "@/lib/bot/copy";
import {
  CANVAS_KEYS,
  mapEdges,
  maxLength,
  SHARED_MAP,
  type MomentCard,
  type Piece,
} from "@/lib/bot/shared-map";

type Values = Record<string, string>;
type Ctx = {
  values: Values;
  lang: CopyLang;
  text: (key: CopyKey) => string;
  edited: (key: CopyKey) => boolean;
};
const TextCtx = createContext<Ctx | null>(null);
const useTexts = () => useContext(TextCtx)!;

const SAMPLE = {
  ar: { title: "أسرار", n: 3, total: 12, next: 4 },
  en: { title: "Secrets", n: 3, total: 12, next: 4 },
};
const MINT = "#31e5a0";
const INK = "#1f1b24";
const edgeStyle = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, color: "#9aa3ad" },
  style: { stroke: "#9aa3ad", strokeWidth: 2 },
};

type ViewerNode = Node<
  { card: Extract<MomentCard, { kind: "viewer" }> },
  "viewer"
>;
type ReplyNode = Node<
  { card: Extract<MomentCard, { kind: "reply" }>; selected: boolean },
  "reply"
>;

function ViewerCard({ data }: NodeProps<ViewerNode>) {
  const { lang } = useTexts();
  const c = data.card;
  return (
    <div style={{ width: 260, textAlign: "end" }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#6b6474",
          marginBottom: 4,
          textAlign: "start",
        }}
      >
        👤 Viewer sends
      </div>
      <div
        dir={lang === "ar" ? "rtl" : "ltr"}
        style={{
          display: "inline-block",
          background: "#d9fdd3",
          borderRadius: "14px 14px 4px 14px",
          padding: "10px 14px",
          fontSize: 15,
          fontWeight: 600,
          color: INK,
          boxShadow: "0 1px 2px #0001",
        }}
      >
        {c.says[lang]}
      </div>
      {c.hint && (
        <div
          style={{
            fontSize: 11,
            color: "#6b6474",
            marginTop: 6,
            textAlign: "start",
            lineHeight: 1.35,
          }}
        >
          {c.hint}
        </div>
      )}
      <Handle
        type="source"
        id="out"
        position={Position.Right}
        style={{
          width: 10,
          height: 10,
          background: MINT,
          border: "2px solid #fff",
        }}
      />
    </div>
  );
}

function ReplyCard({ data }: NodeProps<ReplyNode>) {
  const { lang, text, edited } = useTexts();
  const c = data.card;
  const dir = lang === "ar" ? "rtl" : "ltr";
  const body = c.pieces.filter((p) => p.role === "body" || p.role === "note");
  const buttons = c.pieces.filter(
    (p) => p.role === "button" || p.role === "list_button",
  );
  const section = c.pieces.find((p) => p.role === "section");
  const rows = c.pieces.filter((p) => p.role === "row");
  const nEdited = c.pieces.filter((p) => edited(p.key)).length;

  return (
    <div
      style={{
        width: 290,
        background: "#fff",
        borderRadius: 18,
        border: `2px solid ${data.selected ? MINT : "transparent"}`,
        boxShadow: data.selected
          ? `0 0 0 4px ${MINT}40, 0 8px 24px #1f1b2414`
          : "0 4px 18px #1f1b2412",
        cursor: "pointer",
        overflow: "hidden",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          top: 26,
          width: 10,
          height: 10,
          background: "#9aa3ad",
          border: "2px solid #fff",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px 6px",
        }}
      >
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: 8,
            background: `${MINT}33`,
            display: "grid",
            placeItems: "center",
            fontSize: 13,
          }}
        >
          💬
        </span>
        <strong style={{ flex: 1, fontSize: 14, color: INK }}>{c.title}</strong>
        {nEdited > 0 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              background: "#fff3d6",
              color: "#9a6700",
              borderRadius: 10,
              padding: "2px 8px",
            }}
          >
            Edited
          </span>
        )}
      </div>
      <div style={{ padding: "0 14px 8px", fontSize: 11, color: "#6b6474" }}>
        {c.when}
      </div>

      <div style={{ background: "#efeae2", padding: 10 }}>
        <div
          style={{
            background: "#fff",
            borderRadius: "4px 12px 12px 12px",
            boxShadow: "0 1px 1px #0002",
            overflow: "hidden",
          }}
        >
          {body.map((p) => (
            <div
              key={p.key}
              dir={dir}
              style={{
                padding: "8px 10px",
                whiteSpace: "pre-wrap",
                fontSize: p.role === "note" ? 12 : 13.5,
                color: p.role === "note" ? "#54656f" : INK,
                lineHeight: 1.45,
                ...(p.role === "note" ? { background: "#f7f5f2" } : {}),
              }}
            >
              {text(p.key)}
            </div>
          ))}
          {buttons.map((p) => (
            <div
              key={p.key}
              style={{
                position: "relative",
                borderTop: "1px solid #eef0f2",
                padding: 8,
                textAlign: "center",
                color: "#027eb5",
                fontSize: 13.5,
              }}
            >
              {p.role === "list_button"
                ? "☰ "
                : c.id === "r-link" || c.id === "r-account"
                  ? "↗ "
                  : ""}
              {text(p.key)}
              {p.to && (
                <Handle
                  type="source"
                  id={p.key}
                  position={Position.Right}
                  style={{
                    width: 10,
                    height: 10,
                    background: MINT,
                    border: "2px solid #fff",
                  }}
                />
              )}
            </div>
          ))}
        </div>
        {rows.length > 0 && (
          <div
            style={{
              marginTop: 8,
              background: "#fff",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "0 1px 1px #0002",
            }}
          >
            {section && (
              <div
                dir={dir}
                style={{
                  padding: "6px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#008069",
                  background: "#f7f5f2",
                }}
              >
                {text(section.key)}
              </div>
            )}
            {rows.map((p) => (
              <div
                key={p.key}
                dir={dir}
                style={{
                  position: "relative",
                  padding: "7px 10px",
                  borderTop: "1px solid #eef0f2",
                  fontSize: 13,
                  color: INK,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    border: "2px solid #c5cbd0",
                    flex: "none",
                  }}
                />
                {text(p.key)}
                {p.to && (
                  <Handle
                    type="source"
                    id={p.key}
                    position={Position.Right}
                    style={{
                      width: 10,
                      height: 10,
                      background: MINT,
                      border: "2px solid #fff",
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {c.id === "r-nfm" && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: "#54656f",
              textAlign: "center",
            }}
          >
            + the live series, filled in automatically
          </div>
        )}
        {c.id === "r-picks" && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: "#54656f",
              textAlign: "center",
            }}
          >
            + up to 3 series buttons, filled in automatically
          </div>
        )}
      </div>
      {c.then && (
        <div
          style={{
            padding: "8px 14px",
            fontSize: 11,
            color: "#6b6474",
            borderTop: "1px solid #f1eee9",
          }}
        >
          ↳ {c.then}
        </div>
      )}
      {c.adds && (
        <div
          style={{
            position: "relative",
            padding: "8px 14px",
            fontSize: 11,
            color: "#6b6474",
            borderTop: "1px solid #f1eee9",
          }}
        >
          + the Pin tip, the first time a viewer gets a link
          <Handle
            type="source"
            id="adds"
            position={Position.Right}
            style={{
              width: 10,
              height: 10,
              background: "#c5cbd0",
              border: "2px solid #fff",
            }}
          />
        </div>
      )}
    </div>
  );
}

const nodeTypes = { viewer: ViewerCard, reply: ReplyCard };

const ROLE_LABEL: Record<Piece["role"], string> = {
  body: "Message",
  note: "Added text",
  button: "Button",
  list_button: "List button",
  section: "List heading",
  row: "Menu row",
};

export function SharedRepliesCanvas(props: { current: Values }) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function initialValues(current: Values): Values {
  const v: Values = {};
  for (const key of CANVAS_KEYS)
    for (const lang of ["ar", "en"] as const)
      v[`${key}.${lang}`] = current[`${key}.${lang}`] ?? COPY[key][lang];
  return v;
}

function Canvas({ current }: { current: Values }) {
  const [saved, setSaved] = useState<Values>(() => initialValues(current));
  const [values, setValues] = useState<Values>(saved);
  const [lang, setLang] = useState<CopyLang>("ar");
  const [selected, setSelected] = useState<string | null>("r-menu");
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [pending, start] = useTransition();

  const dirty = useMemo(
    () => Object.keys(values).some((k) => values[k] !== saved[k]),
    [values, saved],
  );
  const ctx: Ctx = useMemo(
    () => ({
      values,
      lang,
      text: (key) =>
        renderCopy(values[`${key}.${lang}`] || COPY[key][lang], SAMPLE[lang]),
      edited: (key) =>
        (["ar", "en"] as const).some(
          (l) => (values[`${key}.${l}`] ?? "").trim() !== COPY[key][l],
        ),
    }),
    [values, lang],
  );

  const nodes = useMemo<Node[]>(
    () =>
      SHARED_MAP.map((c) =>
        c.kind === "viewer"
          ? {
              id: c.id,
              type: "viewer",
              position: { x: c.x, y: c.y + 20 },
              data: { card: c },
              selectable: false,
            }
          : {
              id: c.id,
              type: "reply",
              position: { x: c.x, y: c.y },
              data: { card: c, selected: c.id === selected },
            },
      ),
    [selected],
  );
  const edges = useMemo<Edge[]>(
    () =>
      mapEdges().map(({ adds, ...e }) =>
        adds
          ? {
              ...e,
              ...edgeStyle,
              style: {
                stroke: "#c5cbd0",
                strokeWidth: 2,
                strokeDasharray: "6 5",
              },
            }
          : { ...e, ...edgeStyle },
      ),
    [],
  );
  const card = SHARED_MAP.find(
    (c) => c.id === selected && c.kind === "reply",
  ) as Extract<MomentCard, { kind: "reply" }> | undefined;

  function save() {
    start(async () => {
      const r = await saveSharedRepliesCanvas(values);
      setStatus(r);
      if (r.ok) setSaved(values);
    });
  }

  return (
    <TextCtx.Provider value={ctx}>
      <div
        className="flow-builder"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 380px",
          gap: 14,
          height: "calc(100vh - 170px)",
          minHeight: 560,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div
              role="group"
              aria-label="Preview language"
              style={{
                display: "flex",
                background: "#fff",
                borderRadius: 12,
                padding: 3,
                boxShadow: "var(--a-shadow)",
              }}
            >
              {(["ar", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  aria-pressed={lang === l}
                  style={{
                    border: 0,
                    borderRadius: 9,
                    padding: "6px 14px",
                    fontWeight: 600,
                    background: lang === l ? INK : "transparent",
                    color: lang === l ? "#fff" : INK,
                  }}
                >
                  {l === "ar" ? "عربي" : "English"}
                </button>
              ))}
            </div>
            <span dir="ltr" style={{ fontSize: 12, color: "#6b6474" }}>
              Same for every series · <code>{"{title}"}</code> shows as “
              {SAMPLE[lang].title}”
            </span>
          </div>
          <div
            style={{
              position: "relative",
              flex: 1,
              background: "#f7f5f2",
              borderRadius: 22,
              overflow: "hidden",
              boxShadow: "var(--a-shadow)",
            }}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              nodesConnectable={false}
              nodesDraggable={false}
              edgesFocusable={false}
              onNodeClick={(_, n) => n.type === "reply" && setSelected(n.id)}
              fitView
              fitViewOptions={{
                padding: 0.08,
                maxZoom: 0.9,
                nodes: [
                  { id: "v-link" },
                  { id: "r-menu" },
                  { id: "r-link" },
                  { id: "r-optin" },
                  { id: "r-optin-yes" },
                  { id: "r-optin-no" },
                ],
              }}
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={22} color="#e4dfd8" />
              <Controls showInteractive={false} position="bottom-left" />
            </ReactFlow>
          </div>
        </div>

        <aside
          style={{
            background: "#fff",
            borderRadius: 22,
            boxShadow: "var(--a-shadow)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: "16px 18px 10px",
              borderBottom: "1px solid #f1eee9",
            }}
          >
            {card ? (
              <>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    color: "#6b6474",
                    textTransform: "uppercase",
                  }}
                >
                  Editing
                </div>
                <h2 style={{ margin: "2px 0 2px", fontSize: 19 }}>
                  {card.title}
                </h2>
                <div className="muted" style={{ fontSize: 12 }}>
                  {card.when}
                </div>
              </>
            ) : (
              <h2 style={{ margin: 0, fontSize: 18 }}>
                Click a reply card to edit it
              </h2>
            )}
          </div>
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "12px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {card?.pieces.map((p) => (
              <PieceEditor
                key={p.key}
                piece={p}
                values={values}
                setValues={setValues}
              />
            ))}
            {card && (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Placeholders: <code>{"{title}"}</code> series name ·{" "}
                <code>{"{n}"}</code> episode. The bot picks Arabic or English by
                the viewer&apos;s language.
              </p>
            )}
          </div>
          <div
            style={{
              padding: "12px 18px 16px",
              borderTop: "1px solid #f1eee9",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <button
              type="button"
              onClick={save}
              disabled={!dirty || pending}
              style={{ flex: "none" }}
            >
              {pending ? "Saving…" : "Save replies"}
            </button>
            {dirty && (
              <button
                type="button"
                className="secondary"
                onClick={() => setValues(saved)}
                disabled={pending}
                style={{
                  background: "#fff",
                  color: INK,
                  boxShadow: "inset 0 0 0 1.5px #e4dfd8",
                }}
              >
                Undo changes
              </button>
            )}
            <span
              role="status"
              style={{
                fontSize: 12,
                color: status && !status.ok ? "#c0352b" : "#6b6474",
              }}
            >
              {dirty ? "Unsaved changes" : (status?.message ?? "All saved")}
            </span>
          </div>
        </aside>
      </div>
    </TextCtx.Provider>
  );
}

function PieceEditor({
  piece,
  values,
  setValues,
}: {
  piece: Piece;
  values: Values;
  setValues: (f: (v: Values) => Values) => void;
}) {
  const entry = COPY[piece.key];
  const max = maxLength(piece.key);
  const isShort = entry.kind === "button";
  const custom = (["ar", "en"] as const).some(
    (l) => (values[`${piece.key}.${l}`] ?? "").trim() !== entry[l],
  );
  const set = (lang: CopyLang, v: string) =>
    setValues((old) => ({ ...old, [`${piece.key}.${lang}`]: v }));

  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <strong style={{ fontSize: 13 }}>{ROLE_LABEL[piece.role]}</strong>
        <span className="muted" style={{ fontSize: 11, flex: 1 }}>
          {isShort ? `max ${max} characters` : ""}
        </span>
        {custom && (
          <button
            type="button"
            onClick={() =>
              setValues((old) => ({
                ...old,
                [`${piece.key}.ar`]: entry.ar,
                [`${piece.key}.en`]: entry.en,
              }))
            }
            style={{
              background: "none",
              color: "#027eb5",
              padding: 0,
              fontSize: 12,
              boxShadow: "none",
            }}
          >
            Reset to default
          </button>
        )}
      </div>
      {(["ar", "en"] as const).map((lang) => {
        const v = values[`${piece.key}.${lang}`] ?? "";
        const len = Array.from(v).length;
        const common = {
          dir: lang === "ar" ? "rtl" : "ltr",
          value: v,
          placeholder: entry[lang],
          "aria-label": `${ROLE_LABEL[piece.role]} · ${lang === "ar" ? "Arabic" : "English"}`,
          onChange: (e: { target: { value: string } }) =>
            set(lang, e.target.value),
          style: {
            width: "100%",
            boxSizing: "border-box" as const,
            borderColor: len > max ? "#c0352b" : undefined,
            fontSize: 14,
          },
        };
        return (
          <label key={lang} style={{ display: "block", marginBottom: 8 }}>
            <span
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "#6b6474",
                marginBottom: 3,
              }}
            >
              <span>{lang === "ar" ? "عربي" : "English"}</span>
              <span style={{ color: len > max ? "#c0352b" : undefined }}>
                {isShort || len > max * 0.8 ? `${len}/${max}` : ""}
              </span>
            </span>
            {isShort ? (
              <input {...common} />
            ) : (
              <textarea
                {...common}
                rows={Math.min(
                  6,
                  Math.max(2, Math.ceil(len / 38) + v.split("\n").length - 1),
                )}
              />
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
