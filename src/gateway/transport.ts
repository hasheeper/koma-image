import { normalizeBaseUrl } from "../config/connections.ts";
import { object } from "../domain/value.ts";
import type { ConnectionContext } from "../services/connections.ts";
import type { GatewayProfile, ProfilePath } from "./profile.ts";
import { validFalModelPath } from "./fal-models.ts";

export class GatewayRequestError extends Error {
  readonly kind: "http" | "network";
  readonly status?: number;
  constructor(message: string, kind: "http" | "network", status?: number) {
    super(message);
    this.name = "GatewayRequestError";
    this.kind = kind;
    this.status = status;
  }
}

export const apiBase = (documentBase: string) =>
  new URL("./api/", documentBase);
export function endpoint(
  baseUrl: string,
  path: string,
  profile: GatewayProfile,
  model?: string,
  operation?: ProfilePath,
  taskId?: string,
) {
  if (!Object.values(profile.transport.paths).includes(path))
    throw new Error("协议路径无效");
  if (profile.transport.fixedBaseUrl && normalizeBaseUrl(baseUrl) !== profile.transport.fixedBaseUrl)
    throw new Error("此协议使用固定的公开 API 地址");
  if (operation && profile.transport.paths[operation] !== path) throw new Error("接口操作与路径不匹配");
  const matching = Object.entries(profile.transport.paths).filter(([, value]) => value === path);
  const name = operation ?? (matching.length === 1 ? matching[0][0] as ProfilePath : undefined);
  let base = normalizeBaseUrl((name && profile.transport.pathBases?.[name]) || baseUrl);
  const apiPrefix = profile.transport.apiPrefix;
  const prefix = path === profile.transport.paths.native ? "" : apiPrefix;
  // Accept a service root or its version prefix without duplicating /v1 or /api/v3.
  if (apiPrefix && base.endsWith(apiPrefix))
    base = base.slice(0, -apiPrefix.length);
  if (profile.transport.rootPrefix && new URL(base).pathname === "/")
    base += profile.transport.rootPrefix;
  const statusPath = path === profile.transport.paths.imageTask || path === profile.transport.paths.imageResult;
  if (taskId !== undefined && (!statusPath || !/^[\w-]{1,128}$/.test(taskId))) throw new Error("任务查询参数无效");
  const taskTemplate = path.includes("{taskId}");
  if (taskTemplate) {
    if (!taskId) throw new Error("缺少任务 ID");
    path = path.replace("{taskId}", encodeURIComponent(taskId));
  }
  if (path.includes("{model}")) {
    if (!model?.trim() || model === "." || model === ".." || model.length > 512 || /[\x00-\x1f\x7f]/.test(model))
      throw new Error("模型 ID 无效");
    if (profile.protocol === "fal-queue" && !validFalModelPath(model)) throw new Error("fal 模型路径无效");
    path = path.replace("{model}", profile.protocol === "fal-queue" ? model : encodeURIComponent(model));
  }
  const url = new URL(`${base}${prefix}${path}`);
  if (taskId && !taskTemplate) url.searchParams.set("taskId", taskId);
  if (profile.protocol === "gemini-native" && path === profile.transport.paths.catalog)
    url.searchParams.set("pageSize", "1000");
  if (profile.protocol === "anthropic-messages" && path === profile.transport.paths.catalog)
    url.searchParams.set("limit", "1000");
  return url;
}
export function authHeaders(context: ConnectionContext, profile: GatewayProfile): Record<string, string> {
  return context.localToken ? { "X-Koma-Local-Token": context.localToken }
    : profile.auth.kind === "google-key" ? { "x-goog-api-key": context.key() }
      : profile.auth.kind === "anthropic-key" ? { "x-api-key": context.key(), ...profile.auth.headers }
        : profile.auth.kind === "fal-key" ? { Authorization: `Key ${context.key()}` }
        : { Authorization: `Bearer ${context.key()}` };
}
export function errorMessage(data: unknown, fallback = "请求失败") {
  const obj = object(data);
  if (obj.cloudflare_error === true) return "请求被 Cloudflare 拦截，请检查网络或浏览器";
  const value = object(obj.error).message || obj.detail || obj.error || obj.message;
  return typeof value === "string" ? value.slice(0, 1000) : fallback;
}
export async function readJson(
  response: Response,
  describeError = errorMessage,
): Promise<Record<string, unknown>> {
  const data = object(await response.json().catch(() => null));
  if (response.status === 401) throw new GatewayRequestError("鉴权失败（401），请检查 API Key", "http", 401);
  if (!response.ok || data.error)
    throw new GatewayRequestError(describeError(data, `请求失败 (${response.status})`), "http", response.status);
  return data;
}
export function createTransport(
  context: ConnectionContext,
  profile: GatewayProfile,
  fetcher: typeof fetch = fetch,
) {
  type RequestOptions = {
    body?: unknown;
    signal?: AbortSignal;
    native?: boolean;
    stats?: boolean;
    model?: string;
    operation?: ProfilePath;
    stream?: boolean;
    taskId?: string;
  };
  async function send(url: URL, options: RequestOptions, path?: string) {
    context.assertCurrent();
    options.signal?.throwIfAborted();
    const headers: Record<string, string> = {
      Accept: options.stream
        ? "text/event-stream, application/json"
        : "application/json, image/png, image/jpeg, image/webp",
    };
    const key = context.localToken ? undefined : context.key();
    if (context.localToken)
      headers["X-Koma-Local-Token"] = context.localToken;
    if (options.stats) {
      const queryKey = profile.auth.statsQueryKey;
      if (path !== profile.transport.paths.stats || !queryKey)
        throw new Error("查询认证只适用于额度统计");
      url.searchParams.set("days", "1");
      if (key) url.searchParams.set(queryKey, key);
    } else Object.assign(headers, authHeaders(context, profile));
    const multipart = typeof FormData !== "undefined" && options.body instanceof FormData;
    if (options.body !== undefined && !multipart)
      headers["Content-Type"] = "application/json";
    if (options.native)
      Object.assign(headers, profile.transport.nativeHeaders);
    // Credential-bearing redirects are never followed to a different endpoint.
    try {
      return await fetcher(url, {
        method: options.body === undefined ? "GET" : "POST",
        headers,
        body:
          options.body === undefined
            ? undefined
            : multipart ? options.body as FormData : JSON.stringify(options.body),
        signal: options.signal,
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
      });
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (error instanceof TypeError) throw new GatewayRequestError("无法连接", "network");
      throw error;
    }
  }
  return {
    async request(path: string, options: RequestOptions = {}) {
      return send(endpoint(context.connection.baseUrl, path, profile, options.model, options.operation, options.taskId), options, path);
    },
    // The queue can return its parent model path instead of the submission path. Only follow
    // the requested job on this connection; a response cannot choose a new credential destination.
    async falQueueLink(location: unknown, taskId: string, kind: 'status' | 'result', signal: AbortSignal) {
      const base = new URL(normalizeBaseUrl(context.connection.baseUrl) + '/');
      const url = typeof location === 'string' ? URL.parse(location, base) : null;
      const tail = '/requests/' + taskId + (kind === 'status' ? '/status' : '');
      if (profile.protocol !== 'fal-queue' || !/^[\w-]{1,128}$/.test(taskId) ||
          !url || url.origin !== base.origin || url.username || url.password || url.hash ||
          !url.pathname.startsWith(base.pathname) || !url.pathname.endsWith(tail) ||
          !validFalModelPath(url.pathname.slice(base.pathname.length, -tail.length))) {
        throw new Error('队列返回的任务地址与本连接不匹配，请检查任务查询和结果后缀');
      }
      return send(url, { signal });
    },
  };
}
