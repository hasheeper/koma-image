import { inject } from "vue";
import type { InjectionKey } from "vue";
import type { Ask } from "../ask/service";
export const askKey: InjectionKey<Ask> = Symbol("ask");
export function useAsk(): Ask {
  const ask = inject(askKey);
  if (!ask) throw new Error("ASK unavailable");
  return ask;
}
