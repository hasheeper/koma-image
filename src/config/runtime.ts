import { apiBase } from "../gateway/transport.ts";
import { object } from "../domain/value.ts";

export interface LocalGateway {
  readonly baseUrl: string;
  readonly token: string;
}
/** Only the local server supplies this marker. Static builds do not probe a server. */
export function readRuntime(document: Document): LocalGateway | undefined {
  const marker = document.getElementById("koma-runtime");
  if (!marker) return;
  const value = object(JSON.parse(marker.textContent || "null"));
  if (
    value.version !== 1 ||
    value.mode !== "local" ||
    typeof value.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.token)
  )
    throw new Error("本地服务配置无效，请重新启动服务");
  return Object.freeze({
    baseUrl: apiBase(document.baseURI).href.replace(/\/$/, ""),
    token: value.token,
  });
}
