import { normalizeBaseUrl } from "../config/connections.ts";
import { object } from "../domain/value.ts";
import type { ConnectionContext } from "../services/connections.ts";
import type { GatewayProfile } from "./profile.ts";

export const apiBase = (documentBase: string) => new URL("./api/", documentBase);
export function endpoint(baseUrl: string, path: string, profile: GatewayProfile) {
  if (!Object.values(profile.transport.paths).includes(path)) throw new Error("协议路径无效");
  return new URL(`${normalizeBaseUrl(baseUrl)}${path === profile.transport.paths.native ? "" : profile.transport.apiPrefix}${path}`);
}
export function errorMessage(data: unknown, fallback = "请求失败") {
  const obj = object(data), value = object(obj.error).message || obj.detail || obj.error || obj.message;
  return typeof value === "string" ? value.slice(0, 1000) : fallback;
}
export async function readJson(response: Response): Promise<Record<string, unknown>> {
  const data = object(await response.json().catch(() => null));
  if (!response.ok || data.error) throw new Error(errorMessage(data, `请求失败 (${response.status})`));
  return data;
}
export function createTransport(context: ConnectionContext, profile: GatewayProfile, fetcher: typeof fetch = fetch) {
  return {
    async request(path: string, options: { body?: unknown; signal?: AbortSignal; native?: boolean; stats?: boolean } = {}) {
      context.assertCurrent(); options.signal?.throwIfAborted();
      const url = endpoint(context.connection.baseUrl, path, profile);
      const headers: Record<string, string> = { Accept: "application/json, image/png, image/jpeg, image/webp" };
      const key = context.key();
      if (options.stats) {
        if (path !== profile.transport.paths.stats) throw new Error("查询认证只适用于额度统计");
        url.searchParams.set("days", "1"); url.searchParams.set(profile.auth.statsQueryKey, key);
      } else headers.Authorization = `Bearer ${key}`;
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (options.native) headers["X-Media-Provider"] = "novelai";
      // Credential-bearing redirects are never followed to a different endpoint.
      try {
        return await fetcher(url, { method: options.body === undefined ? "GET" : "POST", headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal,
          cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason;
        if (error instanceof TypeError) throw new Error("无法连接");
        throw error;
      }
    },
  };
}
