import { canonical } from "./canonical.ts";
import type { DigestImage } from "./digest/index.ts";
import type { Ids } from "./ids.ts";

/** A turn owns these references; later history deletion cannot change its input. */
export interface Picture extends DigestImage {
  readonly label: string;
  readonly aliases: readonly string[];
  readonly blob: Blob;
}
export const promptOf = (image: DigestImage) => String(image.params.basePrompt ?? image.params.prompt ?? "");
export function metadata(image: DigestImage): Record<string, unknown> {
  const out: Record<string, unknown> = {
    prompt: promptOf(image),
    negative: String(image.params.negative_prompt ?? image.params.negative ?? ""),
    width: image.size.width,
    height: image.size.height,
  };
  // All parameters currently persisted by drawing/editor; omit routing and binary inputs.
  for (const key of ["model", "modelName", "seed", "steps", "scale", "cfg", "sampler", "strength", "noise", "noise_schedule", "cfg_rescale", "tool", "transparentBg", "optimize", "cache", "transform_prompt", "transform_mode", "randomSeed", "batchCount", "batchIndex", "batchTotal", "isComparison", "comparisonTotal", "seedStart"])
    if (image.params[key] === null || ["string", "number", "boolean"].includes(typeof image.params[key])) out[key] = image.params[key];
  // Preserve the effective prompt and requested size only when they differ.
  if (typeof image.params.prompt === "string" && image.params.prompt !== out.prompt) out.sent_prompt = image.params.prompt;
  if (typeof image.params.width === "number" && typeof image.params.height === "number" &&
    (image.params.width !== image.size.width || image.params.height !== image.size.height))
    out.requested_size = { width: image.params.width, height: image.params.height };
  return out;
}
export function snapshotPictures(
  history: readonly (DigestImage & { readonly blob: Blob })[],
  favorites: readonly (DigestImage & { readonly blob: Blob })[],
  ids: Ids,
): readonly Picture[] {
  ids.sync(history, favorites);
  const records = new Map([...history, ...favorites].map((r) => [r.id, r]));
  return [...records.values()].map((r) => Object.freeze({
    id: r.id, createdAt: r.createdAt, favoritedAt: r.favoritedAt,
    label: ids.label(r.id)!,
    aliases: [ids.history(r.id), ids.favorite(r.id)].filter((v): v is string => !!v),
    params: Object.freeze(structuredClone(r.params)),
    size: Object.freeze({ ...r.size }), blob: r.blob,
  }));
}
export const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ").trim();
/** Tag/word Jaccard; weight syntax is retained so weighting edits remain visible. */
export const words = (text: string) => normalize(text).split(/[\s,，]+/).filter(Boolean);
export function similarity(a: string, b: string) {
  const left = new Set(words(a)), right = new Set(words(b));
  const union = new Set([...left, ...right]).size;
  return union ? [...left].filter((word) => right.has(word)).length / union : 1;
}
export function promptDiff(before: string, after: string) {
  const split = (value: string) => value.split(/[,，\n]+/).map((v) => v.trim()).filter(Boolean);
  const a = split(before), b = split(after);
  const subtract = (x: string[], y: string[]) => {
    const remaining = y.map(normalize);
    return x.filter((value) => {
      const at = remaining.indexOf(normalize(value));
      if (at < 0) return true;
      remaining.splice(at, 1);
      return false;
    });
  };
  return { removed: subtract(a, b), added: subtract(b, a) };
}
export function differences(a: DigestImage, b: DigestImage) {
  const before = metadata(a), after = metadata(b);
  return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => canonical(before[key] ?? null) !== canonical(after[key] ?? null))
    .map((key) => [key, { before: before[key] ?? null, after: after[key] ?? null }]));
}
