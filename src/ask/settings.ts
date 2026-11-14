import { object } from "../domain/value.ts";
import { checkReplacement, checkWord } from "./codec.ts";
import type { Replacement, WordEncoding } from "./codec.ts";
import { DEFAULT_HIGH_WATER, highWater } from "./compact/trigger.ts";
import { readAskParameters } from "./parameters.ts";
import type { AskParameters } from "./parameters.ts";

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
  /** Each new conversation gets one attempt; manual titles are preserved. */
  autoNaming: boolean;
  /** IDs picked per reasoning connection, in order; the composer switches within the selected connection. */
  models: Record<string, string[]>;
  /** Optional overrides, isolated by connection and exact upstream model ID. */
  parameters?: Record<string, Record<string, AskParameters>>;
  images: boolean;
  responseMode: "text" | "tool";
  textAttachments: TextAttachmentLimits;
  compaction: { highWaterTokens: number };
  preference: string;
  words: string[];
  wordEncoding: WordEncoding;
  replacements: Replacement[];
  alwaysCodec: boolean;
}
export const PREFERENCE_LIMIT = 300;
export const MODEL_LIMIT = 20;
const CONNECTION_LIMIT = 32;
// Overrides also cover independent naming models and models no longer picked.
const PARAMETER_MODEL_LIMIT = 128;
export const defaultAskSettings = (): AskSettings => ({
  version: 1,
  connectionId: "",
  model: "",
  autoNaming: false,
  models: {},
  images: true,
  responseMode: "text",
  textAttachments: { ...DEFAULT_TEXT_ATTACHMENT_LIMITS },
  compaction: { highWaterTokens: DEFAULT_HIGH_WATER },
  preference: "",
  words: [],
  wordEncoding: "alias",
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
  out.autoNaming = v.autoNaming === true;
  if (connectionKey(naming.connectionId))
    out.naming = { connectionId: naming.connectionId, model: typeof naming.model === "string" ? modelId(naming.model) : "" };
  for (const [id, list] of Object.entries(object(v.models))) {
    if (Object.keys(out.models).length >= CONNECTION_LIMIT) break;
    const ids = connectionKey(id) ? modelList(list) : [];
    if (ids.length) out.models[id] = ids;
  }
  const parameters = Object.fromEntries(Object.entries(object(v.parameters)).filter(([id]) => connectionKey(id)).slice(0, CONNECTION_LIMIT).flatMap(([id, models]) => {
    const entries = Object.entries(object(models)).slice(0, PARAMETER_MODEL_LIMIT).flatMap(([model, value]) => {
      const params = readAskParameters(value), normalized = modelId(model);
      return normalized && Object.keys(params).length ? [[normalized, params]] : [];
    });
    return entries.length ? [[id, Object.fromEntries(entries)]] : [];
  }));
  if (Object.keys(parameters).length) out.parameters = parameters;
  if (typeof v.images === "boolean") out.images = v.images;
  if (v.responseMode === "tool") out.responseMode = "tool";
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
  if (v.wordEncoding === "unicode") out.wordEncoding = "unicode";
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

export function modelParameters(s: AskSettings, connectionId: string, id: string): AskParameters {
  const models = Object.hasOwn(s.parameters ?? {}, connectionId) ? s.parameters![connectionId] : {};
  return readAskParameters(Object.hasOwn(models, id) ? models[id] : undefined);
}

/** Editing a model's overrides never selects it or discards other models' settings. */
export function withParameters(s: AskSettings, connectionId: string, id: string, value: AskParameters): AskSettings {
  const parameters = { ...s.parameters }, models = { ...(Object.hasOwn(parameters, connectionId) ? parameters[connectionId] : {}) };
  const params = readAskParameters(value);
  delete models[id];
  if (Object.keys(params).length) Object.defineProperty(models, id, { value: params, enumerable: true, configurable: true, writable: true });
  delete parameters[connectionId];
  if (Object.keys(models).length) Object.defineProperty(parameters, connectionId, { value: models, enumerable: true, configurable: true, writable: true });
  const { parameters: _previous, ...rest } = s;
  return Object.keys(parameters).length ? { ...rest, parameters } : rest;
}
