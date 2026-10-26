import { inject } from "vue";
import type { InjectionKey } from "vue";
import type { Slates } from "../slate/service.ts";
export const slateKey: InjectionKey<Slates> = Symbol("slate");
export function useSlates() { const value = inject(slateKey); if (!value) throw new Error("任务服务未就绪"); return value; }
