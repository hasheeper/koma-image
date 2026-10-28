import type { DrawingForm } from "../../domain/drawing.ts";
import type { CatalogModel } from "../../domain/catalog.ts";
import { complexities, qualityPresets, negativePresets, naiModes, naiCapabilities } from "../../domain/nai.ts";
import { noiseSchedules, supportsNaiVariety } from "../../domain/nai-parameters.ts";

const numeric = (minimum: number, maximum?: number, integer = false) => ({ type: integer ? "integer" : "number", minimum, ...(maximum === undefined ? {} : { maximum }) });
const properties = {
  width: numeric(64, 2048, true), height: numeric(64, 2048, true), steps: numeric(1, 50, true),
  scale: numeric(0), cfgRescale: numeric(0, 1), batchCount: numeric(1, Number.MAX_SAFE_INTEGER, true),
  seed: { type: "string" }, model: { type: "string" }, sampler: { type: "string" },
  noiseSchedule: { type: "string", enum: [...noiseSchedules] },
  varietyPlus: { type: "boolean" },
  complexity: { type: "string", enum: [...complexities] }, naiMode: { type: "string", enum: [...naiModes] },
  qualityPreset: { type: "string", enum: [...qualityPresets] }, negativePreset: { type: "string", enum: [...negativePresets] }, transparentBg: { type: "boolean" },
};
export const parameterSchema = { type: "object", additionalProperties: false, minProperties: 1, properties };
export type ParameterKey = keyof typeof properties;
export type ParameterValues = Partial<Pick<DrawingForm, ParameterKey>>;
export interface ParameterStep { readonly kind: "params_patch"; readonly params: Readonly<ParameterValues> }
export function parseParameters(value: unknown): ParameterValues {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) throw new Error("params 需要非空参数对象");
  for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(properties, key)) throw new Error(`不能直接修改参数 ${key}`);
    const rule: { type: string; minimum?: number; maximum?: number; enum?: readonly unknown[] } = properties[key as ParameterKey];
    if (rule.type === "integer" ? !Number.isSafeInteger(item) : typeof item !== rule.type) throw new Error(`${key} 类型无效`);
    if (typeof item === "number" && (!Number.isFinite(item) || item < rule.minimum! || item > (rule.maximum ?? Infinity))) throw new Error(`${key} 超出范围`);
    if (rule.enum && !rule.enum.includes(item)) throw new Error(`${key} 选项无效`);
    if ((key === "width" || key === "height") && Number(item) % 64) throw new Error("尺寸须对齐 64px");
    if (key === "seed" && item !== "" && (!/^\d+$/.test(String(item)) || Number(item) > 4294967295)) throw new Error("Seed 须为空串或 uint32 字符串");
    if ((key === "model" || key === "sampler") && (typeof item !== "string" || !item.trim() || item.length > 256)) throw new Error(`${key} 无效`);
  }
  return structuredClone(value) as ParameterValues;
}
/** Check explicit values against the final model, without silently normalizing. */
export function parameterIssue(key: ParameterKey, form: DrawingForm, model: CatalogModel | null | undefined): string {
  const cap = naiCapabilities(form.model), value = form[key];
  if (!model) return "当前模型不可用";
  if (key === "transparentBg" && value && !model.transparentBackground) return "当前模型不支持透明底";
  if (key === "complexity" && value !== "none" && !cap.v5) return "当前模型不支持 Complexity";
  if (key === "naiMode" && !cap.supported) return "当前模型不支持 Anime／Furry 模式";
  if (key === "qualityPreset" && !cap.quality.includes(form.qualityPreset)) return "当前模型不支持此质量预设";
  if (key === "negativePreset" && !cap.negative.includes(form.negativePreset)) return "当前模型不支持此负向预设";
  if (key === "cfgRescale" && (!cap.supported || cap.medium) && value !== 0) return "当前模型不支持 Guidance Rescale";
  if (key === "steps" && cap.medium && value !== 14) return "Medium 固定 14 步";
  if (key === "noiseSchedule" && value !== "auto" && (model.profileId !== "nai-official-v1" || !cap.supported || cap.v5)) return "当前模型不提供可调噪声调度";
  if (key === "varietyPlus" && value && !supportsNaiVariety(model)) return "Variety+ 仅支持 NovelAI 官方 V4.5";
  return "";
}
