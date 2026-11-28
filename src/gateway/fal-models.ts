import { findModel } from '../domain/models.ts';
import type { ParameterFields } from '../domain/model-parameters.ts';
import { SEEDREAM_55, SEEDREAM_LITE, SEEDREAM_PRO, SEEDREAM_FLASH, safetyCheckerField } from '../domain/seedream.ts';
import { outputCompressionField, type ImageChannelModel } from './image-channel-models.ts';

// A fal endpoint ID contains path segments (e.g. bytedance/seedream/v5.5/layerize).
export function validFalModelPath(id: string): boolean {
  return id.length <= 512 && id.split('/').every(part => /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(part));
}

const field = (label: string, options: string[], value: string) => ({ label, options, default: value });
const format = field('格式', ['png', 'jpeg', 'webp'], 'png');
const background = field('背景', ['auto', 'opaque', 'transparent'], 'auto');
const sdFormat = field('格式', ['png', 'jpeg'], 'png');
const sdTiers = ['1K', '1.5K', '2K'];
const shapePresets = ['square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9'];
const ratios = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'];
const wideRatios = ['auto', ...ratios, '4:1', '1:4', '8:1', '1:8'];
const resolutions = ['1K', '2K', '4K'];

function optionError(options: Record<string, unknown>) {
  if (options.background === 'transparent' && options.output_format === 'jpeg') return '透明背景需要 PNG 或 WebP';
  const value = options.output_compression;
  if (value === undefined || value === '') return;
  if (options.output_format !== 'jpeg' && options.output_format !== 'webp') return '输出压缩仅适用于 JPEG 或 WebP';
  if (!Number.isInteger(Number(value))) return '输出压缩须为整数';
}

function seedream(templateId: string, base: string): ImageChannelModel {
  const lite = templateId === SEEDREAM_LITE, v55 = templateId === SEEDREAM_55;
  const tiers = lite ? ['2K', '3K', '4K'] : sdTiers;
  const fields: ParameterFields = {
    size: field('尺寸', [...tiers, ...shapePresets], '2K'), output_format: sdFormat,
    watermark: { type: 'boolean', options: ['false', 'true'], default: 'false', label: '水印' },
    nsfw_checker: safetyCheckerField,
  };
  if (v55) fields.background = background;
  return {
    templateId, generate: base + '/text-to-image', edit: base + '/edit', maxImages: 10, editInput: 'image_urls', fields,
    optionError: options => options.background === 'transparent' && options.output_format === 'jpeg' ? 'Seedream 透明背景需要 PNG' : undefined,
    ...(!lite && {
      decompose: base + '/layerize',
      splitLimits: v55 ? { auto: true, max: 100, textRecognition: true } : { auto: true },
      splitFields: { size: field('拆层尺寸', ['auto', ...sdTiers], 'auto'), output_format: sdFormat, watermark: fields.watermark, nsfw_checker: safetyCheckerField },
    }),
  };
}

function gpt(templateId: string, generate: string, edit: string): ImageChannelModel {
  const first = templateId === 'gpt-image-1.5', v26 = templateId.startsWith('gpt-image-2.6-');
  const quality = first ? ['low', 'medium', 'high'] : ['auto', 'low', 'medium', 'high'];
  if (v26 || templateId.startsWith('gpt-image-2.5-')) quality.push('xhigh', 'max');
  return {
    templateId, generate, edit, editInput: 'image_urls', maxImages: 16, maxPromptLength: 32000, markup: v26, optionError,
    fields: {
      size: first ? field('尺寸', ['1024x1024', '1536x1024', '1024x1536'], '1024x1024') : field('尺寸', ['auto', ...shapePresets], 'auto'),
      background, quality: field('质量', quality, 'high'), output_format: format, nsfw_checker: safetyCheckerField,
      ...(!first && { output_compression: outputCompressionField }),
      ...(v26 && { complexity: field('复杂度', ['low', 'medium', 'high'], 'high') }),
    },
  };
}

function banana(templateId: string, base: string, sizes?: string[]): ImageChannelModel {
  const first = templateId === 'gemini-2.5-flash-image';
  return {
    templateId, generate: base, edit: base + '/edit', editInput: 'image_urls', maxImages: findModel(templateId)!.inputImages!,
    maxPromptLength: 50000, fields: {
      aspect_ratio: field('比例', first ? ratios : wideRatios, first ? '1:1' : 'auto'), output_format: format,
      ...(sizes && { image_size: field('分辨率', sizes, '1K') }),
    },
  };
}

export const falImageModels: ImageChannelModel[] = [
  seedream(SEEDREAM_55, 'bytedance/seedream/v5.5'),
  seedream(SEEDREAM_PRO, 'bytedance/seedream/v5/pro'),
  seedream(SEEDREAM_FLASH, 'bytedance/seedream/v5/flash'),
  seedream(SEEDREAM_LITE, 'bytedance/seedream/v5/lite'),
  gpt('gpt-image-1.5', 'fal-ai/gpt-image-1.5', 'fal-ai/gpt-image-1.5/edit'),
  gpt('gpt-image-2', 'openai/gpt-image-2', 'openai/gpt-image-2/edit'),
  ...['2.5', '2.6'].flatMap(version => ['sunburst', 'flare'].map(variant => {
    const base = `openai/gpt-image-${version}/${variant}`;
    return gpt(`gpt-image-${version}-${variant}`, base + '/text-to-image', base + '/edit');
  })),
  banana('gemini-2.5-flash-image', 'fal-ai/nano-banana'),
  banana('gemini-3-pro-image', 'fal-ai/nano-banana-pro', resolutions),
  banana('gemini-3-pro-image-preview', 'fal-ai/gemini-3-pro-image-preview', resolutions),
  banana('gemini-3.1-flash-image', 'fal-ai/nano-banana-2', ['0.5K', ...resolutions]),
  banana('gemini-3.1-flash-image-preview', 'fal-ai/gemini-3.1-flash-image-preview', ['0.5K', ...resolutions]),
  banana('gemini-3.1-flash-lite-image', 'google/nano-banana-lite'),
  banana('gemini-nano-banana-2.1', 'google/nano-banana-2.1', resolutions),
];
