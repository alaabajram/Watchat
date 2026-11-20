// Renders page text written in the simple format (headings, lists, bold, links) as safe React elements.
// No HTML from the text is ever rendered.

import { parsePage, type Inline } from "@/lib/site/brand";

function Line({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} rel={p.href.startsWith("https://") ? "noopener noreferrer" : undefined} target={p.href.startsWith("https://") ? "_blank" : undefined}>
            {p.text}
          </a>
        ) : p.bold ? (
          <strong key={i}>{p.text}</strong>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function PageBody({ text }: { text: string }) {
  return (
    <>
      {parsePage(text).map((b, i) => {
        if (b.type === "ul")
          return (
            <ul key={i}>
              {b.parts.map((li, j) => (
                <li key={j}>
                  <Line parts={li} />
                </li>
              ))}
            </ul>
          );
        const Tag = b.type === "h1" ? "h2" : b.type === "h2" ? "h3" : "p";
        return (
          <Tag key={i}>
            <Line parts={b.parts[0]} />
          </Tag>
        );
      })}
    </>
  );
}
