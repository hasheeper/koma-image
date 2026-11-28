import { editablePresets, findModel } from '../domain/models.ts';
import type { ParameterFields } from '../domain/model-parameters.ts';
import { kieSeedreamFields, kieSeedreamModels, SEEDREAM_55, SEEDREAM_FLASH, SEEDREAM_LITE, SEEDREAM_PRO, kieSeedreamRatios, seedreamLimits } from '../domain/seedream.ts';

export interface SplitLimits {
  auto: boolean;
  max?: number;
  textRecognition?: boolean;
}
export function acceptsSplitOptions(limits: SplitLimits, options: { maxImages?: number; textRecognition?: boolean }) {
  if (options.textRecognition && !limits.textRecognition) return false;
  const n = options.maxImages;
  return n === undefined ? limits.auto : limits.max !== undefined && Number.isInteger(n) && n >= 2 && n <= limits.max;
}

/** One logical model can use different upstream IDs for each image operation. */
export interface ImageChannelModel {
  templateId: string;
  generate: string;
  edit: string;
  decompose?: string;
  splitLimits?: SplitLimits;
  splitFields?: ParameterFields;
  markup?: boolean;
  maxPromptLength?: number;
  backgroundOnly1K?: boolean;
  maxImages: number;
  maxPixels?: number;
  editInput: string;
  fields: ParameterFields;
  optionError?(options: Record<string, unknown>): string | undefined;
}

const gpt = 'gpt-image-2', banana = 'gemini-3.1-flash-image';
const tiers = { label: '分辨率', options: ['1K', '2K', '4K'], default: '1K' };
const commonRatios = ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9'];
const ratio = (extra: string[]) => ({ label: '比例', options: ['auto', ...commonRatios, ...extra], default: 'auto' });
function kieGptOptionError(options: Record<string, unknown>) {
  const resolution = options.image_size;
  if (resolution !== '2K' && resolution !== '4K') return;
  if (options.background && options.background !== 'auto') return '此来源的 GPT Image 2 仅 1K 支持指定背景，请使用自动背景或 1K';
  const excluded = resolution === '2K' ? ['5:4', '4:5', '3:1', '1:3', '9:21'] : ['3:1', '1:3', '9:21'];
  if (excluded.includes(String(options.aspect_ratio))) return `此来源的 GPT Image 2 在 ${resolution} 不支持该比例`;
}

const formats = { label: '格式', options: ['png', 'jpeg'], default: 'png' };
const bananaFormats = { label: '格式', options: ['jpg', 'png'], default: 'jpg' };
const bananaRatio = ratio(['1:4', '4:1', '1:8', '8:1']);
const sdRatio = { label: '比例', options: kieSeedreamRatios, default: '1:1' };
const splitFields = { size: { label: '拆层尺寸', options: ['auto', '1K', '1.5K', '2K'], default: 'auto' }, output_format: formats };
const gpt25Ratios = ['27:16', '16:27', '9:8', '8:9'];
const gpt25AspectRatio = {
  label: '比例',
  options: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', ...gpt25Ratios],
  default: 'auto',
};
const gptRatios = ratio(['2:1', '1:2', '3:1', '1:3', '9:21']);
export const outputCompressionField: ParameterFields[string] = {
  label: 'JPEG / WebP 压缩', type: 'number', min: 0, max: 100, options: [], default: '', allowCustom: true,
};
function compressionError(options: Record<string, unknown>) {
  const value = options.output_compression;
  if (value === undefined || value === '') return;
  if (options.output_format !== 'jpeg' && options.output_format !== 'webp') return '输出压缩仅支持 JPEG 或 WebP';
  if (!Number.isInteger(Number(value))) return '输出压缩须为整数';
}

function kieGpt25OptionError(options: Record<string, unknown>) {
  if (options.image_size !== '2K' && options.image_size !== '4K') return;
  if (options.background && options.background !== 'auto') return '此来源的 GPT Image 2.5 仅 1K 支持指定背景';
  if (gpt25Ratios.includes(String(options.aspect_ratio))) return '此比例仅支持 1K 分辨率';
}
function kieGptModels(variant: string): ImageChannelModel[] {
  const v25 = 'gpt-image-2-5-' + variant;
  const v26 = 'gpt-image-2-6/' + variant;
  return [
    {
      templateId: 'gpt-image-2.5-' + variant,
      generate: v25 + '-text-to-image', edit: v25 + '-image-to-image',
      maxImages: 16, editInput: 'input_urls',
      backgroundOnly1K: true, optionError: kieGpt25OptionError,
      fields: {
        aspect_ratio: gpt25AspectRatio, image_size: tiers,
        background: { ...kieSeedreamFields.background, label: '背景（1K）' },
      },
    },
    {
      templateId: 'gpt-image-2.6-' + variant,
      generate: v26 + '-text-to-image', edit: v26 + '-image-to-image',
      maxImages: 16, editInput: 'input_urls', maxPromptLength: 32000, markup: true,
      optionError(options) {
        if (options.background === 'transparent' && options.output_format === 'jpeg') return '透明背景需要 PNG 或 WebP';
        return compressionError(options);
      },
      fields: {
        aspect_ratio: gptRatios, image_size: tiers, background: kieSeedreamFields.background,
        quality: { label: '质量', options: ['low', 'medium', 'high', 'xhigh', 'max', 'auto'], default: 'medium' },
        output_format: { ...formats, options: ['png', 'jpeg', 'webp'] },
        output_compression: outputCompressionField,
        complexity: { label: '复杂度', options: ['low', 'medium', 'high'], default: 'high' },
      },
    },
  ];
}

function kieSeedream50(templateId: string, upstream: string, size: ParameterFields[string], split: boolean): ImageChannelModel {
  return {
    templateId, generate: upstream + '-text-to-image', edit: upstream + '-image-to-image', editInput: 'image_urls',
    maxImages: templateId === SEEDREAM_LITE ? 14 : 10,
    ...(split ? { decompose: upstream + '-layer-decomposition', splitLimits: { auto: true }, splitFields } : {}),
    fields: { size, aspect_ratio: sdRatio, output_format: formats, nsfw_checker: kieSeedreamFields.nsfw_checker },
  };
}

export const kieImageModels: ImageChannelModel[] = [
  { templateId: SEEDREAM_55, ...kieSeedreamModels, editInput: 'image_urls', maxImages: 10, maxPixels: 8_294_400,
    splitLimits: { auto: true, max: 100, textRecognition: true }, splitFields: { ...splitFields, nsfw_checker: kieSeedreamFields.nsfw_checker },
    fields: kieSeedreamFields },
  { templateId: gpt, generate: 'gpt-image-2-text-to-image', edit: 'gpt-image-2-image-to-image', editInput: 'input_urls', maxImages: 16, backgroundOnly1K: true, optionError: kieGptOptionError,
    fields: { aspect_ratio: gptRatios, image_size: tiers, background: { ...kieSeedreamFields.background, label: '背景（1K）' } } },
  { templateId: banana, generate: 'nano-banana-2', edit: 'nano-banana-2', editInput: 'image_input', maxImages: 10,
    fields: { aspect_ratio: bananaRatio, image_size: tiers, output_format: bananaFormats } },
  kieSeedream50(SEEDREAM_LITE, 'seedream/5-lite', { label: '尺寸', options: ['2K', '3K', '4K'], default: '2K' }, false),
  kieSeedream50(SEEDREAM_PRO, 'seedream/5-pro', { label: '尺寸', options: ['1K', '2K'], default: '1K' }, true),
  kieSeedream50(SEEDREAM_FLASH, 'seedream/5-flash', { label: '尺寸', options: ['1K', '1.5K', '2K'], default: '1K' }, true),
  { templateId: 'gpt-image-1.5', generate: 'gpt-image/1.5-text-to-image', edit: 'gpt-image/1.5-image-to-image', editInput: 'input_urls', maxImages: 16,
    fields: { aspect_ratio: { label: '比例', options: ['1:1', '2:3', '3:2'], default: '1:1' }, quality: { label: '质量', options: ['medium', 'high'], default: 'medium' } } },
  ...kieGptModels('sunburst'), ...kieGptModels('flare'),
  { templateId: 'gemini-2.5-flash-image', generate: 'google/nano-banana', edit: 'google/nano-banana-edit', editInput: 'image_urls', maxImages: 10,
    fields: { aspect_ratio: { ...ratio([]), default: '1:1' }, output_format: formats } },
  { templateId: 'gemini-3-pro-image', generate: 'nano-banana-pro', edit: 'nano-banana-pro', editInput: 'image_input', maxImages: 8,
    fields: { aspect_ratio: { ...ratio([]), default: '1:1' }, image_size: tiers, output_format: bananaFormats } },
  { templateId: 'gemini-nano-banana-2.1', generate: 'nano-banana-2-1', edit: 'nano-banana-2-1', editInput: 'image_input', maxImages: 10,
    fields: { aspect_ratio: bananaRatio, image_size: tiers, output_format: bananaFormats } },
  { templateId: 'gemini-3.1-flash-lite-image', generate: 'nano-banana-2-lite', edit: 'nano-banana-2-lite', editInput: 'image_urls', maxImages: 10,
    fields: { aspect_ratio: bananaRatio } },
];

// A directory is matched against the application's editable image templates. It controls
// availability and enums; model aliases on a connection can replace any of these IDs.
const routerSeedreamIds: Record<string, string> = {
  [SEEDREAM_LITE]: 'seedream-5-0-lite', [SEEDREAM_PRO]: 'seedream-5-0-pro', [SEEDREAM_FLASH]: 'seedream-5-0-flash', [SEEDREAM_55]: 'seedream-5-5',
};
export const initialChannelTemplates = new Set([gpt, banana, SEEDREAM_55]);
export const routerImageModels: ImageChannelModel[] = [
  ...[gpt, banana, SEEDREAM_55].map(id => findModel(id)!),
  ...editablePresets.filter(m => !initialChannelTemplates.has(m.id)),
].map(m => {
  const namespace = m.family === 'gpt' ? 'openai' : 'google';
  const id = m.family === 'seedream' ? 'bytedance-seed/' + routerSeedreamIds[m.id] : namespace + '/' + m.id;
  return {
    templateId: m.id, generate: id, edit: id, editInput: 'input_references',
    maxImages: m.inputImages ?? 16, fields: {}, optionError: compressionError,
    ...(m.id === SEEDREAM_55 ? { decompose: id, splitLimits: { auto: false, max: 16 } } : {}),
    ...(m.id === 'gpt-image-2.6-sunburst' || m.id === 'gpt-image-2.6-flare' ? { markup: true } : {}),
  };
});

export function channelOperationEntries(model: ImageChannelModel): string[][] {
  const entries = [['文生图', model.generate], ['图生图', model.edit]];
  if (model.decompose) entries.push(['拆层', model.decompose]);
  return entries;
}

/** Raw catalog entries use the same operation and limit declarations as execution. */
export function channelCatalogEntry(binding: ImageChannelModel, fields = binding.fields, maxImages = binding.maxImages, source: 'reference' | 'declared' = 'reference') {
  const template = findModel(binding.templateId)!;
  return {
    name: template.name, provider: template.provider, editor_family: template.family,
    operations: ['generate', 'edit'], tools: ['image-edit'], chat: true,
    max_context_images: maxImages,
    ...(template.family === 'seedream' ? { max_resolution: binding.maxPixels ?? seedreamLimits(binding.templateId)?.maxPixels ?? 4_624_220 } : {}),
    image_capabilities: { fields, source },
  };
}
