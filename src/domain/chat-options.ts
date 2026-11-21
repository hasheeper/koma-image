/** Option keys a new conversation may take from an ASK draft; other controls stay the user's choice. */
export const chatSizeKeys: readonly string[] = ["size", "aspect_ratio", "image_size"];
/** Shown to ASK so it can remind the user, never written by a draft. */
export const chatReadOnlyKeys: readonly string[] = ["quality", "complexity", "output_format", "watermark"];

/** Parameter panel names and values, shared by CHAT and ASK draft cards. */
export const chatOptionNames: Readonly<Record<string, string>> = {
  quality: "质量",
  complexity: "复杂度",
  size: "画幅",
  aspect_ratio: "比例",
  image_size: "分辨率",
  output_format: "格式",
  watermark: "水印",
};
const values: Readonly<Record<string, string>> = {
  auto: "自动",
  low: "草稿",
  medium: "标准",
  high: "高质量",
  xhigh: "超高",
  max: "最高",
  "1024x1024": "方形",
  "1536x1024": "横向",
  "1024x1536": "竖向",
};
export const chatOptionLabel = (v: string, key?: string) =>
  key === 'complexity' ? ({ low: '低', medium: '中', high: '高' }[v] || v) : values[v] || v.toUpperCase();
import { normalizeOptions } from './catalog.ts';
import type { CatalogModel } from './catalog.ts';
import type { ConversationTurn, ConversationVersion } from '../storage/records.ts';
import { object } from './value.ts';


export const chatVersionSettings = (turn: ConversationTurn, version?: ConversationVersion) => version?.settings ?? turn.settings;

export function chatVersionModelName(turn: ConversationTurn, version: ConversationVersion, models: readonly CatalogModel[]) {
  const model = String(chatVersionSettings(turn, version).model ?? '');
  return version.settings?.modelName || models.find(item => item.id === model)?.name || model || '未知模型';
}

export function chatRerunPlan(turn: ConversationTurn, version: ConversationVersion, model: CatalogModel, overrides?: Record<string, string>) {
  const baseline = chatVersionSettings(turn, version);
  const previous = Object.fromEntries(Object.entries(object(baseline.options)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const options = normalizeOptions(model, { ...previous, ...overrides });
  const count = turn.snapshot.imageIds.length;
  const issue = version.status !== 'done' ? '请选择已完成的版本'
    : !model.chat || !model.operations.includes(count ? 'edit' : 'generate') ? '该模型不支持这次生成方式'
    : count > model.maxImages ? `原请求含 ${count} 张图，该模型最多支持 ${model.maxImages} 张`
    : turn.snapshot.annotation?.markup && !model.markupEligible ? '该模型不支持原请求的原生标注' : '';
  return { issue, settings: { model: model.id, modelName: model.name, options } };
}
