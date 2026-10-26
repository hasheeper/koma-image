import { inject } from "vue";
import type { InjectionKey } from "vue";
import type { Bridge } from "../bridge/service.ts";
export const bridgeKey: InjectionKey<Bridge> = Symbol("bridge");
export function useBridge() {
  const bridge = inject(bridgeKey);
  if (!bridge) throw new Error("协同服务不可用");
  return bridge;
}
