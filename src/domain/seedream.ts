import type { ParameterFields } from './model-parameters.ts';

/** Local identities remain separate from the source's (possibly custom) model ID. */
export const SEEDREAM_LITE = 'doubao-seedream-5-0-260128';
export const SEEDREAM_PRO = 'doubao-seedream-5-0-pro-260628';
export const SEEDREAM_FLASH = 'doubao-seedream-5-0-flash-260915';
export const SEEDREAM_55 = 'seedream-5.5';
export const seedreamLimits = (templateId: string) => templateId === SEEDREAM_LITE
  ? { images: 14, minPixels: 3_686_400, maxPixels: 16_777_216, sizes: ['2K', '3K', '4K'] }
  : templateId === SEEDREAM_PRO || templateId === SEEDREAM_FLASH
    ? { images: 10, minPixels: 921_600, maxPixels: 4_624_220, sizes: ['1K', '1.5K', '2K'] }
    : null;

export function seedreamFields(templateId: string): ParameterFields {
  const limits = seedreamLimits(templateId);
  const is55 = templateId === SEEDREAM_55;
  return {
    size: { label: '尺寸', options: limits?.sizes ?? (is55 ? ['1K', '1.5K', '2K'] : ['2K']), default: '2K', allowCustom: true },
    ...(is55 ? { background: { label: '背景', options: ['auto', 'transparent', 'opaque'], default: 'auto' } } : {}),
    output_format: { label: '格式', options: ['png', 'jpeg'], default: 'png' },
    watermark: { label: '水印', type: 'boolean', options: ['true', 'false'], default: 'true' },
  };
}

export function validateSeedreamBackground(options: Record<string, unknown>) {
  if (options.background === 'transparent' && options.output_format === 'jpeg')
    throw new Error('透明背景仅支持 PNG 格式，请将格式切换为 PNG');
}

export function validateSeedreamSize(value: unknown, templateId?: string) {
  if (value === undefined) return;
  if (typeof value !== 'string') throw new Error('Seedream 尺寸须为分辨率档位或宽x高');
  const limits = seedreamLimits(templateId ?? '');
  if (/^\d+(?:\.\d+)?K$/.test(value)) {
    if (!(Number(value.slice(0, -1)) > 0)) throw new Error('Seedream 分辨率档位必须大于零');
    if (limits && !limits.sizes.includes(value)) throw new Error('此 Seedream 型号不支持该分辨率档位');
    return;
  }
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) throw new Error('Seedream 尺寸须为分辨率档位或宽x高');
  const width = Number(match[1]), height = Number(match[2]), pixels = width * height;
  if (!Number.isSafeInteger(pixels) || width < 1 || height < 1 || width / height < 1 / 16 || width / height > 16)
    throw new Error('Seedream 尺寸无效，宽高比须在 1:16 至 16:1 之间');
  if (limits && (pixels < limits.minPixels || pixels > limits.maxPixels))
    throw new Error(`此 Seedream 型号的总像素须在 ${limits.minPixels.toLocaleString()} 至 ${limits.maxPixels.toLocaleString()} 之间`);
}
