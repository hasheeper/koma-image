import { object } from "./value.ts";
export type ReferenceKind = "vibe" | "precise";
export type PreciseType = "character" | "style" | "character&style" | "costume";
export type NaiReference = { id: string; assetId: string; on: boolean; strength: number; information: number; fidelity: number; type: PreciseType; preferSameOutfit?: boolean }
export type NaiReferences = { active: ReferenceKind | null; normalize: boolean; vibe: NaiReference[]; precise: NaiReference[] }
export interface PngVibes { model: string; normalize: boolean; items: { encoding: string; information: number; strength: number }[] }
export interface ReferenceAsset { id: string; blob: Blob | null; thumbnail: Blob | null; width: number; height: number }
export interface VibeEncoding { id: string; assetId: string; model: string; information: number; data: string }
export const emptyReferences = (): NaiReferences => ({ active: null, normalize: false, vibe: [], precise: [] });
const bounded = (v: unknown, fallback: number, max = 1) => typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : fallback;
export const inReferenceRange = (v: unknown, max = 1): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
export const preciseType = (v: unknown, costume: boolean): v is PreciseType =>
  v === "character" || v === "character&style" || v === "style" || costume && v === "costume";
export function readReferences(value: unknown): NaiReferences {
  const raw = object(value);
  const rows = (kind: ReferenceKind) => {
    const seen = new Set<string>();
    return (Array.isArray(raw[kind]) ? raw[kind] : []).flatMap((item): NaiReference[] => {
      const r = object(item);
      if (typeof r.id !== "string" || !r.id || seen.has(r.id) || typeof r.assetId !== "string" || !/^[a-f0-9]{64}$/.test(r.assetId)) return [];
      seen.add(r.id);
      const precise = kind === "precise";
      return [{ id: r.id, assetId: r.assetId, on: r.on !== false, strength: bounded(r.strength, precise ? 1 : .6, precise ? 5 : 1),
        information: bounded(r.information, 1), fidelity: bounded(r.fidelity, 1), type: preciseType(r.type, precise) ? r.type : "character&style",
        ...(precise && typeof r.preferSameOutfit === "boolean" ? { preferSameOutfit: r.preferSameOutfit } : {}) }];
    });
  };
  return { active: raw.active === "vibe" || raw.active === "precise" ? raw.active : null, normalize: raw.normalize === true, vibe: rows("vibe"), precise: rows("precise") };
}
export const vibeModel = (model: string) => /^nai-diffusion-4-5-(full|curated)(?:@local)?$/.test(model);
export const v5PreciseModel = (model: string) => /^nai-diffusion-5-(full|full-medium|curated)(?:@local)?$/.test(model);
export function referenceSource(model: {id:string; upstreamId:string; profileId?:string}) {
  return model.profileId === "nai-official-v1" && (vibeModel(model.id) || v5PreciseModel(model.id)) &&
    model.upstreamId?.replace(/@local$/, "") === model.id.replace(/@local$/, "");
}
export const referenceOperation = (model: string, kind: ReferenceKind, tool?: string) =>
  vibeModel(model) && (!tool || tool === "img2img" || tool === "inpaint" && kind === "precise") ||
  v5PreciseModel(model) && kind === "precise" && (!tool || tool === "img2img");
export const referenceKinds = (model: string, tool?: string) => (["vibe", "precise"] as const).filter(kind => referenceOperation(model, kind, tool));
export const sameOutfit = (r: Pick<NaiReference, "type" | "preferSameOutfit">) => r.preferSameOutfit ?? (r.type === "character&style");
export const needsV5Precise = (r: Pick<NaiReference, "type" | "strength">) => r.type === "costume" || r.strength > 1;
export const activeReferences = (value: NaiReferences) => value.active ? value[value.active].filter(r => r.on) : [];
export function referenceProblem(value: NaiReferences, model: string, kinds: readonly ReferenceKind[], tool?: string) {
  const rows = activeReferences(value);
  if (!value.active || !rows.length) return "";
  if (!kinds.includes(value.active)) return tool === "inpaint"
    ? `局部重绘暂不支持 ${referenceName(value.active)}，配置已保留` : "当前模型或来源不支持已启用的参考，配置已保留";
  if (value.active === "precise" && vibeModel(model)) {
    const index = value.precise.findIndex(r => r.on && needsV5Precise(r));
    if (index >= 0) return `第 ${index + 1} 张参考使用 V5 衣装类型或超过 1 的强度，请调整或停用此图`;
  }
  return "";
}
export const encodingKey = (model: string, assetId: string, information: number) => `${model.replace(/@local$/, "")}:${assetId}:${information}`;
export const referenceName = (kind: ReferenceKind) => kind === "vibe" ? "Vibe Transfer" : "Precise Reference";
export function referencePlan(value: NaiReferences) {
  const items = activeReferences(value);
  if (!value.active || !items.length) return undefined;
  if (items.length > 16) throw new Error(`${referenceName(value.active)} 最多使用 16 张图片`);
  return { kind: value.active, normalize: value.normalize, items: structuredClone(items) };
}
export type ReferencePlan = NonNullable<ReturnType<typeof referencePlan>>;
export interface PreparedReferences { kind: ReferenceKind; images: string[]; strengths: number[]; information: number[]; fidelities: number[]; types: PreciseType[]; preferSameOutfits?: boolean[] }
export function supportsReferencePlan(model: string, plan: ReferencePlan, tool?: string) {
  if (!referenceOperation(model, plan.kind, tool) || !plan.items.length || plan.items.length > 16) return false;
  const v5 = v5PreciseModel(model);
  return plan.items.every(r => inReferenceRange(r.strength, v5 ? 5 : 1) && inReferenceRange(r.information) &&
    (plan.kind === "vibe" || preciseType(r.type, v5) && inReferenceRange(r.fidelity)));
}
export function referenceSurcharge(refs?: ReferencePlan | PreparedReferences) {
  if (!refs) return 0;
  const count = "items" in refs ? refs.items.length : refs.images.length;
  return refs.kind === "precise" ? count * 5 : Math.max(0, count - 4) * 2;
}

export const encodingGroup = (model: string) => model.replace(/@local$/, "").endsWith("curated") ? "v4-5curated" : "v4-5full";
export function referenceStrengths(plan: ReferencePlan) {
  const values = plan.items.map(r => r.strength), sum = values.reduce((a, b) => a + Math.abs(b), 0);
  return plan.kind === "vibe" && plan.normalize && values.length > 1 && sum > 1 ? values.map(v => v / sum) : values;
}
export function referenceWire(prepared: PreparedReferences, model: string) {
  const n = prepared.images.length;
  if (!referenceOperation(model, prepared.kind)) throw new Error("当前型号不支持参考生成");
  if (!n || n > 16 || prepared.strengths.length !== n || prepared.images.some(v => !v)) throw new Error("参考图片未准备完成");
  const v5 = v5PreciseModel(model);
  if (prepared.strengths.some(v => !inReferenceRange(v, v5 ? 5 : 1))) throw new Error("参考强度超出型号范围");
  if (prepared.kind === "vibe") return {
    reference_image_multiple: prepared.images, reference_strength_multiple: prepared.strengths,
  };
  const { information, fidelities, types, preferSameOutfits } = prepared;
  if (information.length !== n || fidelities.length !== n || types.length !== n ||
      [...information, ...fidelities].some(v => !inReferenceRange(v)) || types.some(v => !preciseType(v, v5)) ||
      preferSameOutfits && (preferSameOutfits.length !== n || preferSameOutfits.some(v => typeof v !== "boolean"))) throw new Error("参考参数不完整");
  return {
    director_reference_images: prepared.images,
    director_reference_descriptions: types.map((type, i) => {
      const outfit = sameOutfit({type, preferSameOutfit: preferSameOutfits?.[i]});
      const caption = v5 && type === "character" && outfit ? "character_mainoutfit" :
        v5 && type === "character&style" && !outfit ? "character&style_anyoutfit" : type;
      return { caption: { base_caption: caption, char_captions: [] }, legacy_uc: false };
    }),
    director_reference_information_extracted: prepared.information,
    director_reference_strength_values: prepared.strengths,
    director_reference_secondary_strength_values: fidelities.map(v => v5 ? 0 : 1 - v),
  };
}

export function referenceSummary(value: unknown) {
  const config = readReferences(value);
  return { active: config.active, normalize:config.normalize, vibe:config.vibe.map(({on,strength,information})=>({on,strength,information})), precise:config.precise.map(({on,strength,fidelity,type,preferSameOutfit})=>({on,strength,fidelity,type,...(preferSameOutfit !== undefined ? {preferSameOutfit} : {})})) };
}
