import { object } from "./value.ts";
export type ReferenceKind = "vibe" | "precise";
export type PreciseType = "character" | "style" | "character&style";
export type NaiReference = { id: string; assetId: string; on: boolean; strength: number; information: number; fidelity: number; type: PreciseType }
export type NaiReferences = { active: ReferenceKind | null; normalize: boolean; vibe: NaiReference[]; precise: NaiReference[] }
export interface ReferenceAsset { id: string; blob: Blob | null; thumbnail: Blob | null; width: number; height: number }
export interface VibeEncoding { id: string; assetId: string; model: string; information: number; data: string }
export const emptyReferences = (): NaiReferences => ({ active: null, normalize: false, vibe: [], precise: [] });
const unit = (v: unknown, fallback: number) => typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
export function readReferences(value: unknown): NaiReferences {
  const raw = object(value);
  const rows = (kind: ReferenceKind) => {
    const seen = new Set<string>();
    return (Array.isArray(raw[kind]) ? raw[kind] : []).flatMap((item): NaiReference[] => {
      const r = object(item);
      if (typeof r.id !== "string" || !r.id || seen.has(r.id) || typeof r.assetId !== "string" || !/^[a-f0-9]{64}$/.test(r.assetId)) return [];
      seen.add(r.id);
      return [{ id: r.id, assetId: r.assetId, on: r.on !== false, strength: unit(r.strength, kind === "precise" ? 1 : .6), information: unit(r.information, 1), fidelity: unit(r.fidelity, 1), type: r.type === "style" || r.type === "character" ? r.type : "character&style" }];
    });
  };
  return { active: raw.active === "vibe" || raw.active === "precise" ? raw.active : null, normalize: raw.normalize === true, vibe: rows("vibe"), precise: rows("precise") };
}
export const referenceModel = (model: string) => /^nai-diffusion-4-5-(full|curated)(?:@local)?$/.test(model);
export const activeReferences = (value: NaiReferences) => value.active ? value[value.active].filter(r => r.on) : [];
export const encodingKey = (model: string, assetId: string, information: number) => `${model.replace(/@local$/, "")}:${assetId}:${information}`;
export const referenceName = (kind: ReferenceKind) => kind === "vibe" ? "Vibe Transfer" : "Precise Reference";
export function referencePlan(value: NaiReferences) {
  const items = activeReferences(value);
  if (!value.active || !items.length) return undefined;
  if (items.length > 16) throw new Error(`${referenceName(value.active)} 最多使用 16 张图片`);
  return { kind: value.active, normalize: value.normalize, items: structuredClone(items) };
}
export type ReferencePlan = NonNullable<ReturnType<typeof referencePlan>>;
export interface PreparedReferences { kind: ReferenceKind; images: string[]; strengths: number[]; information: number[]; fidelities: number[]; types: PreciseType[] }
export function referenceSurcharge(plan?: ReferencePlan) {
  return !plan ? 0 : plan.kind === "precise" ? plan.items.length * 5 : Math.max(0, plan.items.length - 4) * 2;
}

export const encodingGroup = (model: string) => model.replace(/@local$/, "").endsWith("curated") ? "v4-5curated" : "v4-5full";
export function referenceStrengths(plan: ReferencePlan) {
  const values = plan.items.map(r => r.strength), sum = values.reduce((a, b) => a + Math.abs(b), 0);
  return plan.kind === "vibe" && plan.normalize && values.length > 1 && sum > 1 ? values.map(v => v / sum) : values;
}
export function referenceWire(prepared: PreparedReferences) {
  const n = prepared.images.length;
  if (!n || n > 16 || prepared.strengths.length !== n || prepared.images.some(v => !v)) throw new Error("参考图片未准备完成");
  if (prepared.strengths.some(v=>!Number.isFinite(v)||v<0||v>1) || prepared.kind === "precise" && (prepared.information.length!==n || prepared.fidelities.length!==n || prepared.types.length!==n || [...prepared.information,...prepared.fidelities].some(v=>!Number.isFinite(v)||v<0||v>1) || prepared.types.some(v=>!["character","style","character&style"].includes(v)))) throw new Error("参考参数不完整");
  return prepared.kind === "vibe" ? {
    reference_image_multiple: prepared.images, reference_strength_multiple: prepared.strengths,
  } : {
    director_reference_images: prepared.images,
    director_reference_descriptions: prepared.types.map(type => ({ caption: { base_caption: type, char_captions: [] }, legacy_uc: false })),
    director_reference_information_extracted: prepared.information,
    director_reference_strength_values: prepared.strengths,
    director_reference_secondary_strength_values: prepared.fidelities.map(v => 1 - v),
  };
}

export function referenceSummary(value: unknown) {
  const config = readReferences(value);
  return { active: config.active, normalize:config.normalize, vibe:config.vibe.map(({on,strength,information})=>({on,strength,information})), precise:config.precise.map(({on,strength,fidelity,type})=>({on,strength,fidelity,type})) };
}
