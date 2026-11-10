import { normalizeBaseUrl } from "../config/connections.ts";
import { object } from "../domain/value.ts";
import type { ConnectionContext } from "../services/connections.ts";
import type { GatewayProfile } from "./profile.ts";

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
) {
  if (!Object.values(profile.transport.paths).includes(path))
    throw new Error("协议路径无效");
  const name = Object.entries(profile.transport.paths).find(([, value]) => value === path)?.[0] as keyof typeof profile.transport.paths;
  let base = normalizeBaseUrl(profile.transport.pathBases?.[name] || baseUrl);
  const apiPrefix = profile.transport.apiPrefix;
  const prefix = path === profile.transport.paths.native ? "" : apiPrefix;
  // Accept a service root or its version prefix without duplicating /v1 or /api/v3.
  if (apiPrefix && base.endsWith(apiPrefix))
    base = base.slice(0, -apiPrefix.length);
  if (profile.transport.rootPrefix && new URL(base).pathname === "/")
    base += profile.transport.rootPrefix;
  if (path.includes("{model}")) {
    if (!model?.trim() || model.length > 512 || /[\x00-\x1f\x7f]/.test(model))
      throw new Error("模型 ID 无效");
    path = path.replace("{model}", encodeURIComponent(model));
  }
  const url = new URL(`${base}${prefix}${path}`);
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
): Promise<Record<string, unknown>> {
  const data = object(await response.json().catch(() => null));
  if (response.status === 401) throw new GatewayRequestError("鉴权失败（401），请检查 API Key", "http", 401);
  if (!response.ok || data.error)
    throw new GatewayRequestError(errorMessage(data, `请求失败 (${response.status})`), "http", response.status);
  return data;
}
export function createTransport(
  context: ConnectionContext,
  profile: GatewayProfile,
  fetcher: typeof fetch = fetch,
) {
  return {
    async request(
      path: string,
      options: {
        body?: unknown;
        signal?: AbortSignal;
        native?: boolean;
        stats?: boolean;
        model?: string;
        stream?: boolean;
      } = {},
    ) {
      context.assertCurrent();
      options.signal?.throwIfAborted();
      const url = endpoint(context.connection.baseUrl, path, profile, options.model);
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
    },
  };
}
