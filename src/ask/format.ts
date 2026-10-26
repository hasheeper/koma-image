import { Lexer, Tokenizer } from "marked";
import type { MarkedToken, Token } from "marked";
import { decodeHTMLStrict } from "entities";
import { idPattern } from "./ids.ts";

type Leaf = { readonly t: "text" | "id" | "code"; readonly v: string };
export type Inline =
  | Leaf
  | { readonly t: "strong" | "em" | "del"; readonly parts: readonly Inline[] }
  | { readonly t: "a"; readonly href: string; readonly title?: string; readonly parts: readonly Inline[] }
  | { readonly t: "br" }
  | { readonly t: "check"; readonly checked: boolean };
export type Block =
  | { readonly t: "p"; readonly parts: readonly Inline[] }
  | { readonly t: "heading"; readonly depth: number; readonly parts: readonly Inline[] }
  | { readonly t: "ul" | "ol"; readonly start: number; readonly loose: boolean; readonly items: readonly { readonly blocks: readonly Block[]; readonly task: boolean }[] }
  | { readonly t: "blockquote"; readonly blocks: readonly Block[] }
  | { readonly t: "pre"; readonly text: string; readonly language: string }
  | { readonly t: "hr" }
  | { readonly t: "table"; readonly header: readonly (readonly Inline[])[]; readonly rows: readonly (readonly (readonly Inline[])[])[]; readonly align: readonly ("left" | "center" | "right" | null)[] };

const quotePairs = new Map([["\"", "\""], ["“", "”"], ["「", "」"], ["『", "』"]]);
class AskTokenizer extends Tokenizer {
  override emStrong(src: string, maskedSrc: string, prevChar = ""): ReturnType<Tokenizer["emStrong"]> {
    const standard = super.emStrong(src, maskedSrc, prevChar);
    if (standard) return standard;
    // Chinese-adjacent quotes and horizontal padding often appear in model
    // replies. Relax only quoted **strong**, after the standard rule fails.
    const opening = /^\*\*[ \t]*(["“「『])/.exec(src);
    if (!opening) return;
    const closingQuote = quotePairs.get(opening[1]);
    const closing = /(["”」』])[ \t]*\*\*(?!\*)/g;
    closing.lastIndex = opening[0].length;
    // Marked masks code, escapes and link destinations before emphasis parsing.
    // Use that same mask so a quoted delimiter inside them cannot end the span.
    const masked = maskedSrc.slice(-src.length);
    for (let match; (match = closing.exec(masked));) {
      if (match[1] !== closingQuote) continue;
      const raw = src.slice(0, match.index + match[0].length), text = raw.slice(2, -2);
      return { type: "strong", raw, text, tokens: this.lexer.inlineTokens(text) };
    }
  }
}

// CommonMark lets `**` beside punctuation open or close only with a space or
// punctuation on its outer side, so 用**（注）**点 never pairs: CJK has no
// spaces. Count a CJK letter there as such a boundary (the markdown-cjk-friendly
// rule). Same capture groups as Marked 18's GFM rules; only the CJK cases differ.
const cjk = String.raw`[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]`,
  punct = String.raw`(?!~)[\p{P}\p{S}]`, punctSpace = String.raw`(?!~)[\s\p{P}\p{S}]`, word = String.raw`(?:[^\s\p{P}\p{S}]|~)`;
const cjkRules = {
  // Groups 1–2 close only, 3–4 open only, 5–6 do both.
  emStrongRDelimAst: new RegExp([String.raw`^[^_*]*?__[^_*]*?\*[^_*]*?(?=__)`, String.raw`[^*]+(?=[^*])`,
    String.raw`(?!\*)${punct}(\*+)(?=[\s]|$)`,
    String.raw`(?:(?!${cjk})${word}|${cjk}(?=\*+(?:[\s]|$)))(\*+)(?!\*)(?=${punctSpace}|$)`,
    String.raw`(?:[\s]|(?!\*)${punct}(?!\*+${cjk}))(\*+)(?=${word})`,
    String.raw`[\s](\*+)(?!\*)(?=${punct})`,
    String.raw`(?!\*)${punct}(\*+)(?!\*)(?=${punct})`,
    String.raw`(?:${word}(?=\*+${word})|(?!\*)${punct}(?=\*+${cjk})|${cjk}(?=\*+(?!\*)${punct}))(\*+)`].join("|"), "gu"),
  // The character before an opener followed by punctuation.
  punctuation: new RegExp(String.raw`^((?![*_])(?:[\s\p{P}\p{S}]|${cjk}))`, "u"),
};
// New lexer per message: reference definitions and streaming fragments cannot
// leak between turns. Single newlines remain visible, as in the ASK composer.
function lexer() {
  const tokenizer = new AskTokenizer(), lexer = new Lexer({ gfm: true, breaks: true, tokenizer });
  tokenizer.rules = { ...tokenizer.rules, inline: { ...tokenizer.rules.inline, ...cjkRules } };
  return lexer;
}
function ids(text: string, refs: boolean): Leaf[] {
  if (!refs) return [{ t: "text", v: text }];
  const out: Leaf[] = [];
  let at = 0;
  for (const match of text.matchAll(idPattern)) {
    if (match.index > at) out.push({ t: "text", v: text.slice(at, match.index) });
    out.push({ t: "id", v: match[0] });
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push({ t: "text", v: text.slice(at) });
  return out;
}
/** Links are opened only by a click; model-provided HTML and images never load. */
function linkUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function inlineTokens(tokens: readonly Token[], refs = true): Inline[] {
  const out: Inline[] = [];
  for (const value of tokens) {
    // This lexer has no extensions, so it emits only Marked's built-in tokens.
    const token = value as MarkedToken;
    switch (token.type) {
      case "text":
        out.push(...(token.tokens ? inlineTokens(token.tokens, refs) : ids(token.escaped ? token.text : decodeHTMLStrict(token.text), refs)));
        break;
      case "escape": out.push({ t: "text", v: token.text }); break;
      // Tables commonly use a bare HTML break; render only this exact tag as
      // a Vue node. Attributes, other HTML, escapes and code stay literal.
      case "html": out.push(/^<br\s*\/?>$/i.test(token.text) ? { t: "br" } : { t: "text", v: token.text }); break;
      case "codespan":
        out.push({ t: refs && /^#(?:h\d+|f\d+|a\d+|c\d+\.\d+(?:\.\d+)?)$/.test(token.text) ? "id" : "code", v: token.text });
        break;
      case "strong": case "em": case "del": out.push({ t: token.type, parts: inlineTokens(token.tokens, refs) }); break;
      case "br": out.push({ t: "br" }); break;
      case "checkbox": out.push({ t: "check", checked: token.checked }); break;
      case "link": case "image": {
        const literal = token.type === "link" && token.autolink;
        const href = linkUrl(literal ? token.href : decodeHTMLStrict(token.href));
        const parts = token.type === "image"
          ? [{ t: "text" as const, v: decodeHTMLStrict(token.text) || "图片" }]
          : literal ? [{ t: "text" as const, v: token.text }] : inlineTokens(token.tokens, false);
        out.push(...(href ? [{ t: "a" as const, href, ...(token.title ? { title: decodeHTMLStrict(token.title) } : {}), parts }] : parts));
        break;
      }
      default: out.push({ t: "text", v: token.raw });
    }
  }
  return out;
}
export const inline = (text: string): Inline[] => inlineTokens(lexer().inlineTokens(text));

function blockTokens(tokens: readonly Token[]): Block[] {
  const out: Block[] = [];
  for (const value of tokens) {
    const token = value as MarkedToken;
    switch (token.type) {
      case "space": case "def": break;
      case "heading": out.push({ t: "heading", depth: token.depth, parts: inlineTokens(token.tokens) }); break;
      case "paragraph": case "text": out.push({ t: "p", parts: token.tokens ? inlineTokens(token.tokens) : ids(decodeHTMLStrict(token.text), true) }); break;
      case "checkbox": out.push({ t: "p", parts: [{ t: "check", checked: token.checked }] }); break;
      case "list": out.push({ t: token.ordered ? "ol" : "ul", start: typeof token.start === "number" ? token.start : 1, loose: token.loose, items: token.items.map(item => ({ blocks: blockTokens(item.tokens), task: item.task })) }); break;
      case "blockquote": out.push({ t: "blockquote", blocks: blockTokens(token.tokens) }); break;
      case "code": out.push({ t: "pre", text: token.text, language: token.lang?.trim().split(/\s+/)[0] ?? "" }); break;
      case "hr": out.push({ t: "hr" }); break;
      case "table": out.push({ t: "table", header: token.header.map(cell => inlineTokens(cell.tokens)), rows: token.rows.map(row => row.map(cell => inlineTokens(cell.tokens))), align: token.align }); break;
      // Raw HTML is visible text, not a DOM subtree or a resource request.
      default: out.push({ t: "p", parts: [{ t: "text", v: token.raw }] });
    }
  }
  return out;
}
export const blocks = (text: string): Block[] => blockTokens(lexer().lex(text));

function leaves(parts: readonly Inline[]): Leaf[] {
  return parts.flatMap(part => "v" in part ? [part]
    : "parts" in part ? leaves(part.parts)
      : [{ t: "text", v: part.t === "br" ? " " : part.checked ? "☑ " : "☐ " }]);
}
/** Compact result cards use the same parse tree, flattened without controls. */
export function summary(text: string): Leaf[] {
  function first(nodes: readonly Block[]): Leaf[] {
    for (const node of nodes) {
      const result = "parts" in node ? leaves(node.parts)
        : node.t === "blockquote" ? first(node.blocks)
          : node.t === "ul" || node.t === "ol" ? first(node.items[0]?.blocks ?? [])
            : node.t === "pre" ? [{ t: "code" as const, v: node.text }]
              : node.t === "table" ? node.header.flatMap((cell, i) => [...(i ? [{ t: "text" as const, v: " · " }] : []), ...leaves(cell)]) : [];
      if (result.length) return result;
    }
    return [];
  }
  return first(blocks(text));
}
