import { MAX_INPUT_BYTES, MAX_TOTAL_BYTES } from '../domain/media.ts';
import { object } from '../domain/value.ts';
import { validateMarkupImage } from '../domain/image-markup.ts';
import type { CatalogModel } from '../domain/catalog.ts';
import type { ParameterFields } from '../domain/model-parameters.ts';
import { acceptsSplitOptions } from './image-channel-models.ts';
import type { ImageChannelModel } from './image-channel-models.ts';
import type { GatewayProfile } from './profile.ts';
import type { ImagePayload, GatewayImages } from './routes.ts';
import type { createTransport } from './transport.ts';

export interface ChannelImageRequest {
  model: ImageChannelModel;
  fields: ParameterFields;
  upstreamId: string;
  images: string[];
  markup?: string;
  prompt: string;
  split?: ImagePayload['layerDecomposition'];
  options: Record<string, unknown>;
}

export interface ImageChannel {
  catalog?(raw: unknown, models: readonly ImageChannelModel[]): { models: Record<string, unknown> };
  execute(request: ChannelImageRequest, io: {
    profile: GatewayProfile;
    transport: ReturnType<typeof createTransport>;
    fetcher: typeof fetch;
    signal: AbortSignal;
  }): Promise<GatewayImages>;
}

export async function waitForPoll(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function channelImageRequest(profile: GatewayProfile, payload: ImagePayload, source?: CatalogModel): ChannelImageRequest {
  const model = profile.channelModels?.find(m => m.generate === payload.model);
  const edit = payload.tool === 'image-edit', split = payload.layerDecomposition;
  if (!model || (payload.tool && !edit) || (split && (!edit || !model.decompose)) ||
      payload.mask_image || payload.referencePlan || payload.preparedReferences)
    throw new Error('当前图像来源不支持这个模型或操作');
  if (split && model.splitLimits && !acceptsSplitOptions(model.splitLimits, split)) throw new Error('此来源不支持所选拆层数量或文字识别设置');
  const markup = payload.markup_image;
  if (markup !== undefined) {
    if (!model.markup || !edit || split) throw new Error('此来源不支持本次原生标注');
    validateMarkupImage(payload.init_image, markup);
  }
  const options = object(payload.image_options);
  const issue = model.optionError?.(options);
  if (issue) throw new Error(issue);
  const extra = payload.additional_images ?? [];
  if (!Array.isArray(extra) || (!edit && (payload.init_image !== undefined || extra.length)))
    throw new Error('参考图输入格式无效');
  const inputs = edit ? [payload.init_image, ...extra] : [];
  const maxImages = split ? 1 : Math.min(model.maxImages, source?.maxImages ?? model.maxImages);
  if (inputs.length > maxImages) throw new Error(`当前操作最多使用 ${maxImages} 张图（包含底图）`);
  let total = 0;
  const checkedImage = (input: unknown) => {
    if (typeof input !== 'string') throw new Error('缺少参考图');
    const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
    if (!match) throw new Error('参考图须为 PNG、JPEG 或 WebP');
    const encoded = match[1];
    const bytes = encoded.length * 0.75 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
    if (bytes > MAX_INPUT_BYTES) throw new Error('单张参考图不超过 8 MB');
    total += bytes;
    return input;
  };
  const images = inputs.map(checkedImage);
  if (markup !== undefined) checkedImage(markup);
  if (total > MAX_TOTAL_BYTES) throw new Error('参考图合计不超过 32 MB');
  const upstreamId = split ? model.decompose! : edit ? model.edit : model.generate;
  const fields = split ? source?.splitFields ?? model.splitFields ?? source?.fields ?? model.fields : source?.fields ?? model.fields;
  return { model, fields, upstreamId, images, markup, split, prompt: typeof payload.prompt === 'string' ? payload.prompt : '',
    options };
}
