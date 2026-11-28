import { requestOptions } from "../domain/model-parameters.ts";
import { findModel } from "../domain/models.ts";
import { channelCatalogEntry, kieImageModels, type ImageChannelModel } from "./image-channel-models.ts";
import { waitForPoll, type ChannelImageRequest, type ImageChannel } from "./image-channel.ts";
import { SEEDREAM_55, SEEDREAM_LITE, SEEDREAM_PRO, SEEDREAM_FLASH, validateSeedreamBackground } from "../domain/seedream.ts";
import { object } from "../domain/value.ts";
import { profilePath } from "./profile.ts";
import { identifyImageBlob } from "../native/reference-images.ts";
import type { GatewayImages } from "./routes.ts";
import { readJson } from "./transport.ts";

function dataFrom(raw: unknown) {
  const result = object(raw);
  if (result.code === 401) throw new Error("鉴权失败（401），请检查此连接的 API Key");
  if (result.code !== 200 || result.success === false) {
    const detail = typeof result.msg === "string" ? result.msg.slice(0, 500) : "响应格式不正确";
    throw new Error(`异步任务接口返回错误（${detail}）`);
  }
  return result.data;
}

export function kieImageCatalog(raw: unknown, bindings: readonly ImageChannelModel[] = kieImageModels) {
  const balance = dataFrom(raw);
  if (typeof balance !== "number" || !Number.isFinite(balance)) throw new Error("账户响应格式不正确");
  const models: Record<string, unknown> = {};
  for (const binding of bindings) models[binding.generate] = channelCatalogEntry(binding);
  return { models };
}

function seedreamInput({ model, fields: sourceFields, options, split, images, prompt }: ChannelImageRequest) {
  const id = model.templateId;
  let min = id === SEEDREAM_55 ? 5 : 4;
  let max = id === SEEDREAM_LITE ? 2995 : 5000;
  if (split) {
    min = id === SEEDREAM_FLASH && prompt ? 4 : 0;
    if (id === SEEDREAM_55) max = 2000;
  }
  if (prompt.trim().length < min || prompt.length > max) throw new Error(`此操作提示词长度须为 ${min}–${max} 字符`);
  const fields = split ? sourceFields : model.fields;
  const selected = requestOptions(fields, options);
  const input: Record<string, unknown> = prompt ? { prompt } : {};
  if (fields.output_format) input.output_format = selected.output_format ?? fields.output_format.default;
  if (fields.nsfw_checker) input.nsfw_checker = selected.nsfw_checker ?? false;
  if (split) {
    // Pro requires a size even in automatic mode. Other split endpoints accept omission.
    if (fields.size || id === SEEDREAM_PRO) input.size = selected.size ?? 'auto';
    if (split.maxImages !== undefined) input.max_images = split.maxImages;
    if (split.textRecognition) input.text_recognition = true;
  } else {
    const size = selected.size ?? fields.size.default;
    const ratio = selected.aspect_ratio ?? fields.aspect_ratio.default;
    input.aspect_ratio = !images.length && ratio === 'auto' ? '1:1' : ratio;
    if (id === SEEDREAM_LITE) input.quality = { '2K': 'basic', '3K': 'high', '4K': 'ultra' }[String(size)];
    else if (id === SEEDREAM_PRO) input.quality = size === '1K' ? 'basic' : 'high';
    else input.size = size;
    if (fields.background) input.background = selected.background ?? 'auto';
    validateSeedreamBackground(input);
  }
  return input;
}

function kieInput(request: ChannelImageRequest): Record<string, unknown> {
  const { model, prompt, options } = request;
  if (findModel(model.templateId)?.family === 'seedream') return seedreamInput(request);
  const max = model.maxPromptLength ?? 20000;
  if (!prompt.trim() || prompt.length > max) throw new Error(`提示词长度应为 1–${max} 字符`);
  const { image_size, ...fields } = requestOptions(model.fields, options);
  const resolution = image_size ?? model.fields.image_size?.default;
  if (model.backgroundOnly1K && resolution !== '1K' && fields.background === 'auto') delete fields.background;
  if (model.templateId === 'gpt-image-1.5') fields.quality ??= model.fields.quality.default;
  if (model.templateId === 'gpt-image-1.5' || model.templateId === 'gemini-3.1-flash-lite-image' || model.templateId === 'gemini-2.5-flash-image')
    fields.aspect_ratio ??= model.fields.aspect_ratio.default;
  if (model.templateId === 'gemini-3-pro-image') fields.output_format ??= model.fields.output_format.default;
  return { prompt, ...fields, ...(resolution ? { resolution } : {}) };
}

function mediaUrl(value: unknown) {
  const url = typeof value === "string" ? URL.parse(value) : null;
  if (url?.protocol !== "https:" || url.username || url.password) throw new Error("异步任务接口没有返回有效的 HTTPS 图片地址");
  return url;
}

function outputEntries(json: unknown, split: ChannelImageRequest['split']) {
  if (typeof json !== "string") throw new Error("异步任务接口没有返回任务结果");
  const result = object(JSON.parse(json));
  if (!split) {
    if (!Array.isArray(result.resultUrls) || result.resultUrls.length !== 1) throw new Error("异步任务接口未返回一张结果图");
    return result.resultUrls.map(value => ({ url: mediaUrl(value), metadata: undefined }));
  }
  const layers = object(result.resultObject).layers_data;
  if (!Array.isArray(layers) || !layers.length || layers.length > (split.maxImages ?? 100)) throw new Error("异步任务接口未返回有效的拆层结果");
  const entries = layers.map(value => {
    const { url, ...metadata } = object(value);
    const z = metadata.z_index;
    if (typeof z !== "number" || !Number.isInteger(z) || z < 0) throw new Error("返回结果的图层顺序无效");
    return { url: mediaUrl(url), metadata, z };
  }).sort((a, b) => a.z - b.z);
  if (entries[0].z !== 0 || new Set(entries.map(entry => entry.z)).size !== entries.length) throw new Error("返回结果的底图或层序无效");
  return entries;
}

const execute: ImageChannel['execute'] = async (request, { profile, transport, fetcher, signal }) => {
  const { model, upstreamId, images, split } = request;
  const input = kieInput(request);
  const imageUrls: string[] = [];
  async function upload(base64Data: string) {
    const uploaded = await readJson(await transport.request(profilePath(profile, "uploadImage"), {
      operation: "uploadImage", body: { base64Data, uploadPath: "koma-image" }, signal,
    }));
    return mediaUrl(object(dataFrom(uploaded)).downloadUrl).href;
  }
  for (const image of images) imageUrls.push(await upload(image));
  if (request.markup) input.markup = await upload(request.markup);
  if (split) input.image_url = imageUrls[0];
  else if (imageUrls.length || model.editInput === 'image_input') input[model.editInput] = imageUrls;

  const submitted = await readJson(await transport.request(profilePath(profile, split && profile.transport.paths.layerDecompose ? "layerDecompose" : images.length ? "toolRun" : "generate"), {
    body: { model: upstreamId, input }, signal,
  }));
  const taskId = object(dataFrom(submitted)).taskId;
  if (typeof taskId !== "string" || !/^[\w-]{1,128}$/.test(taskId)) throw new Error("异步任务接口已响应提交，但未返回有效任务 ID，请勿重复提交");
  try {
    let interval = 2000;
    for (;;) {
      const task = object(dataFrom(await readJson(await transport.request(profilePath(profile, "imageTask"), { taskId, signal }))));
      if (task.state === "success") {
        const entries = outputEntries(task.resultJson, split);
        const images: GatewayImages["images"] = [];
        for (const { url, metadata } of entries) {
          const response = await fetcher(url, { signal, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
          if (!response.ok) throw new Error(`图片下载失败（${response.status}）`);
          const blob = await response.blob();
          if (!blob.size || blob.type && !/^(image\/(png|jpeg|webp)|application\/octet-stream)$/.test(blob.type))
            throw new Error("图片下载未返回有效图像");
          const typed = blob.type.startsWith("image/") ? blob : await identifyImageBlob(blob);
          images.push({ blob: typed, metadata });
        }
        return { images };
      }
      if (task.state === "fail") throw new Error(typeof task.failMsg === "string" ? task.failMsg.slice(0, 500) : "上游任务失败");
      if (task.state !== "waiting" && task.state !== "queuing" && task.state !== "generating") throw new Error("异步任务接口返回了未知任务状态");
      await waitForPoll(interval, signal);
      interval = Math.min(interval + 1000, 5000);
    }
  } catch (error) {
    signal.throwIfAborted();
    throw new Error(`${error instanceof Error ? error.message : "任务结果读取失败"}（任务 ${taskId}）`, { cause: error });
  }
};

export const kieImagesChannel: ImageChannel = { catalog: kieImageCatalog, execute };
