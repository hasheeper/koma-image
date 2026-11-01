import type { ConnectionContext } from "../services/connections.ts";
import { parseComfySystem } from "../domain/comfy-system.ts";
import { profileFor } from "./profile.ts";
import { authHeaders, errorMessage } from "./transport.ts";

export async function readComfySystem(context: ConnectionContext, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const profile = profileFor(context.connection.profileId);
  if (profile.protocol !== "comfyui-workflow") throw new Error("当前连接不是 ComfyUI");
  signal.throwIfAborted(); context.assertCurrent();
  const response = await fetcher(`${context.connection.baseUrl}/system_stats`, {
    headers: { Accept: "application/json", ...authHeaders(context, profile) }, signal,
    cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
  });
  const body: unknown = await response.json().catch(() => null);
  signal.throwIfAborted(); context.assertCurrent();
  if (!response.ok) throw new Error(errorMessage(body, `读取运行状态失败 (${response.status})`));
  return parseComfySystem(body);
}
