import type { Binding, SlateAsset } from "./model.ts";
import { sourceRecipe } from "../domain/image-parameters.ts";
/** Only balanced NAI {} / [] weights, numeric ::weights:: and balanced XML tags without attributes.
 * Escapes and malformed constructs are preserved; no semantic filtering. */
export function stripSyntax(text: string): string {
  const remove = new Set<number>(), stack: { char: string; at: number }[] = [];
  let broken = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === "{" || text[i] === "[") stack.push({ char: text[i], at: i });
    else if (text[i] === "}" || text[i] === "]") {
      const last = stack.at(-1);
      if (!last || last.char !== (text[i] === "}" ? "{" : "[")) { broken = true; break; }
      stack.pop(); remove.add(last.at); remove.add(i);
    }
  }
  if (broken || stack.length) remove.clear();
  const weightRemove = new Set<number>();
  let weightInvalid = false;
  const weights: { at: number; length: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    const m = /^-?(?:\d+(?:\.\d+)?|\.\d+)::/.exec(text.slice(i));
    if (m && (i === 0 || !/[\w.]/.test(text[i - 1]))) { weights.push({ at: i, length: m[0].length }); i += m[0].length - 1; }
    else if (text.slice(i, i + 2) === "::") {
      const start = weights.pop();
      if (start) { for (let j = start.at; j < start.at + start.length; j++) weightRemove.add(j); weightRemove.add(i); weightRemove.add(i + 1); }
      else weightInvalid = true;
      i++;
    }
  }
  if (!weightInvalid && !weights.length) for (const i of weightRemove) remove.add(i);
  const tags: { name: string; at: number; length: number }[] = [], xml = new Set<number>();
  let invalid = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    const m = /^<(\/?)([A-Za-z][\w-]*)\s*>/.exec(text.slice(i));
    if (!m) continue;
    if (!m[1]) tags.push({ name: m[2], at: i, length: m[0].length });
    else {
      const tag = tags.pop();
      if (!tag || tag.name !== m[2]) { invalid = true; break; }
      for (let j = tag.at; j < tag.at + tag.length; j++) xml.add(j);
      for (let j = i; j < i + m[0].length; j++) xml.add(j);
    }
    i += m[0].length - 1;
  }
  if (!invalid && !tags.length) for (const i of xml) remove.add(i);
  return text.split("").filter((_, i) => !remove.has(i)).join("");
}
export function captionText(asset: SlateAsset, caption: Binding["caption"]) {
  const params = sourceRecipe(asset.params);
  let value: unknown;
  if (caption.source === "base") value = params.basePrompt;
  else if (caption.source === "sent") value = params.prompt;
  else {
    const chars = params.localCharacters;
    value = Array.isArray(chars) ? chars.find(c => c.id === caption.characterId)?.prompt : undefined;
  }
  if (typeof value !== "string") throw new Error("该图片没有所选来源的提示词，请明确选择其他来源");
  return caption.mode === "full" ? value : stripSyntax(value);
}
