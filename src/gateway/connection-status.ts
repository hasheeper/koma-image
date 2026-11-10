import { configuredModels } from "../domain/models.ts";
import { catalogEntries, linkFor, sourceState } from "../domain/catalog.ts";
import type { Routing } from "../config/connections.ts";
import { hasOptionalImageCatalog, profileFor } from "./profile.ts";
import type { GatewayProfile } from "./profile.ts";
import { GatewayRequestError } from "./transport.ts";

export interface ConnectionStatus {
  s: string;
  text: string;
  label?: string;
  kind?: "catalog-limited";
}

export function catalogLimitedStatus(text: string): ConnectionStatus {
  return { s: "warn", text, kind: "catalog-limited" };
}

export function catalogFailureStatus(profile: GatewayProfile, error: unknown): ConnectionStatus {
  const text = error instanceof Error ? error.message : String(error);
  if (hasOptionalImageCatalog(profile) && error instanceof GatewayRequestError &&
      (error.kind === "network" || error.status === 404))
    return catalogLimitedStatus(`模型目录暂不可用，可手动填写模型 ID；${text}`);
  return { s: "err", text };
}

/** Directory evidence, configured sources and successful image requests are separate. */
export function connectionDisplayStatus(
  routing: Routing, id: string, raw: unknown, status?: ConnectionStatus, successfulModels: readonly string[] = [],
): ConnectionStatus | undefined {
  const c = routing.connections[id];
  if (!c || !status || !hasOptionalImageCatalog(profileFor(c.profileId)) ||
      (status.kind !== "catalog-limited" && status.s !== "ok")) return status;
  const entries = catalogEntries(raw);
  const models = configuredModels(routing).filter(m => sourceState(routing, id, m, entries) === "on");
  const count = models.length;
  if (!count && profileFor(c.profileId).reasoning) return status;
  if (!count) return { ...status, s: "wait", label: "等待配置", text: `尚未启用图像模型，请添加模型来源。${status.text}` };
  const generated = models.some(m => successfulModels.includes(linkFor(routing, id, m, entries)!.id));
  if (status.s === "ok" || generated)
    return { ...status, s: "ok", label: `连接成功 · ${count} 个模型`,
      text: `已启用 ${count} 个图像模型。${generated ? "此连接已成功完成图像请求。" : "已通过目录读取验证；实际生成权限与费用由供应商决定。"}` };
  return { ...status, s: "wait", label: `已配置 · ${count} 个模型`,
    text: `已启用 ${count} 个图像模型，尚未验证生成。${status.text}` };
}
