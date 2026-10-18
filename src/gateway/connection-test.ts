import { object } from "../domain/value.ts";
import type { ConnectionContext } from "../services/connections.ts";
import { profileFor } from "./profile.ts";
import { endpoint } from "./transport.ts";
export async function testConnection(
  context: ConnectionContext,
  fetcher: typeof fetch = fetch,
  timeout = 10_000,
) {
  const profile = profileFor(context.connection.profileId),
    url = endpoint(
      context.connection.baseUrl,
      profile.transport.paths.catalog,
      profile,
    );
  context.assertCurrent();
  try {
    const response = await fetcher(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${context.key()}`,
      },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(timeout),
    });
    context.assertCurrent();
    if ([401, 403].includes(response.status))
      return { s: "err", text: "Key 无效" };
    if (response.status >= 500)
      return { s: "warn", text: `供应商暂时不可用（${response.status}）` };
    const data = await response.json().catch(() => null);
    if (response.status === 404 || !data) return { s: "err", text: "地址错误" };
    if (!response.ok)
      return { s: "err", text: `请求失败（${response.status}）` };
    const count = Object.keys(object(object(data).models)).length,
      features = object(object(data).studio_features);
    if (
      !count ||
      features.max_cost !== true ||
      !(Number(features.version) >= profile.catalog.minimumVersion)
    )
      return { s: "err", text: "该地址不支持所需的网关报价保护协议" };
    return { s: "ok", text: `可用，共 ${count} 个模型` };
  } catch (error) {
    context.assertCurrent();
    if (error instanceof DOMException && error.name === "TimeoutError")
      return { s: "warn", text: "连接超时" };
    try {
      await fetcher(url, {
        mode: "no-cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      return { s: "err", text: "网络不可达或域名错误" };
    }
    return { s: "err", text: "该地址不允许网页直接调用，可改用本地代理" };
  }
}
