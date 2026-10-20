import type { ApplicationServices } from "./application";
import type { Ui } from "../app/ui";
import { message } from "../app/ui";
import type { AppRouter } from "../app/router";
import type { Drawing } from "./drawing";
import type { Chat } from "./chat";
import { normalizeOptions, resolveModel } from "../domain/catalog";
import type { CatalogModel } from "../domain/catalog";
import {
  editorModels,
  validateEditorSource,
  buildEditorPayload,
} from "../domain/media.ts";
import type { EditMode, EditorMode, EditorFields } from "../domain/media.ts";
import type { Fields } from "../storage/records";
import type { Quote } from "../domain/quote";
import { normalizeQuota } from "../domain/quota";
import type { QuotaStatus } from "../domain/quota";
import type { MaskState } from "../native/mask-editor.ts";
import { decodeImage } from "./image-response";
import { consumeMedia } from "./media-response";
import { dataUrl } from "./assets";
export const modeNames = {
  img2img: "图生图",
  inpaint: "重绘",
  upscale: "放大",
};
export interface EditorVersion {
  id: number;
  parentId: number;
  kind: "source" | "result";
  mode?: EditorMode;
  blob: Blob;
  url: string;
  width: number;
  height: number;
  name: string;
  model?: CatalogModel;
  params?: Fields;
  quote?: Quote;
  original?: Promise<string>;
  png?: Promise<string>;
}
export interface EditorSession {
  id: string;
  origin: "image" | "chat";
  conversationId?: string;
  versions: EditorVersion[];
  baseId: number;
  viewId: number;
  mode: EditMode;
  chosen: Record<EditorMode, string>;
  strength: Record<EditMode, number>;
  noise: Record<EditMode, number>;
  options: Record<string, Record<string, string>>;
  fields: {
    prompt: string;
    negative_prompt: string;
    sampler: string;
    steps: number;
    scale: number;
    seed: string;
    detail: string;
  };
  maskFor: number;
  mask?: MaskState;
  nextId: number;
  resultCount: number;
  initialized: boolean;
}
const session = (
  id: string,
  origin: "image" | "chat",
  conversationId?: string,
): EditorSession => ({
  id,
  origin,
  conversationId,
  versions: [],
  baseId: 0,
  viewId: 0,
  mode: "img2img",
  chosen: { img2img: "", inpaint: "", upscale: "" },
  strength: { img2img: 0.5, inpaint: 1 },
  noise: { img2img: 0, inpaint: 0 },
  options: {},
  fields: {
    prompt: "",
    negative_prompt: "",
    sampler: "k_euler_ancestral",
    steps: 25,
    scale: 5,
    seed: "",
    detail: "",
  },
  maskFor: 0,
  nextId: 1,
  resultCount: 0,
  initialized: false,
});
const stem = (name: string) =>
  name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "-") ||
  "image";
const failure = (e: unknown) =>
  message(e).includes("Could not verify the free-pool subscription")
    ? "NAI 暂时无法验证订阅，请稍后重试或换专用放大模型"
    : message(e);
async function normalizedPng(blob: Blob) {
  const b = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(b.width, b.height);
    canvas.getContext("2d")!.drawImage(b, 0, 0);
    return dataUrl(await canvas.convertToBlob({ type: "image/png" }));
  } finally {
    b.close();
  }
}
export function createEditor(
  services: ApplicationServices,
  ui: Ui,
  router: AppRouter,
  drawing: Drawing,
  chat: Chat,
) {
  const sessions = new Map<string, EditorSession>(),
    listeners = new Set<() => void>();
  let current = session("image", "image");
  sessions.set(current.id, current);
  let models: CatalogModel[] = [],
    samplers = ["k_euler_ancestral"],
    quota: QuotaStatus | null = null,
    open = false,
    upscaleOpen = false,
    reading = false,
    busy = false,
    preparing = false,
    runError = "",
    running: EditorMode = "img2img",
    startedAt = 0,
    disposed = false;
  let readSequence = 0,
    openSequence = 0,
    taskAbort: AbortController | undefined,
    catalogAbort: AbortController | undefined;
  const connectionSamplers = new Map<string, string[]>();
  const blank = () => ({
    quote: null as Quote | null,
    error: "",
    price: "",
    revision: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    abort: undefined as AbortController | undefined,
  });
  const jobs = { edit: blank(), upscale: blank() };
  type Job = keyof typeof jobs;
  let maskPort:
    | {
        getMask: () => string | null;
        isDrawing: () => boolean;
        save: () => void;
      }
    | undefined;
  const emit = () => {
    if (!disposed) for (const f of listeners) f();
  };
  const base = () => current.versions.find((v) => v.id === current.baseId),
    viewed = () =>
      current.versions.find((v) => v.id === current.viewId) || base();
  const selected = (mode: EditorMode = current.mode) =>
    editorModels({ models }, mode).find((m) => m.id === current.chosen[mode]);
  const source = (key: Job) => (key === "upscale" ? viewed() : base());
  const target = (key: Job): EditorMode =>
    key === "upscale" ? "upscale" : current.mode;
  const warning = (key: Job) => {
    const v = source(key);
    return v
      ? validateEditorSource(target(key), selected(target(key)), {
          width: v.width,
          height: v.height,
          bytes: v.blob.size,
        })
      : null;
  };
  function cancelQuote(key: Job) {
    const j = jobs[key];
    j.revision++;
    clearTimeout(j.timer);
    j.abort?.abort();
    j.quote = null;
    j.error = "";
    j.price = "";
  }
  function normalize() {
    for (const mode of ["img2img", "inpaint", "upscale"] as const) {
      const list = editorModels({ models }, mode);
      if (!list.some((m) => m.id === current.chosen[mode]))
        current.chosen[mode] =
          (mode === "upscale"
            ? list.find((m) => m.id === "nai-diffusion-5-full")
            : null
          )?.id ||
          list[0]?.id ||
          "";
    }
    const m = selected();
    samplers = m
      ? connectionSamplers.get(m.connection) || ["k_euler_ancestral"]
      : ["k_euler_ancestral"];
    if (!samplers.includes(current.fields.sampler))
      current.fields.sampler = samplers[0];
  }
  async function catalog() {
    if (services.data.phase !== "ready") return;
    catalogAbort?.abort();
    const controller = (catalogAbort = new AbortController());
    const results = await Promise.allSettled(
      Object.keys(services.connections.configuration.connections).map(
        async (id) => ({
          id,
          c: await services.gateway(id).catalog(false, controller.signal),
        }),
      ),
    );
    if (controller.signal.aborted || disposed) return;
    models = [];
    connectionSamplers.clear();
    for (const r of results)
      if (r.status === "fulfilled") {
        connectionSamplers.set(r.value.id, r.value.c.samplers);
        for (const m of r.value.c.models)
          if (!models.some((v) => v.id === m.id)) models.push(m);
      } else runError = failure(r.reason);
    normalize();
    emit();
    requote();
    void refreshQuota();
  }
  async function refreshQuota() {
    const m = selected(upscaleOpen ? "upscale" : current.mode);
    if (!m || services.data.phase !== "ready") return;
    const stillSelected = () =>
      !disposed && selected(upscaleOpen ? "upscale" : current.mode) === m;
    try {
      const next = await services.gateway(m.connection).quota(m.quotaGroup);
      if (stillSelected()) quota = next;
    } catch {
      if (stillSelected()) quota = null;
    }
    if (stillSelected()) emit();
  }
  async function payload(key: Job) {
    const mode = target(key),
      v = source(key),
      m = selected(mode);
    if (!v || !m) throw new Error("请先选择底图和模型");
    const w = warning(key);
    if (w) throw new Error(w);
    const f: EditorFields = {
      ...current.fields,
      seed:
        current.fields.seed.trim() === "" ? -1 : Number(current.fields.seed),
      strength: current.strength[current.mode],
      noise: current.noise[current.mode],
      detail: current.fields.detail.trim(),
      options: current.options[m.id] || normalizeOptions(m),
    };
    const mask =
      mode === "inpaint" && current.maskFor === v.id
        ? maskPort?.getMask()
        : null;
    const encoded =
      mode === "upscale"
        ? {
            original: await (v.original ??= dataUrl(v.blob).catch((e) => {
              v.original = undefined;
              throw e;
            })),
          }
        : {
            png: await (v.png ??= normalizedPng(v.blob).catch((e) => {
              v.png = undefined;
              throw e;
            })),
          };
    return {
      payload: buildEditorPayload(mode, m, encoded, f, mask),
      model: m,
      parent: v,
      mode,
      owner: current,
    };
  }
  function scheduleQuote(key: Job = "edit", delay = 400) {
    cancelQuote(key);
    const j = jobs[key],
      m = selected(target(key)),
      v = source(key);
    if (v && !m) j.price = "无可用模型";
    if (
      !open ||
      (key === "upscale" && !upscaleOpen) ||
      busy ||
      preparing ||
      reading ||
      !m ||
      !v ||
      warning(key) ||
      maskPort?.isDrawing() ||
      services.data.phase !== "ready"
    ) {
      emit();
      return;
    }
    const rev = j.revision;
    emit();
    j.timer = setTimeout(async () => {
      const controller = (j.abort = new AbortController());
      try {
        const p = await payload(key);
        if (rev !== j.revision) return;
        const gateway = services.gateway(p.model.connection);
        const q = await gateway.estimate(p.payload, controller.signal);
        if (rev !== j.revision || busy || !open) return;
        j.quote = q;
        if (q.quota)
          quota = {
            ...normalizeQuota(
              gateway.profile,
              q.quota,
              {},
              quota?.temporaryChecked ?? false,
              p.model.quotaGroup,
            ),
            temporary: quota?.temporary ?? null,
          };
        j.price = "";
      } catch (e) {
        if (rev !== j.revision || controller.signal.aborted) return;
        if (message(e).includes("先涂抹")) j.price = "先涂抹";
        else j.error = failure(e);
      }
      emit();
    }, delay);
  }
  function requote(delay = 400) {
    scheduleQuote("edit", delay);
    if (upscaleOpen) scheduleQuote("upscale", delay);
  }
  function changed(delay = 400) {
    runError = "";
    emit();
    requote(delay);
  }
  function addVersion(
    s: EditorSession,
    data: Omit<EditorVersion, "id" | "url">,
  ) {
    if (disposed) throw new DOMException("编辑器已关闭", "AbortError");
    const v: EditorVersion = {
      ...data,
      id: s.nextId++,
      url: URL.createObjectURL(data.blob),
    };
    s.versions.push(v);
    while (s.versions.length > 30) {
      const old = s.versions.find(
        (x) => x.id !== s.baseId && x.id !== s.viewId && x !== v,
      );
      if (!old) break;
      s.versions.splice(s.versions.indexOf(old), 1);
      URL.revokeObjectURL(old.url);
    }
    return v;
  }
  function setBase(id: number) {
    if (busy || preparing || !current.versions.some((v) => v.id === id)) return;
    current.baseId = current.viewId = id;
    changed(0);
  }
  function view(id: number) {
    if (!current.versions.some((v) => v.id === id)) return;
    current.viewId = id;
    emit();
    if (upscaleOpen) scheduleQuote("upscale");
  }
  async function addSource(blob: Blob, name = "图片") {
    if (busy || preparing) return;
    const existing = current.versions.find((v) => v.blob === blob);
    if (existing) {
      setBase(existing.id);
      return;
    }
    const rev = ++readSequence,
      s = current;
    reading = true;
    runError = "";
    requote();
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type))
        throw new Error("仅支持 PNG、JPEG、WebP");
      if (!blob.size || blob.size > 8 * 1024 * 1024)
        throw new Error("底图需在 8MB 以内");
      const size = await decodeImage(blob);
      if (size.width * size.height > 32_000_000)
        throw new Error("底图最多 3200 万像素");
      if (rev !== readSequence || s !== current || disposed) return;
      const v = addVersion(s, {
        kind: "source",
        blob,
        name,
        ...size,
        parentId: 0,
      });
      reading = false;
      setBase(v.id);
    } catch (e) {
      if (rev === readSequence) runError = failure(e);
    } finally {
      if (rev === readSequence) {
        reading = false;
        emit();
        requote(0);
      }
    }
  }
  async function run(key: Job = "edit") {
    if (
      busy ||
      preparing ||
      reading ||
      !jobs[key].quote ||
      services.data.phase !== "ready"
    )
      return;
    const shownCost = jobs[key].quote!.cost;
    preparing = true;
    emit();
    let p: Awaited<ReturnType<typeof payload>>;
    try {
      p = await payload(key);
    } catch (e) {
      jobs[key].error = failure(e);
      preparing = false;
      emit();
      return;
    }
    if (!open || disposed) {
      preparing = false;
      return;
    }
    preparing = false;
    busy = true;
    running = p.mode;
    runError = "";
    startedAt = Date.now();
    upscaleOpen = false;
    cancelQuote("edit");
    cancelQuote("upscale");
    const controller = (taskAbort = new AbortController());
    emit();
    try {
      const result = await services.runTask(
        {
          id: crypto.randomUUID(),
          workspace: "editor",
          sessionId: p.owner.id,
          snapshot: p.payload,
        },
        async (task) => {
          const gateway = task.gateway(p.model.connection);
          await gateway.catalog();
          const output = await gateway.execute(
            p.payload,
            (r, n, s) => consumeMedia(r, n, s, p.payload),
            {
              shownCost,
              onNotice: (n) => ui.toast(n),
              signal: controller.signal,
            },
          );
          task.signal.throwIfAborted();
          let last: EditorVersion | undefined;
          for (const block of output.value) {
            if (block.type !== "image") continue;
            const { init_image, mask_image, ...settings } = p.payload;
            const params: Fields =
              p.mode === "upscale"
                ? { model: p.model.id, tool: "upscale", via: output.via }
                : ({ ...settings, tool: p.mode, via: output.via } as Fields);
            last = addVersion(p.owner, {
              kind: "result",
              blob: block.blob,
              ...block.size,
              parentId: p.parent.id,
              mode: p.mode,
              model: p.model,
              quote: output.quote ?? undefined,
              params,
              name: `${stem(p.parent.name)}-${modeNames[p.mode]}-${++p.owner.resultCount}.${block.blob.type === "image/jpeg" ? "jpg" : block.blob.type.split("/")[1]}`,
            });
            if (p.owner.origin === "image")
              try {
                await drawing.addExternal(
                  last.blob,
                  block.size,
                  params,
                  output.quote as Fields,
                  output.ms,
                );
              } catch {
                runError = `${modeNames[p.mode]}已完成，但未加入历史，请先下载`;
              }
          }
          if (last) {
            if (
              p.mode === "upscale" &&
              last.width <= p.parent.width &&
              last.height <= p.parent.height
            )
              ui.toast("放大后尺寸没有变化", "warn");
            p.owner.viewId = last.id;
            emit();
          }
        },
        controller.signal,
      );
      if (result.status !== "completed")
        throw new Error(
          result.status === "busy"
            ? "另一个绘图任务正在进行"
            : "数据维护中，请稍后再试",
        );
    } catch (e) {
      runError =
        e instanceof DOMException && e.name === "AbortError"
          ? "已停止等待，上游可能仍在处理"
          : failure(e);
    } finally {
      busy = false;
      taskAbort = undefined;
      emit();
      void refreshQuota();
      void drawing.refreshQuota(true);
      requote(0);
    }
  }
  const stopConnect = services.connections.subscribe(() => {
    if (open) void catalog();
  });
  const unregister = services.data.register({
    async flush() {},
    async reload() {
      cancelQuote("edit");
      cancelQuote("upscale");
    },
    ready() {
      if (open && !disposed) void catalog();
    },
  });
  const leave = (e: BeforeUnloadEvent) => {
    if (
      busy ||
      reading ||
      [...sessions.values()].some((s) => s.versions.length)
    ) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", leave);
  return {
    snapshot: () => ({
      session: {
        ...current,
        fields: { ...current.fields },
        versions: [...current.versions],
        chosen: { ...current.chosen },
        strength: { ...current.strength },
        noise: { ...current.noise },
        options: { ...current.options },
      },
      models,
      samplers,
      model: selected(),
      upscaleModel: selected("upscale"),
      base: base(),
      viewed: viewed(),
      quota,
      open,
      upscaleOpen,
      busy,
      reading,
      preparing,
      runError,
      running,
      startedAt,
      edit: {
        quote: jobs.edit.quote,
        error: jobs.edit.error,
        price: jobs.edit.price,
      },
      upscale: {
        quote: jobs.upscale.quote,
        error: jobs.upscale.error,
        price: jobs.upscale.price,
      },
      warning: warning("edit"),
      upscaleWarning: warning("upscale"),
    }),
    get session() {
      return current;
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setMaskPort(port: typeof maskPort) {
      maskPort = port;
    },
    changed,
    run,
    addSource,
    setBase,
    view,
    refreshQuota,
    async open(
      origin: "image" | "chat",
      blob?: Blob,
      name?: string,
      options: {
        mode?: EditorMode;
        settings?: Fields;
        conversationId?: string;
      } = {},
    ) {
      if (busy || preparing) {
        router.openOverlay("editor");
        return;
      }
      if (origin === "chat") await chat.start();
      maskPort?.save();
      const id =
        origin === "chat"
          ? `chat:${options.conversationId || chat.snapshot().current.id}`
          : "image";
      current =
        sessions.get(id) ||
        session(
          id,
          origin,
          options.conversationId ||
            (origin === "chat" ? chat.snapshot().current.id : undefined),
        );
      sessions.set(id, current);
      open = true;
      upscaleOpen = false;
      router.openOverlay("editor");
      emit();
      const revision = ++openSequence;
      await catalog();
      if (revision !== openSequence || !open) return;
      const form = drawing.snapshot().form;
      const settings: Fields | null =
        options.settings ||
        (!current.initialized && origin === "image"
          ? { ...form, negative_prompt: form.negative }
          : null);
      if (settings && options.mode !== "upscale") {
        for (const key of [
          "prompt",
          "negative_prompt",
          "sampler",
          "steps",
          "scale",
        ] as const)
          if (settings[key] != null)
            Object.assign(current.fields, { [key]: settings[key] });
        if (settings.seed != null)
          current.fields.seed =
            Number(settings.seed) >= 0 ? String(settings.seed) : "";
        for (const mode of ["img2img", "inpaint"] as const) {
          const m = resolveModel(
            editorModels({ models }, mode),
            String(settings.model || ""),
          );
          if (m) current.chosen[mode] = m.id;
        }
        current.initialized = true;
      }
      if (options.mode === "inpaint" || options.mode === "img2img")
        current.mode = options.mode;
      normalize();
      emit();
      if (blob) await addSource(blob, name);
      if (revision !== openSequence || !open) return;
      if (options.mode === "upscale" && viewed()) {
        upscaleOpen = true;
        emit();
        scheduleQuote("upscale", 0);
      }
      requote(0);
    },
    activate() {
      if (!open) {
        open = true;
        emit();
        void catalog();
      }
    },
    close() {
      if (busy || preparing) {
        ui.toast("正在运行，请先停止");
        return false;
      }
      maskPort?.save();
      open = false;
      upscaleOpen = false;
      ++openSequence;
      cancelQuote("edit");
      cancelQuote("upscale");
      emit();
      return true;
    },
    cancel() {
      taskAbort?.abort(new DOMException("已取消", "AbortError"));
    },
    patch(values: Partial<EditorSession["fields"]>) {
      if (busy || reading || preparing) return;
      Object.assign(current.fields, values);
      changed();
    },
    setMode(mode: EditMode) {
      if (busy || preparing) return;
      if (mode === "inpaint" && current.viewId !== current.baseId)
        setBase(current.viewId);
      current.mode = mode;
      normalize();
      changed(0);
    },
    setNumber(key: "strength" | "noise", value: number) {
      if (busy || preparing) return;
      current[key][current.mode] = value;
      changed();
    },
    setModel(id: string, mode: EditorMode = current.mode) {
      if (busy || preparing) return;
      current.chosen[mode] = id;
      normalize();
      changed(mode === "upscale" ? 0 : 400);
    },
    setOption(key: string, value: string) {
      const m = selected("upscale");
      if (!m || busy) return;
      current.options[m.id] = {
        ...(current.options[m.id] || normalizeOptions(m)),
        [key]: value,
      };
      changed();
    },
    upscaleToggle(value: boolean) {
      upscaleOpen = value;
      emit();
      if (value) scheduleQuote("upscale", 0);
      else cancelQuote("upscale");
    },
    retry(key: Job) {
      scheduleQuote(key, 0);
    },
    remove(id: number) {
      if (busy || id === current.baseId) return;
      const v = current.versions.find((v) => v.id === id);
      if (!v) return;
      current.versions = current.versions.filter((item) => item !== v);
      URL.revokeObjectURL(v.url);
      if (current.viewId === id) current.viewId = current.baseId;
      changed();
    },
    async useResult() {
      const v = viewed();
      if (!v || current.origin !== "chat" || busy) return;
      try {
        await chat.useEditorResult(current.conversationId!, {
          blob: v.blob,
          name: v.name,
          size: { width: v.width, height: v.height },
        });
        if (this.close()) router.closeOverlay();
      } catch (e) {
        runError = failure(e);
        emit();
      }
    },
    dispose() {
      disposed = true;
      taskAbort?.abort();
      catalogAbort?.abort();
      cancelQuote("edit");
      cancelQuote("upscale");
      stopConnect();
      unregister();
      window.removeEventListener("beforeunload", leave);
      for (const s of sessions.values())
        for (const v of s.versions) URL.revokeObjectURL(v.url);
      listeners.clear();
    },
  };
}
export type Editor = ReturnType<typeof createEditor>;
