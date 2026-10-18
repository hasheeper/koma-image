import { freeze } from "../domain/value.ts";

export const STANDARD_PROFILE_ID = "koma-standard-v1";
export interface GatewayProfile {
  readonly id: string;
  readonly quote: { readonly supported: boolean; readonly debounce: { readonly image: number; readonly chat: number; readonly editor: number } };
  readonly costCeiling: { readonly required: true; readonly field: "max_cost" };
  readonly executionRoutes: { readonly nativeFree: boolean; readonly studio: boolean; readonly tools: boolean };
  readonly quotaPolicy: { readonly temporaryRemainingThreshold: number; readonly imageUsedWarningThreshold: number };
  readonly quotaPresentation: { readonly lowRatio: number; readonly criticalRatio: number };
  readonly catalog: { readonly minimumVersion: number; readonly requireCostCeiling: true };
  readonly auth: { readonly kind: "bearer"; readonly statsQueryKey: "api_key" };
  readonly transport: { readonly apiPrefix: string; readonly paths: {
    readonly catalog: string; readonly quota: string; readonly stats: string;
    readonly estimate: string; readonly toolEstimate: string;
    readonly generate: string; readonly toolRun: string; readonly native: string;
  } };
}

/** Protocol declarations, never remote code or a vendor identity. */
export const standardProfile: GatewayProfile = freeze({
  id: STANDARD_PROFILE_ID,
  quote: { supported: true, debounce: { image: 650, chat: 650, editor: 400 } },
  costCeiling: { required: true, field: "max_cost" },
  executionRoutes: { nativeFree: true, studio: true, tools: true },
  quotaPolicy: { temporaryRemainingThreshold: 300, imageUsedWarningThreshold: 400 },
  quotaPresentation: { lowRatio: 0.25, criticalRatio: 0.1 },
  catalog: { minimumVersion: 2, requireCostCeiling: true },
  auth: { kind: "bearer", statsQueryKey: "api_key" },
  transport: { apiPrefix: "/v1", paths: {
    catalog: "/image/models", quota: "/media/quota", stats: "/token_stats_data",
    estimate: "/studio/image/estimate", toolEstimate: "/image/tools/estimate",
    generate: "/studio/image/generate", toolRun: "/image/tools/run", native: "/ai/generate-image",
  } },
});

export function profileFor(id: string): GatewayProfile {
  if (id !== STANDARD_PROFILE_ID) throw new Error("连接协议不受支持");
  return standardProfile;
}
