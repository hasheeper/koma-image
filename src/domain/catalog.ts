import { configuredModels, findModel } from "./models.ts";
import type { ModelIdentity } from "./models.ts";
import type { Routing } from "../config/connections.ts";
import { imageConnections } from "../config/connections.ts";
import { object, strings } from "./value.ts";
import type { GatewayProfile } from "../gateway/profile.ts";
import { profileFor } from "../gateway/profile.ts";
import { acceptsParameter, applyParameterOverrides, declaredParameterFields } from "./model-parameters.ts";
import type { ParameterFields } from "./model-parameters.ts";

export interface CatalogEntry { id: string; family?: string }
export interface CatalogModel {
  profileId?: string;
  /** Non-secret connection revision; invalidates cached read-only estimates. */
  sourceRevision?: string;
  id: string; upstreamId: string; connection: string; name: string; description: string; provider: string; family?: string;
  quotaGroup?: string; maxPixels: number; operations: string[]; tools: string[]; replaces: string[];
  fields: ParameterFields;
  parameterSource?: "declared" | "reference";
  sourceMaxPixels: number; maxImages: number; chat: boolean; transparentBackground: boolean; unmetered: boolean;
}
export const bareId = (id: string) => id.replace(/@[^@/]+$/, "").replace(/^.*\//, "").toLowerCase();
export const shownId = (id: string) => id.replace(/@[^@/]+$/, "");
export function catalogEntries(raw: unknown): CatalogEntry[] {
  return Object.entries(object(object(raw).models)).map(([id, value]) => ({ id,
    family: typeof object(value).editor_family === "string" ? object(value).editor_family as string : undefined }));
}
export function autoMatch(entries: CatalogEntry[], model: ModelIdentity) {
  return entries.find(e => bareId(e.id) === model.id && (!e.family || e.family === model.family))?.id ?? null;
}
export function linkFor(routing: Routing, connection: string, model: ModelIdentity, entries: CatalogEntry[]) {
  if (!supportsModel(routing, connection, model)) return null;
  const records = routing.links[connection] ?? {};
  if (records[model.id]) return records[model.id];
  const id = autoMatch(entries, model);
  return id && !Object.values(records).some(link => link.id === id) ? { id, manual: false, on: true } : null;
}
export function supportsModel(routing: Routing, connection: string, model: ModelIdentity) {
  const c = routing.connections[connection];
  if (!c) return false;
  const profile = profileFor(c.profileId);
  return profile.image && (profile.protocol === "novelai" ? model.family === "novelai"
    : ["openai-images", "gemini-native"].includes(profile.protocol ?? "") ? model.family !== "novelai" : true);
}
export function sourceState(routing: Routing, connection: string, model: ModelIdentity, entries: CatalogEntry[]) {
  const link = linkFor(routing, connection, model, entries);
  return !link ? "miss" : (!link.manual || model.family === "novelai") && !entries.some(e => e.id === link.id)
    ? "gone" : !link.on ? "off" : "on";
}
/** The settings list also includes manually configured IDs absent from discovery. */
export function sourceEntries(routing: Routing, connection: string, raw: unknown): CatalogEntry[] {
  const entries = catalogEntries(raw);
  for (const model of configuredModels(routing)) {
    const link = linkFor(routing, connection, model, entries);
    if (model.family !== "novelai" && link?.manual && !entries.some(e => e.id === link.id))
      entries.push({ id: link.id, family: model.family });
  }
  return entries;
}
export function firstSource(routing: Routing, available: readonly string[]) {
  return imageConnections(routing).find(c => available.includes(c.id))?.id;
}
export function modelSource(routing: Routing, raw: Record<string, unknown>, model: ModelIdentity) {
  return firstSource(routing, imageConnections(routing)
    .filter(c => sourceState(routing, c.id, model, catalogEntries(raw[c.id])) === "on").map(c => c.id));
}
/** Preview order; execution rechecks the exact operation and funds before submission. */
export function selectCatalogSources(routing: Routing, candidates: CatalogModel[]) {
  const groups = new Map<string, CatalogModel[]>();
  for (const model of candidates) {
    const group = groups.get(model.id) ?? [];
    group.push(model);
    groups.set(model.id, group);
  }
  return [...groups.values()].flatMap(group => {
    const source = firstSource(routing, group.map(m => m.connection));
    const selected = group.find(m => m.connection === source);
    return selected ? [selected] : [];
  });
}
export function validateCatalog(raw: unknown, profile: GatewayProfile) {
  const value = object(raw), features = object(value.studio_features);
  if (profile.catalog.minimumVersion > 0 && !(Number(features.version) >= profile.catalog.minimumVersion) || profile.catalog.requireCostCeiling && features.max_cost !== true) throw new Error("上游尚未支持报价保护，请更新后重试");
  if (!Object.keys(object(value.models)).length) throw new Error("连接没有可用模型");
  return value;
}
export function normalizeCatalog(raw: unknown, routing: Routing, connection: string, profile?: GatewayProfile) {
  const value = object(raw), features = object(value.studio_features);
  const contextImages = Number(features.max_context_images) || 15;
  const entries = catalogEntries(value), claimed = new Map<string, ModelIdentity>();
  for (const model of configuredModels(routing)) {
    const link = linkFor(routing, connection, model, entries);
    if (link) claimed.set(link.id, model);
  }
  const models: CatalogModel[] = [];
  for (const [upstreamId, rawModel] of Object.entries(object(value.models))) {
    const meta = object(rawModel), entry = claimed.get(upstreamId);
    if (entry && routing.links[connection]?.[entry.id]?.on === false) continue;
    if (!entry && findModel(bareId(upstreamId))) continue;
    // Once the editable list is saved, GPT/Gemini directory entries require a configured mapping.
    // This prevents deleted entries resurfacing under a supplier's alias; other gateway tools remain available.
    if (!entry && routing.models && (["gpt", "gemini"].includes(String(meta.editor_family)) ||
      ["openai", "gemini"].includes(String(meta.provider_id ?? meta.provider)))) continue;
    const id = entry?.id ?? upstreamId;
    let fields = declaredParameterFields(object(meta.image_capabilities).fields);
    const provider = entry?.provider ?? String(meta.provider_id ?? meta.provider ?? "");
    // Preserve the format restriction of the model family.
    if (provider === "fal" && /upscal|super[-_ ]?resolution/i.test(`${id} ${meta.name ?? ""}`) && fields.output_format?.options.includes("jpg")) {
      const f = fields.output_format;
      f.options = f.options.filter(v => v !== "jpg");
      if (!f.options.includes(f.default)) f.default = f.options[0];
      if (!f.options.length) delete fields.output_format;
    }
    for (const [key, value] of Object.entries(entry?.defaults ?? {})) {
      if (fields[key] && acceptsParameter(fields[key], value)) fields[key] = { ...fields[key], default: value };
    }
    if (entry?.family !== "novelai") fields = applyParameterOverrides(fields, routing.links[connection]?.[id]?.parameters);
    const native = profile?.protocol && profile.protocol !== "standard";
    models.push({ id, upstreamId, connection, sourceRevision: routing.connections[connection]?.revision, ...(profile ? { profileId: profile.id } : {}), name: String(entry?.name || meta.name || id), description: String(meta.description || ""),
      provider, family: entry?.family ?? (typeof meta.editor_family === "string" ? meta.editor_family : undefined),
      quotaGroup: typeof meta.quota_group === "string" ? meta.quota_group : undefined,
      maxPixels: Number(meta.max_resolution) || 1_048_576, operations: strings(meta.operations), fields,
      parameterSource: object(meta.image_capabilities).source === "reference" ? "reference" : "declared",
      replaces: strings(meta.replaces), tools: strings(meta.tools),
      sourceMaxPixels: Number(object(meta.generation_references).max_pixels) || 32_000_000,
      maxImages: Math.min(entry?.inputImages ?? 16, native ? Number(meta.max_context_images) || 16 : contextImages), chat: entry?.chat === true || !!native && meta.chat === true,
      transparentBackground: entry?.transparentBackground === true, unmetered: meta.unmetered === true });
  }
  return { models, features, defaults: object(value.defaults), samplers: strings(value.valid_samplers).length ? strings(value.valid_samplers) : ["k_euler_ancestral"] };
}
export type Catalog = ReturnType<typeof normalizeCatalog>;
export function resolveModel(models: CatalogModel[], wanted: string) {
  const id = findModel(wanted)?.id ?? wanted, exact = models.find(m => m.id === id);
  if (exact) return exact;
  const matches = models.filter(m => m.upstreamId === wanted || m.replaces.includes(wanted));
  return matches.length === 1 ? matches[0] : null;
}
export const normalizeOptions = (model: CatalogModel, values: Record<string, string> = {}) => Object.fromEntries(
  Object.entries(model.fields).map(([key, field]) => [key,
    values[key] === "" || acceptsParameter(field, values[key] ?? "") ? values[key] : field.default]));
