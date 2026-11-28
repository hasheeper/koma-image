import type { ImageFormat } from "../config/image-channel.ts";
import type { ImageChannelModel, SplitLimits } from "../gateway/image-channel-models.ts";
import { configuredModels, findModel, imageModelFields } from "./models.ts";
import type { ModelIdentity } from "./models.ts";
import type { Routing } from "../config/connections.ts";
import { imageConnections, modelParameterOverrides } from "../config/connections.ts";
import { object, strings } from "./value.ts";
import type { GatewayProfile } from "../gateway/profile.ts";
import { profileFor } from "../gateway/profile.ts";
import { acceptsParameter, applyParameterOverrides, channelParameterField, declaredParameterFields, requestParameterFields } from "./model-parameters.ts";
import type { ParameterFields } from "./model-parameters.ts";

export interface CatalogEntry { id: string; family?: string }
export interface CatalogModel {
  profileId?: string;
  channelFormat?: ImageFormat;
  layerDecomposition?: boolean;
  splitLimits?: SplitLimits;
  splitFields?: ParameterFields;
  templateId?: string;
  /** Non-secret connection revision; invalidates cached read-only estimates. */
  sourceRevision?: string;
  id: string; upstreamId: string; connection: string; name: string; description: string; provider: string; family?: string;
  quotaGroup?: string; maxPixels: number; operations: string[]; tools: string[]; replaces: string[];
  fields: ParameterFields;
  /** Full source configuration, including values that control app-managed inputs. */
  configurationFields?: ParameterFields;
  parameterSource?: "declared" | "reference";
  markupEligible?: boolean;
  markup?: boolean;
  sourceMaxPixels: number; maxImages: number; chat: boolean; transparentBackground: boolean; unmetered: boolean;
}
export const bareId = (id: string) => id.replace(/@[^@/]+$/, "").replace(/^.*\//, "").toLowerCase();
export function catalogEntries(raw: unknown): CatalogEntry[] {
  return Object.entries(object(object(raw).models)).map(([id, value]) => ({ id,
    family: typeof object(value).editor_family === "string" ? object(value).editor_family as string : undefined }));
}
export function autoMatch(entries: CatalogEntry[], model: ModelIdentity) {
  return entries.find(e => [model.id, ...model.aliases].some(id => bareId(e.id) === bareId(id)) && (!e.family || e.family === model.family))?.id ?? null;
}
export function linkFor(routing: Routing, connection: string, model: ModelIdentity, entries: CatalogEntry[]) {
  if (!supportsModel(routing, connection, model)) return null;
  const records = routing.links[connection] ?? {};
  const bindings = profileFor(routing.connections[connection]).channelModels;
  if (bindings) {
    const binding = bindings.find(item => item.templateId === (model.templateId ?? model.id));
    if (!binding) return null;
    const id = binding.generate;
    const saved = records[model.id];
    if (saved) return saved.id === id ? { ...saved, manual: false } : null;
    return model.id === binding.templateId && entries.some(e => e.id === id) && !Object.values(records).some(link => link.id === id)
      ? { id, manual: false, on: true } : null;
  }
  if (records[model.id]) return records[model.id];
  const id = autoMatch(entries, model);
  return id && !Object.values(records).some(link => link.id === id) ? { id, manual: false, on: true } : null;
}
export function supportsModel(routing: Routing, connection: string, model: ModelIdentity) {
  const c = routing.connections[connection];
  if (!c) return false;
  const profile = profileFor(c);
  return profile.image && (profile.protocol === "novelai" ? model.family === "novelai"
    : profile.protocol === "seedream" ? model.family === "seedream"
    : profile.channelModels ? profile.channelModels.some(binding => binding.templateId === (model.templateId ?? model.id))
    : ["openai-images", "gemini-native"].includes(profile.protocol ?? "") ? model.family !== "novelai" : true);
}
export function supportsLayerDecomposition(model: CatalogModel) {
  if (!model.profileId || !model.operations.includes("edit") || !model.tools.includes("image-edit")) return false;
  if (model.layerDecomposition !== undefined) return model.layerDecomposition;
  const profile = profileFor(model.profileId);
  return profile.channelModels
    ? !!profile.channelModels.find(binding => binding.generate === model.upstreamId)?.decompose
    : !!profile.layerDecomposition;
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

function splitParameterFields(binding: ImageChannelModel, fields: ParameterFields): ParameterFields {
  const result: ParameterFields = {};
  for (const [key, split] of Object.entries(binding.splitFields ?? {})) {
    const regular = binding.fields[key];
    if (!regular) {
      result[key] = split;
      continue;
    }
    const enabled = fields[key];
    if (!enabled) continue;
    // Keep split-only tiers, such as 1.5K on Kie Pro, when the regular operation has a different schema.
    const options = split.options.filter(value => !regular.options.includes(value) || enabled.options.includes(value));
    if (!options.length) continue;
    result[key] = { ...split, options, default: options.includes(split.default) ? split.default : options[0] };
  }
  return result;
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
    if (!entry && (profile?.channelModels || findModel(bareId(upstreamId)))) continue;
    // Once the editable list is saved, managed image families require a configured mapping.
    // This prevents deleted entries resurfacing under a supplier's alias; other gateway tools remain available.
    if (!entry && routing.models && (["gpt", "gemini", "seedream"].includes(String(meta.editor_family)) ||
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
    const binding = profile?.channelModels?.find(item => item.generate === upstreamId);
    if (profile?.protocol === 'openai-images' || binding?.markup) {
      const declared = object(meta.image_capabilities).markup;
      if (typeof declared === 'boolean') fields.markup = { type: 'boolean', options: ['true', 'false'], default: String(declared) };
      else if (!fields.markup && entry?.parameters?.markup) fields.markup = { ...entry.parameters.markup, options: [...entry.parameters.markup.options] };
    }
    const overrides = modelParameterOverrides(routing.links[connection]?.[id] ?? {});
    const markupEligible = (profile?.protocol === 'openai-images' || !!binding?.markup) && (!!fields.markup || !!overrides.markup);
    if (profile?.channelModels) {
      // Fixed channels keep their wire schema when applying saved source preferences.
      for (const [key, field] of Object.entries(fields)) {
        const saved = overrides[key];
        if (saved === null) delete fields[key];
        else if (saved) fields[key] = channelParameterField(field, saved);
      }
    } else if (entry?.family !== "novelai") fields = applyParameterOverrides(fields, overrides);
    // Known defaults fill only compatible, enabled fields; source defaults keep precedence.
    if (entry && entry.family !== 'novelai') {
      const reference = imageModelFields(entry, profile?.protocol === 'openai-images' || entry.family === 'gpt' && profile?.protocol !== 'gemini-native');
      for (const [key, field] of Object.entries(fields)) {
        const fallback = reference[key]?.default;
        if (!field.default && fallback && acceptsParameter(field, fallback)) fields[key] = { ...field, default: fallback };
      }
    }
    const configurationFields = markupEligible || profile?.protocol === 'openai-images' ? fields : requestParameterFields(fields);
    fields = requestParameterFields(configurationFields);
    const native = profile?.protocol && profile.protocol !== "standard";
    const custom = routing.connections[connection]?.imageChannel;
    models.push({ ...(custom && profile ? { channelFormat: custom.format,
      layerDecomposition: profile.channelModels ? !!binding?.decompose : !!profile.layerDecomposition } : {}),
      ...(binding?.splitLimits ? { splitLimits: binding.splitLimits } : {}),
      ...(binding?.splitFields ? { splitFields: splitParameterFields(binding, fields) } : {}),
      id, templateId: entry?.templateId ?? entry?.id, upstreamId, connection, sourceRevision: routing.connections[connection]?.revision, ...(profile ? { profileId: profile.id } : {}), name: String(entry?.name || meta.name || id), description: String(meta.description || ""),
      provider, family: entry?.family ?? (typeof meta.editor_family === "string" ? meta.editor_family : undefined),
      quotaGroup: typeof meta.quota_group === "string" ? meta.quota_group : undefined,
      maxPixels: Number(meta.max_resolution) || 1_048_576, operations: strings(meta.operations), fields, configurationFields,
      parameterSource: object(meta.image_capabilities).source === "reference" ? "reference" : "declared",
      markupEligible,
      markup: configurationFields.markup?.default === 'true',
      replaces: strings(meta.replaces), tools: strings(meta.tools),
      sourceMaxPixels: Number(object(meta.generation_references).max_pixels) || 32_000_000,
      maxImages: Math.min(entry?.inputImages ?? 16, native ? Number(meta.max_context_images) || 16 : contextImages), chat: entry?.chat === true || !!native && meta.chat === true || !routing.models && meta.editor_family === "seedream",
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
    acceptsParameter(field, values[key] ?? "") ? values[key] : field.default]));
