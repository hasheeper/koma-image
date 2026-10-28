import { readInpaintFocus } from "../domain/inpaint-focus.ts";
import { referenceSummary } from "../domain/nai-references.ts";
import { readCharacters } from "../domain/characters.ts";
import { canonical } from "./canonical.ts";
import { imageParameters } from "../domain/image-parameters.ts";
import { imageOrigin } from "../domain/image-origin.ts";
import type { DigestImage } from "./digest/index.ts";
import type { Ids } from "./ids.ts";

/** A turn owns these references; later history deletion cannot change its input. */
export type PictureSource = "history" | "favorites" | "chat" | "attachment";
export interface PictureOrigin {
  readonly source: PictureSource;
  readonly label: string;
  /** Oldest to newest within this source, independent of retained aliases. */
  readonly order: number;
}
export interface Picture extends DigestImage {
  readonly label: string;
  readonly aliases: readonly string[];
  readonly origins: readonly PictureOrigin[];
  readonly blob: Blob;
  readonly attachment?: Readonly<Record<string, unknown>>;
}
export const promptOf = (image: DigestImage) => String(image.params.basePrompt ?? image.params.prompt ?? "");
export const comparisonPrompt = (image: DigestImage) => [promptOf(image), ...readCharacters(image.params.characters).filter(c => c.on).map(c => c.prompt)].join("\n");
export function metadata(image: DigestImage): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...imageOrigin(image.params),
    prompt: promptOf(image),
    negative: String(image.params.baseNegative ?? image.params.negative_prompt ?? image.params.negative ?? ""),
    width: image.size.width,
    height: image.size.height,
  };
  if (image.params.tool === "manual-edit") {
    const manual = imageParameters(image.params);
    out.edit_source = manual.editSource;
    out.source_recipe = manual.sourceRecipe;
  }
  // All parameters currently persisted by drawing/editor; omit routing and binary inputs.
  for (const key of ["model", "modelName", "seed", "steps", "scale", "cfg", "cfgRescale", "noiseSchedule", "naiMode", "complexity", "qualityPreset", "negativePreset", "sampler", "strength", "noise", "noise_schedule", "cfg_rescale", "enhance", "enhanceScale", "enhanceMagnitude", "tool", "transparentBg", "optimize", "cache", "transform_prompt", "transform_mode", "randomSeed", "batchCount", "batchIndex", "batchTotal", "isComparison", "comparisonTotal", "seedStart", "version", "image_index", "selected"])
    if (image.params[key] === null || ["string", "number", "boolean"].includes(typeof image.params[key])) out[key] = image.params[key];
  if (image.params.naiReferences) out.references = referenceSummary(image.params.naiReferences);
  const focus = readInpaintFocus(image.params.inpaintFocus);
  if (focus) out.inpaintFocus = focus;
  if (Array.isArray(image.params.characters)) {
    out.characters = readCharacters(image.params.characters);
    out.placement = image.params.placement === "manual" ? "manual" : "auto";
  }
  if (Array.isArray(image.params.localCharacters)) out.local_characters = readCharacters(image.params.localCharacters);
  for (const key of ["boardId", "boardName", "boardColor"]) if (typeof image.params[key] === "string") out[key] = image.params[key];
  if (typeof image.params.negative_prompt === "string" && image.params.negative_prompt !== out.negative) out.sent_negative = image.params.negative_prompt;
  // CHAT turns record option values (size, quality…) instead of drawing fields.
  if (image.params.chat_options && typeof image.params.chat_options === "object") out.chat_options = image.params.chat_options;
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
  const historyOrder = new Map(history.map((r, i) => [r.id, history.length - i]));
  const favoriteOrder = new Map([...favorites].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map((r, i) => [r.id, i + 1]));
  const records = new Map([...history, ...favorites].map((r) => [r.id, r]));
  return [...records.values()].map((r) => {
    const origins: PictureOrigin[] = [];
    if (historyOrder.has(r.id)) origins.push({ source: "history", label: ids.history(r.id)!, order: historyOrder.get(r.id)! });
    if (favoriteOrder.has(r.id)) origins.push({ source: "favorites", label: ids.favorite(r.id)!, order: favoriteOrder.get(r.id)! });
    return Object.freeze({
    id: r.id, createdAt: r.createdAt, favoritedAt: r.favoritedAt,
    label: origins[0].label,
    aliases: [ids.history(r.id), ids.favorite(r.id)].filter((v): v is string => !!v),
    origins: Object.freeze(origins.map((origin) => Object.freeze(origin))),
    params: Object.freeze(structuredClone(r.params)),
    size: Object.freeze({ ...r.size }), blob: r.blob,
    });
  });
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
  const result: Record<string, unknown> = Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => canonical(before[key] ?? null) !== canonical(after[key] ?? null))
    .map((key) => [key, { before: before[key] ?? null, after: after[key] ?? null }]));
  if (result.characters) {
    const left = readCharacters(a.params.characters), right = readCharacters(b.params.characters), byId = !!a.params.boardId && a.params.boardId === b.params.boardId;
    const keys = byId ? [...new Set([...left, ...right].map(c => c.id))] : Array.from({ length: Math.max(left.length, right.length) }, (_, i) => String(i));
    result.characters = { alignment: byId ? "stable_id" : "list_order_only_identity_unknown", order: { before: left.map(c => c.id), after: right.map(c => c.id) }, items: keys.flatMap(key => {
      const x = byId ? left.find(c => c.id === key) : left[Number(key)], y = byId ? right.find(c => c.id === key) : right[Number(key)];
      return canonical(x ?? null) === canonical(y ?? null) ? [] : [{ id: key, before: x ?? null, after: y ?? null }];
    }) };
  }
  return result;
}
