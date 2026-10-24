import { object } from "../domain/value.ts";
import { checkReplacement, checkWord } from "./codec.ts";
import type { Replacement } from "./codec.ts";
import { DEFAULT_HIGH_WATER, highWater } from "./compact/trigger.ts";

export interface TextAttachmentLimits { chars: number; totalChars: number }
export const DEFAULT_TEXT_ATTACHMENT_LIMITS: Readonly<TextAttachmentLimits> = Object.freeze({ chars: 50_000, totalChars: 100_000 });
export function readTextAttachmentLimits(value: unknown): TextAttachmentLimits {
  const v = object(value);
  const positive = (value: unknown, fallback: number) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
  const chars = positive(v.chars, DEFAULT_TEXT_ATTACHMENT_LIMITS.chars);
  return { chars, totalChars: Math.max(chars, positive(v.totalChars, DEFAULT_TEXT_ATTACHMENT_LIMITS.totalChars)) };
}

/** Stored under koma.ask.v1 and carried by backups; the adult flag lives apart. */
export interface AskSettings {
  version: 1;
  connectionId: string;
  /** The ID in use; always one of `models[connectionId]` once that list has any. */
  model: string;
  /** Absent means use the current ASK connection and model. */
  naming?: { connectionId: string; model: string };
  /** IDs picked per reasoning connection, in the order picked; the composer switches among them. */
  models: Record<string, string[]>;
  images: boolean;
  textAttachments: TextAttachmentLimits;
  compaction: { highWaterTokens: number };
  preference: string;
  words: string[];
  replacements: Replacement[];
  alwaysCodec: boolean;
}
export const PREFERENCE_LIMIT = 300;
export const MODEL_LIMIT = 20;
const CONNECTION_LIMIT = 32;
export const defaultAskSettings = (): AskSettings => ({
  version: 1,
  connectionId: "",
  model: "",
  models: {},
  images: true,
  textAttachments: { ...DEFAULT_TEXT_ATTACHMENT_LIMITS },
  compaction: { highWaterTokens: DEFAULT_HIGH_WATER },
  preference: "",
  words: [],
  replacements: [],
  alwaysCodec: false,
});
/** Opaque upstream IDs go in JSON bodies: preserve spaces, case and suffixes. */
export const modelId = (text: string) => {
  const id = text.trim();
  return id.length <= 200 && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(id) ? id : "";
};
const connectionKey = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length < 512;
function modelList(value: unknown) {
  const out: string[] = [];
  if (Array.isArray(value))
    for (const item of value) {
      const id = typeof item === "string" ? modelId(item) : "";
      if (id && !out.includes(id) && out.length < MODEL_LIMIT) out.push(id);
    }
  return out;
}
/** The active ID joins its connection's list (older data held only one), else the list's first is used. */
function settle(out: AskSettings) {
  if (!out.connectionId) return out;
  const list = out.models[out.connectionId] ?? [];
  if (out.model && !list.includes(out.model) && list.length < MODEL_LIMIT)
    out.models = { ...out.models, [out.connectionId]: [...list, out.model] };
  else if (!list.includes(out.model)) out.model = list[0] ?? "";
  return out;
}
/** Unknown or structurally invalid fields fall back; no vocabulary classification. */
export function readAskSettings(value: unknown): AskSettings {
  const v = object(value),
    out = defaultAskSettings();
  if (typeof v.connectionId === "string" && v.connectionId.length < 512)
    out.connectionId = v.connectionId;
  if (typeof v.model === "string") out.model = modelId(v.model);
  const naming = object(v.naming);
  if (connectionKey(naming.connectionId))
    out.naming = { connectionId: naming.connectionId, model: typeof naming.model === "string" ? modelId(naming.model) : "" };
  for (const [id, list] of Object.entries(object(v.models))) {
    if (Object.keys(out.models).length >= CONNECTION_LIMIT) break;
    const ids = connectionKey(id) ? modelList(list) : [];
    if (ids.length) out.models[id] = ids;
  }
  if (typeof v.images === "boolean") out.images = v.images;
  out.textAttachments = readTextAttachmentLimits(v.textAttachments);
  out.compaction = { highWaterTokens: highWater(object(v.compaction).highWaterTokens) };
  if (typeof v.preference === "string")
    out.preference = v.preference.slice(0, PREFERENCE_LIMIT);
  if (Array.isArray(v.words))
    for (const item of v.words) {
      if (typeof item !== "string") continue;
      const checked = checkWord(item, out.words);
      if ("word" in checked) out.words.push(checked.word);
    }
  if (typeof v.alwaysCodec === "boolean") out.alwaysCodec = v.alwaysCodec;
  if (Array.isArray(v.replacements))
    for (const item of v.replacements) {
      const rule = object(item);
      if (typeof rule.from !== "string" || typeof rule.to !== "string") continue;
      const checked = checkReplacement(rule.from, rule.to, out.replacements);
      if ("replacement" in checked) out.replacements.push(checked.replacement);
    }
  return settle(out);
}
/** Replaces one connection's picks; the active ID moves only if it was dropped. */
export function withModels(s: AskSettings, connectionId: string, ids: readonly string[]): AskSettings {
  const rest = { ...s.models },
    list = modelList(ids);
  delete rest[connectionId];
  return settle({
    ...s,
    models: list.length ? { ...rest, [connectionId]: list } : rest,
    model: s.connectionId === connectionId && !list.includes(s.model) ? "" : s.model,
  });
}
/** Switching connection resumes its first pick. */
export const withConnection = (s: AskSettings, connectionId: string): AskSettings =>
  settle({ ...s, connectionId, model: "" });
/** Uses one picked ID, switching connection when it belongs to another. */
export const withModel = (s: AskSettings, connectionId: string, id: string): AskSettings =>
  s.models[connectionId]?.includes(id) ? { ...s, connectionId, model: id } : s;
