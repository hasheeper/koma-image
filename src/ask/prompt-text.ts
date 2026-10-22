import { analyze } from "../domain/highlight.ts";

/** Literal comma/newline spans for local .keep rendering; no semantic classes. */
export function promptParts(text: string) {
  const syntax = new Uint8Array(text.length);
  let at = 0;
  for (const token of analyze(text)) {
    if (token.syntax) syntax.fill(1, at, at + token.text.length);
    at += token.text.length;
  }
  return [...text.matchAll(/[^,，\n]+/g)].flatMap((match) => {
    const raw = match[0], start = match.index + raw.length - raw.trimStart().length,
      end = match.index + raw.trimEnd().length;
    let bare = "";
    for (let i = start; i < end; i++) if (!syntax[i]) bare += text[i];
    const tag = bare.trim().replace(/\s+/g, " ").toLowerCase();
    return tag ? [{ text: text.slice(start, end), tag, start, end }] : [];
  });
}
