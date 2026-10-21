import { inject } from "vue";
import type { InjectionKey } from "vue";
import type { Ask } from "../ask/service";
/** Public mark for workspace entry buttons; internals stay behind this facade. */
export { default as AskMark } from "../ask/AskMark.vue";
export const askKey: InjectionKey<Ask> = Symbol("ask");
export function useAsk(): Ask {
  const ask = inject(askKey);
  if (!ask) throw new Error("ASK unavailable");
  return ask;
}
