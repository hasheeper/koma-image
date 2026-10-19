import { MODELS, findModel } from "./models.ts";
import type { ModelIdentity } from "./models.ts";
import type { Routing } from "../config/connections.ts";
import { object, strings } from "./value.ts";
import type { GatewayProfile } from "../gateway/profile.ts";

export interface CatalogEntry { id: string; family?: string }
export interface CatalogModel {
  id: string; upstreamId: string; connection: string; name: string; description: string; provider: string; family?: string;
  quotaGroup?: string; maxPixels: number; operations: string[]; tools: string[]; replaces: string[];
  fields: Record<string, { options: string[]; default: string }>;
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
  const records = routing.links[connection] ?? {};
  if (records[model.id]) return records[model.id];
  const id = autoMatch(entries, model);
  return id && !Object.values(records).some(link => link.id === id) ? { id, manual: false, on: true } : null;
}
export function sourceState(routing: Routing, connection: string, model: ModelIdentity, entries: CatalogEntry[]) {
  const link = linkFor(routing, connection, model, entries);
  return !link ? "miss" : !entries.some(e => e.id === link.id) ? "gone" : link.on ? "on" : "off";
}
export function validateCatalog(raw: unknown, profile: GatewayProfile) {
  const value = object(raw), features = object(value.studio_features);
  if (!(Number(features.version) >= profile.catalog.minimumVersion) || profile.catalog.requireCostCeiling && features.max_cost !== true) throw new Error("上游尚未支持报价保护，请更新后重试");
  if (!Object.keys(object(value.models)).length) throw new Error("连接没有可用模型");
  return value;
}
export function normalizeCatalog(raw: unknown, routing: Routing, connection: string) {
  const value = object(raw), features = object(value.studio_features);
  const contextImages = Number(features.max_context_images) || 15;
  const entries = catalogEntries(value), claimed = new Map<string, ModelIdentity>();
  for (const model of MODELS) {
    const link = linkFor(routing, connection, model, entries);
    if (link) claimed.set(link.id, model);
  }
  const models: CatalogModel[] = [];
  for (const [upstreamId, rawModel] of Object.entries(object(value.models))) {
    const meta = object(rawModel), entry = claimed.get(upstreamId);
    if (entry && routing.links[connection]?.[entry.id]?.on === false) continue;
    if (!entry && findModel(bareId(upstreamId))) continue;
    const id = entry?.id ?? upstreamId, fields: CatalogModel["fields"] = {};
    for (const key of ["quality", "size", "aspect_ratio", "image_size", "output_format"]) {
      const field = object(object(object(meta.image_capabilities).fields)[key]), options = strings(field.options);
      if (options.length) fields[key] = { options, default: typeof field.default === "string" && options.includes(field.default) ? field.default : options[0] };
    }
    const provider = entry?.provider ?? String(meta.provider_id ?? meta.provider ?? "");
    // Preserve the format restriction of the model family.
    if (provider === "fal" && /upscal|super[-_ ]?resolution/i.test(`${id} ${meta.name ?? ""}`) && fields.output_format?.options.includes("jpg")) {
      const f = fields.output_format;
      f.options = f.options.filter(v => v !== "jpg");
      if (!f.options.includes(f.default)) f.default = f.options[0];
      if (!f.options.length) delete fields.output_format;
    }
    for (const [key, allowed] of Object.entries(entry?.options ?? {})) {
      const field = fields[key];
      if (!field) continue;
      const options = field.options.filter(v => allowed.includes(v));
      if (options.length) fields[key] = { options, default: options.includes(field.default) ? field.default : options[0] };
      else delete fields[key];
    }
    models.push({ id, upstreamId, connection, name: String(meta.name || entry?.name || id), description: String(meta.description || ""),
      provider, family: entry?.family ?? (typeof meta.editor_family === "string" ? meta.editor_family : undefined),
      quotaGroup: typeof meta.quota_group === "string" ? meta.quota_group : undefined,
      maxPixels: Number(meta.max_resolution) || 1_048_576, operations: strings(meta.operations), fields, replaces: strings(meta.replaces), tools: strings(meta.tools),
      sourceMaxPixels: Number(object(meta.generation_references).max_pixels) || 32_000_000,
      maxImages: Math.min(entry?.inputImages ?? 16, contextImages), chat: entry?.chat === true,
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
  Object.entries(model.fields).map(([key, field]) => [key, field.options.includes(values[key]) ? values[key] : field.default]));
