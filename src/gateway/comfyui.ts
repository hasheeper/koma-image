import { injectWorkflow, comfyParameterSpec } from "../domain/comfy-workflow.ts";
import { comfyRoutes, resolveComfyRoute } from "../domain/comfy-workflows.ts";
import { comfyControlSpec, parseComfyNodeInfo } from "../domain/comfy-controls.ts";
import { comfyModelFiles } from "../domain/comfy-models.ts";
import type { ComfyNodeInfo } from "../domain/comfy-controls.ts";
import type { Connection } from "../config/connections.ts";
import type { ConnectionContext } from "../services/connections.ts";
import type { Catalog } from "../domain/catalog.ts";
import type { ImagePayload } from "./routes.ts";
import { object } from "../domain/value.ts";
import { authHeaders, errorMessage } from "./transport.ts";
import { profileFor } from "./profile.ts";

export function comfyCatalog(connection: Readonly<Connection>): Catalog {
  return { models: comfyRoutes(connection).map(({ id, entry, model, config }) => ({ id, upstreamId: id, connection: connection.id, profileId: connection.profileId, sourceRevision: connection.revision,
    name: model?.name || entry.name, comfyWorkflowName: entry.name, comfyModelName: model?.name,
    description: `${connection.name} · ${entry.name}`, provider: "comfyui", family: "comfyui", comfyNegative: !!config.bindings.negative, comfyParameters: comfyParameterSpec(config), comfyControls: comfyControlSpec(config), comfyModelFiles: model ? [model.file] : comfyModelFiles(config),
    maxPixels: Number.MAX_SAFE_INTEGER, sourceMaxPixels: 0, operations: ["generate"], tools: [], replaces: [], fields: {}, maxImages: 0, chat: false, transparentBackground: false, unmetered: false })),
    features: {}, defaults: {}, samplers: [] };
}
export async function readComfyNodeInfo(context: ConnectionContext, classes: string[], signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ComfyNodeInfo> {
  const profile = profileFor(context.connection.profileId);
  if (profile.protocol !== "comfyui-workflow") throw new Error("当前连接不是 ComfyUI 工作流");
  const result: ComfyNodeInfo = {};
  for (const classType of new Set(classes)) {
    signal.throwIfAborted(); context.assertCurrent();
    const response = await fetcher(`${context.connection.baseUrl}/object_info/${encodeURIComponent(classType)}`, {
      headers: {Accept:"application/json",...authHeaders(context,profile)}, signal:AbortSignal.any([signal,AbortSignal.timeout(10_000)]),
      cache:"no-store",credentials:"omit",redirect:"error",referrerPolicy:"no-referrer",
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(errorMessage(body,`读取节点选项失败 (${response.status})`));
    Object.assign(result,parseComfyNodeInfo(body,classType));
  }
  context.assertCurrent(); signal.throwIfAborted();
  return result;
}
class TransientRead extends Error {}
const transientStatus = (status: number) => [502, 503, 504].includes(status);
function delay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
/** One submission; only reads may retry. The caller owns the overall task deadline. */
export async function executeComfy<T>(context: ConnectionContext, payload: ImagePayload,
  consume: (response: Response, native: boolean, signal: AbortSignal) => Promise<T>, signal: AbortSignal, fetcher: typeof fetch = fetch,
  timing = { pollMs: 1000, readMs: 10_000, cancelMs: 3000 }) {
  if (payload.tool) throw new Error("ComfyUI 工作流仅支持本连接的文生图");
  const { config } = resolveComfyRoute(context.connection, payload.model);
  const workflow = injectWorkflow(config, String(payload.prompt ?? ""), String(payload.negative_prompt ?? ""), Number(payload.seed), payload.comfyParameters, payload.comfyControls);
  const profile = profileFor(context.connection.profileId);
  // Freeze credentials and destination. Further submissions still validate endpoint identity.
  context.assertCurrent();
  const headers = { ...authHeaders(context, profile), "Content-Type": "application/json" };
  const request = (path: string, s: AbortSignal, body?: unknown) => fetcher(`${context.connection.baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST", headers, signal: s, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
  });
  let promptId: string | undefined, cancelled = false;
  const cancel = () => {
    if (!promptId || cancelled) return;
    cancelled = true;
    // This request must survive the local task abort; never interrupt a shared executor.
    void request("/queue", AbortSignal.timeout(timing.cancelMs), { delete: [promptId] }).then(r => r.body?.cancel()).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  async function read<T>(path: string, parse: (r: Response) => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    context.assertCurrent();
    const timed = AbortSignal.any([signal, AbortSignal.timeout(timing.readMs)]);
    try {
      const response = await request(path, timed);
      if (transientStatus(response.status)) { await response.body?.cancel(); throw new TransientRead(`ComfyUI 暂时不可用 (${response.status})`); }
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => null), `ComfyUI 请求失败 (${response.status})`));
      return await parse(response);
    } catch (e) {
      signal.throwIfAborted();
      if (timed.aborted || e instanceof TypeError) throw new TransientRead("ComfyUI 读取超时或连接中断");
      throw e;
    }
  }
  try {
    signal.throwIfAborted();
    let submitted: Response;
    try { submitted = await request("/prompt", signal, { prompt: workflow }); }
    catch (e) { signal.throwIfAborted(); throw new Error("提交结果未知，上游可能仍在处理；请勿重复提交", { cause: e }); }
    let body: Record<string, unknown>;
    try { body = object(await submitted.json()); }
    catch { throw new Error("提交结果未知，上游可能仍在处理；未取得任务 ID"); }
    if (!submitted.ok || body.error) throw new Error(errorMessage(body, submitted.status >= 500 ? `提交结果未知，上游可能仍在处理 (${submitted.status})` : `ComfyUI 提交失败 (${submitted.status})`));
    if (typeof body.prompt_id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.prompt_id)) throw new Error("提交结果未知，上游可能仍在处理；未取得任务 ID");
    promptId = body.prompt_id;
    if (signal.aborted) cancel();
    signal.throwIfAborted();
    let failures = 0;
    while (true) {
      let history: Record<string, unknown>;
      try {
        history = await read(`/history/${encodeURIComponent(promptId)}`, async r => {
          const data: unknown = await r.json();
          if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("ComfyUI 历史响应格式无效");
          return data as Record<string, unknown>;
        });
        failures = 0;
      } catch (e) {
        if (!(e instanceof TransientRead) || ++failures >= 3) throw e;
        await delay(timing.pollMs, signal); continue;
      }
      if (Object.hasOwn(history, promptId)) {
        const entry = object(history[promptId]), status = object(entry.status);
        if (!entry.outputs || !entry.status || typeof status.status_str !== "string") throw new Error("ComfyUI 任务记录格式无效");
        if (status.status_str === "error") {
          const messages = Array.isArray(status.messages) ? status.messages : [];
          const failure = [...messages].reverse().find(m => Array.isArray(m) && ["execution_error", "execution_interrupted"].includes(m[0]));
          const detail = object(Array.isArray(failure) ? failure[1] : null);
          throw new Error(`ComfyUI 执行失败${detail.node_id ? ` · 节点 ${String(detail.node_id)}` : ""}：${String(detail.exception_message || "任务失败或已中断").slice(0, 1000)}`);
        }
        const images = object(object(entry.outputs)[config.bindings.output]).images;
        const first = object(Array.isArray(images) ? images[0] : null);
        if (typeof first.filename === "string" && first.filename && typeof first.subfolder === "string" && ["output", "temp", "input"].includes(String(first.type))) {
          const query = new URLSearchParams({ filename: first.filename, subfolder: first.subfolder, type: String(first.type) });
          let blob: Blob | undefined;
          for (let attempt = 0; attempt < 3; attempt++) {
            try { blob = await read(`/view?${query}`, r => r.blob()); break; }
            catch (e) { if (!(e instanceof TransientRead) || attempt === 2) throw e; await delay(timing.pollMs, signal); }
          }
          if (!blob?.size || !/^image\/(png|jpeg|webp)$/.test(blob.type)) throw new Error("ComfyUI 未返回有效的 PNG／JPEG／WebP 原图");
          const value = await consume(new Response(blob, { headers: { "Content-Type": blob.type } }), false, signal);
          signal.throwIfAborted();
          return { value, promptId };
        }
        if (status.completed === true || status.status_str === "success") throw new Error("工作流已完成，但所选输出节点没有有效图片");
      }
      await delay(timing.pollMs, signal);
    }
  } finally { signal.removeEventListener("abort", cancel); }
}
