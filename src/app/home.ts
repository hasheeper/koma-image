import { inject, onScopeDispose, shallowRef } from "vue";
import type { InjectionKey } from "vue";
import type { Home } from "../home/service.ts";
export const homeKey: InjectionKey<Home> = Symbol("home");
export function useHome() {
  const home = inject(homeKey);
  if (!home) throw new Error("Home unavailable");
  const view = shallowRef(home.snapshot());
  const stop = home.subscribe(() => { view.value = home.snapshot(); });
  onScopeDispose(stop);
  return { home, view };
}
