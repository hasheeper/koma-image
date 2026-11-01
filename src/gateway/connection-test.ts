import { object } from "../domain/value.ts";
import type { ConnectionContext } from "../services/connections.ts";
import { profileFor, profilePath } from "./profile.ts";
import { endpoint, authHeaders, errorMessage } from "./transport.ts";
import { nativeCatalog, novelaiConnectionLabel } from "./native-protocols.ts";
export async function testConnection(
  context: ConnectionContext,
  fetcher: typeof fetch = fetch,
  timeout = 10_000,
) {
  const profile = profileFor(context.connection.profileId),
    url = endpoint(
      context.connection.baseUrl,
      profilePath(profile, "catalog"),
      profile,
    );
  const comfy = profile.protocol === "comfyui-workflow";
  context.assertCurrent();
  try {
    const response = await fetcher(url, {
      headers: {
        Accept: "application/json",
        ...authHeaders(context, profile),
      },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(timeout),
    });
    context.assertCurrent();
    const data = await response.json().catch(() => null);
    if (response.status === 401)
      return { s: "err", text: "Key 无效" };
    if (response.status === 403)
      return { s: "err", text: object(data).cloudflare_error === true
        ? errorMessage(data) : "访问被拒绝（403），请检查 Key 权限" };
    if (response.status >= 500)
      return { s: "warn", text: `供应商暂时不可用（${response.status}）` };
    if (response.status === 404 || !data) return { s: "err", text: comfy
      ? "该地址未返回 ComfyUI API 信息，请填写 API 根地址，而非终端登录页面"
      : "地址错误" };
    if (!response.ok)
      return { s: "err", text: `请求失败（${response.status}）` };
    if (profile.protocol === "comfyui-workflow") {
      return object(data).system && Array.isArray(object(data).devices)
        ? { s: "ok", text: "ComfyUI 可达 · 工作流尚未执行" }
        : { s: "err", text: "该地址未返回 ComfyUI 系统信息" };
    }
    if (profile.protocol && profile.protocol !== "standard") {
      try {
        const catalog = nativeCatalog(profile, data);
        return { s: "ok", text: profile.protocol === "novelai" ? novelaiConnectionLabel(catalog)
          : `可用，共 ${Object.keys(catalog.models).length} 个模型 ID${profile.reasoning ? " · 推理尚未实测" : ""}` };
      } catch (error) {
        return { s: "err", text: error instanceof Error ? error.message : "接口协议不匹配" };
      }
    }
    const count = Object.keys(object(object(data).models)).length,
      features = object(object(data).studio_features);
    if (
      !count ||
      (profile.catalog.requireCostCeiling && features.max_cost !== true) ||
      !(Number(features.version) >= profile.catalog.minimumVersion)
    )
      return { s: "err", text: "该地址不支持所需的网关报价保护协议" };
    return { s: "ok", text: `可用，共 ${count} 个模型` };
  } catch (error) {
    context.assertCurrent();
    if (error instanceof DOMException && error.name === "TimeoutError")
      return { s: "warn", text: comfy ? "ComfyUI 连接超时，请检查服务或转发通道" : "连接超时" };
    if (context.localToken)
      return { s: "err", text: "本地代理连接失败，请检查服务端配置" };
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
      if (comfy) return { s: "err", text: ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ? "无法连接本机 ComfyUI；请确认服务或转发通道已启动，并允许浏览器访问本地网络"
        : "无法连接 ComfyUI；请检查 API 地址、服务状态及浏览器访问限制" };
      return { s: "err", text: "网络不可达或域名错误" };
    }
    if (comfy) return { s: "err", text: "浏览器无法读取 ComfyUI 响应；请在服务或代理中允许当前 Koma 页面的来源（CORS）" };
    return { s: "err", text: profile.protocol && profile.protocol !== "standard"
      ? "该地址不允许网页直接调用，请检查服务端 CORS 配置"
      : "该地址不允许网页直接调用，可改用本地代理" };
  }
}
