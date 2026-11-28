import { requestOptions } from '../domain/model-parameters.ts';
import { SEEDREAM_LITE, SEEDREAM_MIN_SPLIT_PIXELS } from '../domain/seedream.ts';
import { object } from '../domain/value.ts';
import { imageDimensions } from '../native/image-dimensions.ts';
import { identifyImageBlob } from '../native/reference-images.ts';
import { waitForPoll, type ChannelImageRequest, type ImageChannel } from './image-channel.ts';
import { profilePath } from './profile.ts';
import type { GatewayImages } from './routes.ts';
import { errorMessage, readJson } from './transport.ts';

function falErrorMessage(raw: unknown, fallback?: string) {
  const { detail } = object(raw);
  if (Array.isArray(detail)) {
    const messages = detail.slice(0, 3).flatMap(entry => {
      const { loc, msg } = object(entry);
      if (typeof msg !== 'string' || !msg.trim()) return [];
      const field = Array.isArray(loc) ? loc.filter(part => typeof part === 'string' && part !== 'body').join('.') : '';
      return field ? [field + ' · ' + msg] : [msg];
    });
    if (messages.length) return messages.join('，').slice(0, 1000);
  }
  return errorMessage(raw, fallback);
}

function falInput({ model, fields, prompt, images, options, markup, split }: ChannelImageRequest) {
  const { size, image_size, complexity, nsfw_checker, ...params } = requestOptions(fields, options);
  const input: Record<string, unknown> = { ...params };
  if (prompt) input.prompt = prompt;
  if (fields.nsfw_checker) input.enable_safety_checker = nsfw_checker ?? (fields.nsfw_checker.default === 'true');
  if (size !== undefined) input.image_size = typeof size === 'string' && /^\d+(\.\d+)?K$/.test(size) ? 'auto_' + size : size;
  if (split) {
    const { width, height } = imageDimensions(images[0]);
    if (width * height < SEEDREAM_MIN_SPLIT_PIXELS || width * height > 36_000_000 || width > 16 * height || height > 16 * width)
      throw new Error('fal 拆层底图须为 262,144 至 36,000,000 像素，宽高比须在 1:16 至 16:1 之间');
    input.image_url = images[0];
    if (split.maxImages !== undefined) input.max_images = split.maxImages;
    if (split.textRecognition) input.enable_text_recognition = true;
    return input;
  }
  const minimum = model.templateId.startsWith('gemini-') ? 3 : model.templateId === 'gpt-image-1.5' ? 2 : 1;
  const length = Array.from(prompt.trim()).length;
  if (length < minimum || model.maxPromptLength && length > model.maxPromptLength)
    throw new Error(`fal 提示词长度须至少 ${minimum} 个字符${model.maxPromptLength ? '，最多 ' + model.maxPromptLength + ' 个字符' : ''}`);
  input.num_images = 1;
  if (images.length) input[model.editInput] = images;
  if (markup) input.markup_image_url = markup;
  if (image_size !== undefined) input.resolution = image_size;
  if (complexity !== undefined) input.reasoning_effort = complexity;
  if (model.templateId === SEEDREAM_LITE) input.sequential_image_generation = 'disabled';
  return input;
}

interface ResultFile { url: URL; metadata?: Record<string, unknown> }
function fileUrl(raw: unknown) {
  const value = object(raw).url;
  const url = typeof value === 'string' ? URL.parse(value) : null;
  if (url?.protocol !== 'https:' || url.username || url.password) throw new Error('fal 未返回有效的 HTTPS 图片地址');
  return url;
}
function resultFiles(result: Record<string, unknown>, split: ChannelImageRequest['split']): ResultFile[] {
  if (!split) {
    if (!Array.isArray(result.images) || result.images.length !== 1) throw new Error('fal 未返回一张结果图');
    return [{ url: fileUrl(result.images[0]) }];
  }
  // The flat images[] contains the same files but lacks the canvas placement data.
  if (!Array.isArray(result.layers) || !result.layers.length || result.layers.length > (split.maxImages ?? 100))
    throw new Error('fal 返回的拆层数量无效');
  const layers = result.layers.map(raw => {
    const { image, ...metadata } = object(raw), z = metadata.z_index;
    if (typeof z !== 'number' || !Number.isSafeInteger(z) || z < 0) throw new Error('fal 返回的图层顺序无效');
    return { url: fileUrl(image), metadata, z };
  }).sort((a, b) => a.z - b.z);
  if (layers[0].z !== 0 || new Set(layers.map(layer => layer.z)).size !== layers.length)
    throw new Error('fal 返回的底图或层序无效');
  return layers;
}

export const falImagesChannel: ImageChannel = {
  async execute(request, { profile, transport, fetcher, signal }) {
    const { upstreamId: model, split, images } = request;
    const paths = profile.transport.paths;
    const operation = split && paths.layerDecompose ? 'layerDecompose' : images.length ? 'toolRun' : 'generate';
    const submitted = await readJson(await transport.request(profilePath(profile, operation), {
      operation, model, body: falInput(request), signal,
    }), falErrorMessage);
    const id = submitted.request_id;
    if (typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)) throw new Error('fal 已响应提交，但任务 ID 无效，请勿重复提交');
    const query = async (operation: 'imageTask' | 'imageResult', location: unknown) => {
      const path = paths[operation];
      const response = path
        ? await transport.request(path, { operation, taskId: id, model, signal })
        : await transport.falQueueLink(location, id, operation === 'imageTask' ? 'status' : 'result', signal);
      return readJson(response, falErrorMessage);
    };
    try {
      let interval = 1500;
      for (;;) {
        const state = await query('imageTask', submitted.status_url);
        if (state.request_id !== undefined && state.request_id !== id) throw new Error('fal 返回了其他任务的状态');
        if (state.status === 'COMPLETED') {
          const result = await query('imageResult', state.response_url ?? submitted.response_url);
          const output: GatewayImages['images'] = [];
          for (const { url, metadata } of resultFiles(result, split)) {
            signal.throwIfAborted();
            const response = await fetcher(url, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' });
            if (!response.ok) throw new Error(`fal 图片下载失败（${response.status}）`);
            const blob = await identifyImageBlob(await response.blob());
            output.push({ blob, metadata });
          }
          signal.throwIfAborted();
          return { images: output };
        }
        if (state.status !== 'IN_QUEUE' && state.status !== 'IN_PROGRESS') throw new Error('fal 任务未完成或状态无效');
        await waitForPoll(interval, signal);
        interval = Math.min(5000, interval + 1000);
      }
    } catch (error) {
      signal.throwIfAborted();
      throw new Error(`${error instanceof Error ? error.message : 'fal 结果读取失败'}（任务 ${id}）`, { cause: error });
    }
  },
};
