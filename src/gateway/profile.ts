import { freeze } from "../domain/value.ts";

export const STANDARD_PROFILE_ID = "koma-standard-v1";
export type ProfilePath = "catalog" | "quota" | "stats" | "estimate" | "toolEstimate" | "generate" | "toolRun" | "native";
export interface GatewayProfile {
  readonly id: string;
  /** Without quotes the cost is unknown, never free. */
  readonly quote: { readonly supported: boolean; readonly debounce: { readonly image: number; readonly chat: number; readonly editor: number } };
  /** A declared ceiling means every execution is quoted first and carries the quoted cost. */
  readonly costCeiling?: { readonly field: string };
  readonly executionRoutes: { readonly nativeFree: boolean; readonly studio: boolean; readonly tools: boolean };
  readonly quotaPolicy: { readonly temporaryRemainingThreshold: number; readonly imageUsedWarningThreshold: number };
  readonly quotaPresentation: { readonly lowRatio: number; readonly criticalRatio: number };
  readonly catalog: { readonly minimumVersion: number; readonly requireCostCeiling: boolean };
  readonly auth: { readonly kind: "bearer"; readonly statsQueryKey?: string };
  readonly transport: {
    readonly apiPrefix: string;
    /** Only declared paths can be requested. */
    readonly paths: Readonly<Partial<Record<ProfilePath, string>>>;
    readonly nativeHeaders: Readonly<Record<string, string>>;
  };
}

/** Protocol declarations, never remote code or a vendor identity. */
export const standardProfile: GatewayProfile = freeze({
  id: STANDARD_PROFILE_ID,
  quote: { supported: true, debounce: { image: 650, chat: 650, editor: 400 } },
  costCeiling: { field: "max_cost" },
  executionRoutes: { nativeFree: true, studio: true, tools: true },
  quotaPolicy: { temporaryRemainingThreshold: 300, imageUsedWarningThreshold: 400 },
  quotaPresentation: { lowRatio: 0.25, criticalRatio: 0.1 },
  catalog: { minimumVersion: 2, requireCostCeiling: true },
  auth: { kind: "bearer", statsQueryKey: "api_key" },
  transport: { apiPrefix: "/v1", paths: {
    catalog: "/image/models", quota: "/media/quota", stats: "/token_stats_data",
    estimate: "/studio/image/estimate", toolEstimate: "/image/tools/estimate",
    generate: "/studio/image/generate", toolRun: "/image/tools/run", native: "/ai/generate-image",
  }, nativeHeaders: { "X-Media-Provider": "novelai" } },
});

/** Connections and backups naming any other protocol are rejected. */
const profiles: Readonly<Record<string, GatewayProfile>> = freeze({ [STANDARD_PROFILE_ID]: standardProfile });

export function profileFor(id: string): GatewayProfile {
  if (!Object.hasOwn(profiles, id)) throw new Error("连接协议不受支持");
  return profiles[id];
}
export function profilePath(profile: GatewayProfile, name: ProfilePath): string {
  const path = profile.transport.paths[name];
  if (!path) throw new Error("连接不支持本次操作");
  return path;
}
