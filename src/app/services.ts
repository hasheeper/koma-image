import { inject } from "vue";
import type { InjectionKey } from "vue";
import type { ApplicationServices } from "../services/application.ts";
export const servicesKey: InjectionKey<ApplicationServices> = Symbol("application-services");
export function useServices(): ApplicationServices {
  const value = inject(servicesKey);
  if (!value) throw new Error("Application services are unavailable");
  return value;
}
