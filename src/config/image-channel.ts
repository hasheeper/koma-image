import { object } from '../domain/value.ts';
import { initialChannelTemplates, kieImageModels, routerImageModels, type ImageChannelModel } from '../gateway/image-channel-models.ts';
import { falImageModels, validFalModelPath } from '../gateway/fal-models.ts';
import { normalizeBaseUrl } from './base-url.ts';

export const CUSTOM_IMAGES_ID = 'custom-images-v1';
export const imageFormats = {
  'openai-images': 'OpenAI Images（JSON 生图、表单改图）',
  'seedream': 'Seedream JSON',
  'gemini-native': 'Gemini generateContent',
  'openrouter-images': '同步 JSON（OpenRouter 兼容）',
  'kie-images': '异步任务（Kie 兼容）',
  'fal-queue': '模型队列（fal.ai 兼容）',
} as const;
export type ImageFormat = keyof typeof imageFormats;
export type ImagePath = 'catalog' | 'generate' | 'toolRun' | 'layerDecompose' | 'uploadImage' | 'imageTask' | 'imageResult';
export type ModelOperation = 'generate' | 'edit' | 'decompose';
type ImagePaths = Partial<Record<ImagePath, string>>;
export interface ImageChannelConfig {
  format: ImageFormat;
  paths: ImagePaths;
  uploadBaseUrl?: string;
  modelIds?: Record<string, Partial<Record<ModelOperation, string>>>;
}

const defaultPaths: Record<ImageFormat, ImagePaths> = {
  'openai-images': { catalog: '/v1/models', generate: '/v1/images/generations', toolRun: '/v1/images/edits' },
  'seedream': { catalog: '/api/v3/models', generate: '/api/v3/images/generations', toolRun: '/api/v3/images/generations', layerDecompose: '' },
  'gemini-native': { catalog: '/v1beta/models', generate: '/v1beta/models/{model}:generateContent', toolRun: '/v1beta/models/{model}:generateContent' },
  'openrouter-images': { catalog: '/api/v1/images/models', generate: '/api/v1/images', toolRun: '/api/v1/images', layerDecompose: '' },
  'kie-images': { catalog: '/api/v1/chat/credit', generate: '/api/v1/jobs/createTask', toolRun: '/api/v1/jobs/createTask',
    layerDecompose: '', uploadImage: '/api/file-base64-upload', imageTask: '/api/v1/jobs/recordInfo' },
  'fal-queue': { generate: '/{model}', toolRun: '/{model}', layerDecompose: '', imageTask: '', imageResult: '' },
};
export function newImageChannel(format: ImageFormat): ImageChannelConfig {
  return { format, paths: { ...defaultPaths[format] } };
}
export function channelTemplates(format: ImageFormat) {
  if (format === 'fal-queue') return falImageModels;
  return format === 'kie-images' ? kieImageModels : format === 'openrouter-images' ? routerImageModels : undefined;
}
export function optionalImagePath(format: ImageFormat, key: ImagePath) {
  return key === 'catalog' || key === 'layerDecompose' || format === 'fal-queue' && (key === 'imageTask' || key === 'imageResult');
}
export function modelOperations(format: ImageFormat, binding: ImageChannelModel): ModelOperation[] {
  if (format === 'openrouter-images') return ['generate'];
  return binding.decompose ? ['generate', 'edit', 'decompose'] : ['generate', 'edit'];
}
export function channelBindings(config: ImageChannelConfig) {
  const reserved = new Set(Object.values(config.modelIds ?? {}).flatMap(ids => Object.values(ids)));
  return channelTemplates(config.format)?.filter(binding => {
    if (initialChannelTemplates.has(binding.templateId) || config.modelIds?.[binding.templateId]) return true;
    // Older custom IDs take precedence over newly introduced default bindings.
    if ([binding.generate, binding.edit, binding.decompose].some(id => id && reserved.has(id))) return false;
    return config.format !== 'openrouter-images' || !!config.paths.catalog;
  }).map(binding => {
    const ids = config.modelIds?.[binding.templateId];
    if (!ids) return binding;
    return { ...binding, ...ids, edit: ids.edit ?? (binding.edit === binding.generate ? ids.generate : undefined) ?? binding.edit,
      decompose: ids.decompose ?? (binding.decompose === binding.generate ? ids.generate : undefined) ?? binding.decompose };
  });
}

function readSuffix(value: unknown, key: ImagePath, format: ImageFormat): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请填写接口后缀');
  const text = value.trim(), suffix = text.startsWith('/') ? text : '/' + text;
  if (suffix.length > 2048 || /[\\#\s\u0000-\u001f\u007f]/u.test(suffix) || suffix.startsWith('//') || /^[a-z][\w+.-]*:/i.test(text))
    throw new Error('接口后缀须为相对于基础地址的路径');
  const path = suffix.split('?')[0];
  for (const part of path.split('/')) {
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { throw new Error('接口后缀的编码无效'); }
    if (decoded === '.' || decoded === '..' || /[\\/]/.test(decoded)) throw new Error('接口后缀不能跨出基础路径');
  }
  let rest = suffix;
  if (key === 'imageTask' || key === 'imageResult') rest = rest.replace('{taskId}', '');
  if (format === 'fal-queue' || format === 'gemini-native' && (key === 'generate' || key === 'toolRun')) rest = rest.replace('{model}', '');
  if (/[{}]/.test(rest)) throw new Error('接口后缀含有不适用的占位符');
  if (format === 'fal-queue' && (key === 'imageTask' || key === 'imageResult') && !suffix.includes('{taskId}'))
    throw new Error('队列查询和结果后缀须包含 {taskId}');
  const query = new URL(suffix, 'https://example.invalid').searchParams;
  if ([...query.keys()].some(name => /^(?:api[-_]?key|key|access_token|token|authorization)$/i.test(name)))
    throw new Error('请在 API Key 栏填写凭据');
  return suffix;
}

/** Persistence accepts endpoint paths and IDs only. Secrets stay with the connection's credential reference. */
export function readImageChannel(input: unknown): ImageChannelConfig {
  const raw = object(input);
  if (typeof raw.format !== 'string' || !Object.hasOwn(imageFormats, raw.format)) throw new Error('请选择图像请求格式');
  const format = raw.format as ImageFormat, paths: ImagePaths = {};
  for (const key of Object.keys(defaultPaths[format]) as ImagePath[]) {
    const value = object(raw.paths)[key];
    if (optionalImagePath(format, key) && (value === undefined || value === '')) continue;
    paths[key] = readSuffix(value, key, format);
  }
  const config: ImageChannelConfig = { format, paths };
  if (format === 'kie-images' && raw.uploadBaseUrl) config.uploadBaseUrl = normalizeBaseUrl(raw.uploadBaseUrl);
  const templates = channelTemplates(format) ?? [];
  for (const [templateId, entry] of Object.entries(object(raw.modelIds))) {
    const template = templates.find(item => item.templateId === templateId);
    if (!template) throw new Error('请求格式与模型模板不匹配');
    const ids: Partial<Record<ModelOperation, string>> = {};
    for (const op of modelOperations(format, template)) {
      const value = object(entry)[op];
      if (value === undefined || value === '') continue;
      if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value) ||
        ['__proto__', 'constructor', 'prototype'].includes(value.trim())) throw new Error('上游模型 ID 无效');
      ids[op] = value.trim();
      if (format === 'fal-queue' && !validFalModelPath(ids[op])) throw new Error('fal 模型 ID 须为相对模型路径');
    }
    if (Object.keys(ids).length) (config.modelIds ??= {})[templateId] = ids;
  }
  const used = new Set<string>();
  for (const model of channelBindings(config) ?? []) {
    for (const id of new Set([model.generate, model.edit, model.decompose])) {
      if (!id) continue;
      if (used.has(id)) throw new Error('不同模型不能使用同一个上游 ID');
      used.add(id);
    }
  }
  return config;
}
