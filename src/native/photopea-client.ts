import { exportPhotopea, initializePhotopea, copyPhotopeaInput, applyPhotopeaInput, closePhotopeaInput, preparePhotopeaExport, closePhotopeaDocument, resumePhotopea, photopeaScript, PHOTOPEA_ORIGIN } from "./photopea-scripts.ts";
import type { PhotopeaReturnMode, PhotopeaRoles } from "./photopea-scripts.ts";
import type { EditReturn } from "../services/editor.ts";
import { MAX_INPUT_BYTES } from "../domain/media.ts";
import { decodeMask, maskBitmapPixels, validateMaskCarrier } from "./edit-input.ts";
import { validatePhotopeaProject } from "./photopea-project.ts";

type EventData = { koma?: unknown; command?: unknown; event?: unknown; detail?: unknown; source?: unknown };
export interface PhotopeaStack extends PhotopeaRoles { layers: number[]; visible: number[]; width: number; height: number; selection: number[] | null; maskIndex: number; carrierIndex: number }
type Pending = {
  command: number; source: string; started: boolean; complete: boolean; document: boolean;
  expected: readonly string[]; buffers: ArrayBuffer[]; next?: string; error?: string;
  resolve: (buffers: ArrayBuffer[]) => void; reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export function createPhotopeaClient(frame: HTMLIFrameElement, id: string, options: {
  onSave: () => void; onFatal: (message: string) => void; timeout?: number;
}) {
  const timeout = options.timeout ?? 30_000;
  let pending: Pending | undefined, sequence = 0, dead = false, initialized = false;
  let documentId = id;
  let stack: PhotopeaStack | undefined;
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // The host may unmount before it starts awaiting ready.
  void ready.catch(() => {});
  const loading = setTimeout(() => fatal("Photopea 载入超时，请检查网络后重新载入"), 60_000);
  function fatal(message: string, notify = true) {
    if (dead) return;
    dead = true; clearTimeout(loading); window.removeEventListener("message", receive);
    readyReject(new Error(message));
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error(message)); pending = undefined; }
    if (notify) options.onFatal(message);
  }
  function receive(event: MessageEvent) {
    if (dead || event.origin !== PHOTOPEA_ORIGIN || event.source !== frame.contentWindow) return;
    if (event.data === "done") {
      if (!initialized) { initialized = true; clearTimeout(loading); readyResolve(); return; }
      const p = pending;
      if (!p || !p.started) return;
      if (!p.complete || p.next || !p.error && p.buffers.length !== p.expected.length) {
        fatal("Photopea 返回不完整，请重新载入后再试"); return;
      }
      pending = undefined; clearTimeout(p.timer);
      if (p.error) p.reject(new Error(p.error)); else p.resolve(p.buffers);
      return;
    }
    if (event.data instanceof ArrayBuffer) {
      const p = pending, bytes = new Uint8Array(event.data);
      if (!p) return; // A user's File → Export never applies itself to Koma.
      const project = p.next === "project", header = project ? [56,66,80,83,0,1] : [137,80,78,71,13,10,26,10];
      if (!p.started || !p.document || !p.next || p.complete || !bytes.length || !header.every((v,i)=>bytes[i]===v)) {
        fatal("Photopea 返回的图片格式、大小或顺序异常，请重新载入"); return;
      }
      if (bytes.length > (project ? 128*1024*1024 : MAX_INPUT_BYTES)) p.error = project ? "分层文档超过临时导出上限，请先另存 PSD 并简化图层" : "回传图片超过 8MB，请在 Photopea 调整尺寸后再应用";
      p.buffers.push(p.error ? new ArrayBuffer(0) : event.data); p.next = undefined;
      return;
    }
    if (typeof event.data !== "string") return;
    let data: EventData;
    try { data = JSON.parse(event.data) as EventData; } catch { return; }
    if (!data || data.koma !== id) return;
    if (data.event === "save") { if (!pending && data.source === `koma:${documentId}`) options.onSave(); return; }
    const p = pending;
    if (!p) return;
    if (data.command !== p.command) return;
    if (data.event === "start" && !p.started) { p.started = true; return; }
    if (!p.started || p.complete) { fatal("Photopea 消息顺序异常，请重新载入"); return; }
    if (data.event === "error") {
      p.error = typeof data.detail === "string" ? data.detail.slice(0, 240) : "Photopea 未能完成本次操作";
      p.complete = true; p.next = undefined; return;
    }
    if (data.event === "document" && !p.document && !p.next && !p.buffers.length) {
      p.document = true;
      if (data.detail !== p.source) p.error = "请切回本次打开的 Koma 图像";
      return;
    }
    if (data.event === "state" && !p.next && !p.buffers.length) {
      const value = data.detail as Partial<PhotopeaStack> | undefined;
      if (!value || ![value.baseId,value.scratchId,value.maskId,value.carrierId,value.width,value.height].every(n => Number.isInteger(n) && Number(n)>0) ||
        !Array.isArray(value.layers) || !Array.isArray(value.visible) || new Set(value.layers).size !== value.layers.length ||
        ![value.maskIndex,value.carrierIndex].every(n=>Number.isInteger(n)&&Number(n)>=0&&Number(n)<value.layers!.length) ||
        ![...value.layers, ...value.visible].every(n => Number.isInteger(n) && n > 0) ||
        value.selection !== null && (!Array.isArray(value.selection) || value.selection.length !== 4 || !value.selection.every(Number.isFinite))) {
        fatal("Photopea 分层文档信息无效，请重新载入"); return;
      }
      stack = value as PhotopeaStack; return;
    }
    if (data.event === "complete") { p.complete = true; return; }
    if (p.next || data.event !== p.expected[p.buffers.length]) { fatal("Photopea 导出顺序异常，请重新载入"); return; }
    p.next = String(data.event);
  }
  window.addEventListener("message", receive);
  async function send(value: string | ArrayBuffer, expected: readonly string[] = []) {
    await ready;
    if (dead || !frame.contentWindow) throw new Error("Photopea 连接已关闭，请重新载入");
    if (pending) throw new Error("请等待 Photopea 完成当前操作");
    const command = ++sequence;
    return new Promise<ArrayBuffer[]>((resolve, reject) => {
      // Binary imports have only a done acknowledgement. A global on-open script adds a
      // second done and can swallow the next command; only explicit scripts are used.
      pending = { command, source: `koma:${documentId}`, expected, buffers: [], document: false, started: typeof value !== "string", complete: typeof value !== "string",
        resolve, reject, timer: setTimeout(() => fatal("Photopea 操作超时；未应用，请重新载入"), timeout) };
      try {
        if (typeof value === "string") frame.contentWindow!.postMessage(photopeaScript(id, command, value), PHOTOPEA_ORIGIN);
        else frame.contentWindow!.postMessage(value, PHOTOPEA_ORIGIN, [value]);
      } catch { fatal("无法向 Photopea 传入图片，请重新载入"); }
    });
  }
  return {
    ready,
    get failed() { return dead; },
    get stack() { return stack; },
    async closeDocument(id: string) { await send(closePhotopeaDocument(id)); },
    async open(image: Blob, mask?: Blob, sourceId = id, reuse?: {
      documentId: string; roles: PhotopeaRoles; sameImage: boolean; refreshMask: boolean; baked: number[];
    }, maskMode = false) {
      documentId = sourceId;
      if (reuse) {
        await send(resumePhotopea(reuse.documentId, sourceId, reuse.roles));
        if (!reuse.sameImage) {
          await send(await image.arrayBuffer());
          await send(copyPhotopeaInput(sourceId));
          await send(applyPhotopeaInput(sourceId,reuse.roles,"base",true,reuse.baked,maskMode));
          await send(closePhotopeaInput(sourceId));
        }
      } else {
        stack = undefined;
        await send(await image.arrayBuffer());
        await send(initializePhotopea(documentId, maskMode));
      }
      if (!reuse || reuse.refreshMask) {
        if (!stack) throw new Error("Photopea 分层文档信息缺失，请重新载入");
        if (mask) { await send(await mask.arrayBuffer()); await send(copyPhotopeaInput(documentId)); }
        if (mask || reuse) await send(applyPhotopeaInput(documentId,stack,"mask",!!mask));
        if (mask) await send(closePhotopeaInput(documentId,!reuse));
      }
    },
    async export(mode: PhotopeaReturnMode): Promise<EditReturn> {
      if (!stack || !["auto","image","mask"].includes(mode)) throw new Error("Photopea 工作栈或回传方式无效");
      const [project] = await send(preparePhotopeaExport(documentId, stack),["project"]);
      const current = stack;
      if (current.width * current.height > 32_000_000) throw new Error("图片最多 3200 万像素");
      validatePhotopeaProject(project, current);
      await send(project);
      const buffers = await send(exportPhotopea(documentId,current.maskIndex,current.carrierIndex,current.selection), ["image","selection","mask","carrier"]);
      const blobs = buffers.map(bytes => new Blob([bytes], {type:"image/png"}));
      // Decode sequentially to avoid retaining three full RGBA buffers for a large canvas.
      const selection = await decodeMask(blobs[1],"alpha",current,true);
      const mask = await decodeMask(blobs[2],"alpha",current,true);
      if (current.selection) await validateMaskCarrier(blobs[3],current,current.selection);
      if (mode === "image") return {mode,image:blobs[0]};
      for (let i=0;i<mask.bits.length;i++) mask.bits[i] |= selection.bits[i];
      const canvas = new OffscreenCanvas(current.width,current.height),ctx=canvas.getContext("2d");
      if (!ctx) throw new Error("当前浏览器不支持图片处理");
      ctx.putImageData(maskBitmapPixels(mask),0,0);
      return {mode,image:blobs[0],mask:await canvas.convertToBlob({type:"image/png"}),format:"alpha"};
    },
    dispose() { fatal("Photopea 已关闭", false); },
  };
}
export type PhotopeaClient = ReturnType<typeof createPhotopeaClient>;
