import { naiEnhancePrompt, isEnhanceScale } from "./nai-enhance.ts";
import { naiCapabilities, naiMediumNegative } from "./nai.ts";
import { readCharacters, activeCharacters } from "./characters.ts";
import type { ImagePayload } from "../gateway/routes.ts";

export const naiInputLimits = (model: string) => {
  const cap = naiCapabilities(model);
  return !cap.supported ? null : { encoder: cap.v5 ? "qwen35" as const : "t5" as const,
    tokens: cap.v5 ? model.replace(/@local$/, "").endsWith("curated") ? 703 : 1471 : 512,
    text: cap.v5 ? model.replace(/@local$/, "").endsWith("curated") ? 374 : 750 : 118 };
};
export function naiInputParts(payload: ImagePayload) {
  const cap = naiCapabilities(payload.model);
  const roles = activeCharacters(readCharacters(payload.characters), payload.model);
  let base = typeof payload.prompt === "string" && payload.prompt.trim() ? payload.prompt : "best quality";
  if (payload.enhance && isEnhanceScale(payload.enhanceScale)) base = naiEnhancePrompt(base, payload.enhanceScale);
  const prompt = [base, ...roles.map(c => c.prompt)];
  const negative = [cap.medium ? naiMediumNegative(base) : String(payload.negative_prompt || ""), ...roles.map(c => cap.medium ? "" : c.negative)];
  return { prompt, negative, ids: ["", ...roles.map(c => c.id)] };
}
/** Text: consumes everything after the marker, including whitespace/newlines.
 * Count Unicode characters, not UTF-16 code units; never rewrite the original. */
export function naiTextLength(text: string) {
  const marker = /\bText: ?/i.exec(text);
  return marker ? Array.from(text.slice(marker.index + marker[0].length)).length : 0;
}
export function validateNaiText(payload: ImagePayload) {
  const limits = naiInputLimits(payload.model);
  if (!limits || payload.tool === "upscale" || payload.tool === "director") return;
  const { prompt } = naiInputParts(payload);
  const text = prompt.reduce((n, s) => n + naiTextLength(s), 0);
  if (text > limits.text) throw new Error(`Text: 共 ${text} 字符，当前型号最多 ${limits.text} 字符（含空白与换行）`);
}
