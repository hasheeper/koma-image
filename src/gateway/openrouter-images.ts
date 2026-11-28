import { MAX_TOTAL_BYTES } from '../domain/media.ts';
import { imageBase64 } from '../native/reference-images.ts';
import { readJson } from './transport.ts';
import type { ParameterFields } from '../domain/model-parameters.ts';
import { validateSeedreamBackground } from '../domain/seedream.ts';
import { findModel } from '../domain/models.ts';
import { object, strings } from '../domain/value.ts';
import type { ImageChannel } from './image-channel.ts';
import { channelCatalogEntry, outputCompressionField } from './image-channel-models.ts';
import { profilePath } from './profile.ts';

const parameterLabels = { resolution: '分辨率', aspect_ratio: '比例', quality: '质量', background: '背景', output_format: '格式' };

const catalog: ImageChannel['catalog'] = (raw, bindings) => {
  const data = object(raw).data;
  if (!Array.isArray(data)) throw new Error('同步图像目录格式无效');
  const models: Record<string, unknown> = {};
  for (const model of bindings) {
    const item = object(data.find(entry => object(entry).id === model.generate));
    const architecture = object(item.architecture), params = object(item.supported_parameters);
    const inputs = strings(architecture.input_modalities), refs = object(params.input_references);
    if (!inputs.includes('text') || !inputs.includes('image') || !strings(architecture.output_modalities).includes('image') ||
      refs.type !== 'range' || refs.min !== 0 || typeof refs.max !== 'number' || !Number.isInteger(refs.max) || refs.max < 1) continue;
    const fields: ParameterFields = {};
    for (const [key, label] of Object.entries(parameterLabels)) {
      const param = object(params[key]);
      const options = strings(param.values).filter(v => key !== 'output_format' || ['png', 'jpeg', 'webp'].includes(v));
      if (param.type !== 'enum' || !options.length) continue;
      const logical = key === 'resolution' ? (findModel(model.templateId)?.family === 'seedream' ? 'size' : 'image_size') : key;
      fields[logical] = { options, label, default: '' };
    }
    const compression = object(params.output_compression);
    if (compression.type === 'range' && typeof compression.min === 'number' && Number.isInteger(compression.min) &&
        typeof compression.max === 'number' && Number.isInteger(compression.max) && compression.min >= 0 &&
        compression.max <= 100 && compression.max >= compression.min && fields.output_format?.options.some(f => f === 'jpeg' || f === 'webp')) {
      fields.output_compression = { ...outputCompressionField, min: compression.min, max: compression.max };
    }
    models[model.generate] = channelCatalogEntry(model, fields, Math.min(refs.max, model.maxImages), 'declared');
  }
  if (!Object.keys(models).length) throw new Error('目录中没有已适配且可用的图像模型');
  return { models };
};

export const openRouterImagesChannel: ImageChannel = {
  catalog,
  async execute({ model, upstreamId, prompt, images, options, markup, split }, { profile, transport, signal }) {
    if (!prompt.trim() && !split) throw new Error('请输入生图或编辑提示词');
    validateSeedreamBackground(options);
    const body: Record<string, unknown> = { model: upstreamId, prompt: prompt.trim() || '将原图拆为底图和可独立编辑的图层。', n: 1, response_format: 'b64_json' };
    for (const [logical, value] of Object.entries(options)) {
      const key = logical === 'image_size' || logical === 'size' ? 'resolution' : logical;
      if (key !== 'output_compression' && !Object.hasOwn(parameterLabels, key)) throw new Error(`同步图像接口不支持参数 ${logical}`);
      body[key] = value;
    }
    if (images.length) body[model.editInput] = images.map(url => ({ type: 'image_url', image_url: { url } }));
    if (markup) body.markup = { type: 'image_url', image_url: { url: markup } };
    if (split) body.provider = { options: { seed: { layer_decomposition: true, layer_decomposition_options: { max_images: split.maxImages } } } };
    const operation = split && profile.transport.paths.layerDecompose ? 'layerDecompose' : images.length ? 'toolRun' : 'generate';
    const response = await transport.request(profilePath(profile, operation), { body, signal });
    const result = await readJson(response);
    signal.throwIfAborted();
    if (split) {
      if (!Array.isArray(result.data) || !result.data.length || split.maxImages === undefined || result.data.length > split.maxImages)
        throw new Error('同步图像接口返回的拆层数量无效');
      const layers = result.data.map(raw => {
        const entry = object(raw), metadata = object(entry.layer), z = metadata.z_index;
        if (typeof z !== 'number' || !Number.isInteger(z) || z < 0) throw new Error('拆层结果缺少有效的层序');
        return { encoded: entry.b64_json, metadata, z };
      }).sort((a, b) => a.z - b.z);
      if (layers[0].z !== 0 || new Set(layers.map(layer => layer.z)).size !== layers.length) throw new Error('拆层结果的底图或层序无效');
      const decoded = [];
      let remaining = MAX_TOTAL_BYTES;
      for (const layer of layers) {
        signal.throwIfAborted();
        const blob = await imageBase64(layer.encoded, remaining);
        remaining -= blob.size;
        decoded.push({ blob, metadata: layer.metadata });
      }
      return { images: decoded };
    }
    if (!Array.isArray(result.data) || result.data.length !== 1 || typeof object(result.data[0]).b64_json !== 'string')
      throw new Error('同步图像接口未返回一张内嵌结果图，请勿重复提交');
    return { images: [{ blob: await imageBase64(object(result.data[0]).b64_json, MAX_TOTAL_BYTES) }] };
  },
};
