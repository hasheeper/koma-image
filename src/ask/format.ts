import { idPattern } from "./ids.ts";

export type Inline =
  | { readonly t: "text"; readonly v: string }
  | { readonly t: "id"; readonly v: string }
  | { readonly t: "code"; readonly v: string }
  | { readonly t: "strong"; readonly v: string };
export type Block =
  | { readonly t: "p"; readonly parts: readonly Inline[] }
  | { readonly t: "ul" | "ol"; readonly items: readonly (readonly Inline[])[] };

function ids(text: string, out: Inline[]) {
  let at = 0;
  for (const match of text.matchAll(idPattern)) {
    if (match.index > at) out.push({ t: "text", v: text.slice(at, match.index) });
    out.push({ t: "id", v: match[0] });
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push({ t: "text", v: text.slice(at) });
}
/** `code`, **strong** and display IDs; everything else stays plain text. */
export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const match of text.matchAll(/`([^`\n]+)`|\*\*([^*\n]+)\*\*/g)) {
    ids(text.slice(at, match.index), out);
    out.push(match[1] !== undefined ? { t: "code", v: match[1] } : { t: "strong", v: match[2] });
    at = match.index + match[0].length;
  }
  ids(text.slice(at), out);
  return out;
}
const bullet = /^\s*[-*•]\s+/,
  numbered = /^\s*\d+[.)、]\s+/;

/**
 * A reply as paragraphs and lists, rendered by the template as text nodes:
 * model output never becomes HTML.
 */
export function blocks(text: string): Block[] {
  const out: Block[] = [];
  // Declared wide: flush() resets both from a closure.
  let list = null as { t: "ul" | "ol"; items: Inline[][] } | null,
    paragraph = null as Inline[] | null;
  const flush = () => {
    if (list) out.push(list);
    if (paragraph) out.push({ t: "p", parts: paragraph });
    list = paragraph = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\s*#{1,6}\s+/, "");
    if (!line.trim()) {
      flush();
      continue;
    }
    const kind = bullet.test(line) ? "ul" : numbered.test(line) ? "ol" : null;
    if (kind) {
      if (paragraph || list?.t !== kind) flush();
      list ??= { t: kind, items: [] };
      list.items.push(inline(line.replace(kind === "ul" ? bullet : numbered, "")));
    } else if (paragraph) {
      // A single line break stays inside its paragraph.
      paragraph.push({ t: "text", v: "\n" }, ...inline(line));
    } else {
      flush();
      paragraph = inline(line);
    }
  }
  flush();
  return out;
}
