import type { ImagePayload } from "../gateway/routes.ts";
import type { Quote } from "./quote.ts";
import { object } from "./value.ts";
import { imageDimensions } from "../native/image-dimensions.ts";

export const directorTools = [
  { id: "bg-removal", name: "去背景", icon: "i-dt-background" },
  { id: "lineart", name: "线稿", icon: "i-dt-lineart" },
  { id: "sketch", name: "草图", icon: "i-dt-sketch" },
  { id: "colorize", name: "上色", icon: "i-dt-colorize" },
  { id: "emotion", name: "表情", icon: "i-dt-emotion" },
  { id: "declutter", name: "去杂物", icon: "i-dt-declutter" },
] as const;
export type DirectorTool = typeof directorTools[number]["id"];
export const directorEmotions = [
  ["neutral", "平静"], ["happy", "开心"], ["sad", "难过"], ["angry", "生气"],
  ["scared", "害怕"], ["surprised", "惊讶"], ["tired", "疲惫"], ["excited", "兴奋"],
  ["nervous", "紧张"], ["thinking", "思考"], ["confused", "困惑"], ["shy", "害羞"],
  ["disgusted", "厌恶"], ["smug", "得意"], ["bored", "无聊"], ["laughing", "大笑"],
  ["irritated", "不悦"], ["aroused", "情动"], ["embarrassed", "窘迫"], ["worried", "担忧"],
  ["love", "爱慕"], ["determined", "坚定"], ["hurt", "受伤"], ["playful", "俏皮"],
] as const;
export type DirectorEmotion = typeof directorEmotions[number][0];
// The upstream defry index increases as Emotion becomes weaker.
export const directorLevels = ["标准", "稍弱", "较弱", "更弱", "很弱", "最弱"] as const;
export const directorVariants = ["masked", "generated", "blend"] as const;
export type DirectorVariant = typeof directorVariants[number];
export const directorVariantNames = { masked: "抠图", generated: "重建", blend: "混合" } as const;
export interface DirectorSettings {
  tool: DirectorTool;
  colorize: { prompt: string; defry: number };
  emotion: { prompt: string; emotion: DirectorEmotion; defry: number };
}
export const emptyDirectorSettings = (): DirectorSettings => ({
  tool: "bg-removal", colorize: { prompt: "", defry: 0 },
  emotion: { prompt: "", emotion: "neutral", defry: 0 },
});
export const directorName = (id: unknown) => directorTools.find(t => t.id === id)?.name ?? "Director Tools";
export const isDirectorTool = (id: unknown): id is DirectorTool => directorTools.some(t => t.id === id);

/** Official client preparation: preserve aspect, cap at 3MP minus rounding
 * allowance, and bring small images to approximately 1MP. No 64px snapping. */
export function directorSize(size: { width: number; height: number }) {
  let { width, height } = size;
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || width * height > 40_000_000)
    throw new Error("Director Tools 图片尺寸无效");
  if (width * height > 3_143_728) {
    const scale = Math.sqrt(3_143_728 / (width * height));
    width = Math.floor(width * scale); height = Math.floor(height * scale);
  }
  if (width * height < 1_011_712) {
    const scale = Math.sqrt(1_048_576 / (width * height));
    width = Math.floor(width * scale); height = Math.floor(height * scale);
  }
  if (!width || !height || Math.max(width, height) > 16384) throw new Error("图片比例过于极端，请先裁切后使用 Director Tools");
  return { width, height };
}

/** Exact augment-image fields. Ordinary model, mask, references, seed, CFG,
 * sampling, and ceiling fields never leak into this separate protocol. */
export function directorRequest(payload: ImagePayload) {
  if (payload.tool !== "director" || !isDirectorTool(payload.directorTool)) throw new Error("Director Tools 类型无效");
  const encoded = typeof payload.init_image === "string" ? /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(payload.init_image) : null;
  if (!encoded || encoded[1].length * .75 > 32 * 1024 * 1024) throw new Error("Director Tools 底图须为有效 PNG");
  if (payload.mask_image || payload.referencePlan || payload.preparedReferences || payload.enhance || payload.inpaintFocus ||
    payload.additional_images !== undefined && (!Array.isArray(payload.additional_images) || payload.additional_images.length))
    throw new Error("Director Tools 仅处理一张完整图片");
  const size = imageDimensions(String(payload.init_image));
  if (size.width !== payload.width || size.height !== payload.height || size.width * size.height > 3_145_728 || Math.min(size.width, size.height) < 1)
    throw new Error("Director Tools 请求尺寸与底图不一致");
  const body: { req_type: DirectorTool; image: string; width: number; height: number; prompt?: string; defry?: number } = {
    req_type: payload.directorTool, image: encoded[1], ...size,
  };
  if (body.req_type === "colorize" || body.req_type === "emotion") {
    if (typeof payload.prompt !== "string" || payload.prompt.length > 24000 || typeof payload.defry !== "number" || !Number.isInteger(payload.defry) || payload.defry < 0 || payload.defry > 5)
      throw new Error("Director Tools 提示词或强度无效");
    if (body.req_type === "emotion" && !directorEmotions.some(([v]) => v === payload.emotion)) throw new Error("请选择有效表情");
    body.prompt = body.req_type === "emotion" ? `${payload.emotion};;${payload.prompt}` : payload.prompt;
    body.defry = payload.defry;
  }
  return body;
}

/** V3 / 28-step pricing used by the official tool client; Remove BG is
 * always three paid outputs plus 5 Anlas. Never use V5 usage percentages. */
export function directorCost(payload: ImagePayload, account: unknown): Quote | null {
  if (!isDirectorTool(payload.directorTool)) return null;
  const width = Number(payload.width), height = Number(payload.height), area = width * height;
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || area > 3145728) return null;
  const base = Math.max(2, Math.ceil(2.951823174884865e-6 * area + 5.753298233447344e-7 * area * 28));
  if (payload.directorTool === "bg-removal") return { cost: base * 3 + 5, unit: "Anlas", estimated: true, encodingCost: 0 };
  const s = object(account);
  const privileged = typeof s.accountType === "number" && [1, 2, 3, 4].includes(s.accountType);
  const active = privileged ? true : typeof s.expiresAt === "number" ? s.expiresAt > Date.now() / 1000 && Number(s.tier) > 0 : s.active;
  if (area <= 1048576 && active !== false && (active !== true || typeof s.tier !== "number")) return null;
  return { cost: area <= 1048576 && active === true && Number(s.tier) >= 3 ? 0 : base, unit: "Anlas", estimated: true, encodingCost: 0 };
}
