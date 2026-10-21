import { freeze } from "../domain/value.ts";

export const STANDARD_PROFILE_ID = "koma-standard-v1";
export type Protocol = "standard" | "openai-images" | "gemini-native" | "novelai" | "openai-chat" | "anthropic-messages";
export type ProfilePath = "catalog" | "quota" | "stats" | "estimate" | "toolEstimate" | "generate" | "toolRun" | "native" | "reasoning";
export interface GatewayProfile {
  readonly id: string;
  readonly protocol?: Protocol;
  readonly label?: string;
  /** Image work: catalog mappings, quotes and generation. */
  readonly image: boolean;
  /** Streaming tool calls with image input, used only by ASK. Never generates or charges media. */
  readonly reasoning?: { readonly cache: "implicit" | "breakpoints" };
  /** Without quotes the cost is unknown, never free. */
  readonly quote: { readonly supported: boolean; readonly debounce: { readonly image: number; readonly chat: number; readonly editor: number } };
  /** A declared ceiling means every execution is quoted first and carries the quoted cost. */
  readonly costCeiling?: { readonly field: string };
  readonly executionRoutes: { readonly nativeFree: boolean; readonly studio: boolean; readonly tools: boolean };
  readonly quotaPolicy: { readonly supported?: boolean; readonly temporaryRemainingThreshold: number; readonly imageUsedWarningThreshold: number };
  readonly quotaPresentation: { readonly lowRatio: number; readonly criticalRatio: number };
  readonly catalog: { readonly minimumVersion: number; readonly requireCostCeiling: boolean };
  readonly auth: {
    readonly kind: "bearer" | "google-key" | "anthropic-key";
    readonly statsQueryKey?: string;
    /** Fixed protocol headers that accompany the credential. */
    readonly headers?: Readonly<Record<string, string>>;
  };
  readonly transport: {
    readonly apiPrefix: string;
    /** Added only when the address is a bare service root, as SDK base URLs already carry their version. */
    readonly rootPrefix?: string;
    /** Only declared paths can be requested. */
    readonly paths: Readonly<Partial<Record<ProfilePath, string>>>;
    readonly nativeHeaders: Readonly<Record<string, string>>;
    /** Official protocols may separate the account and image hosts. */
    readonly pathBases?: Readonly<Partial<Record<ProfilePath, string>>>;
  };
}

/** Protocol declarations, never remote code or a vendor identity. */
export const standardProfile: GatewayProfile = freeze({
  id: STANDARD_PROFILE_ID,
  protocol: "standard", label: "Koma 标准网关", image: true,
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

const unquoted = {
  image: true,
  quote: { supported: false, debounce: { image: 650, chat: 650, editor: 400 } },
  executionRoutes: { nativeFree: false, studio: true, tools: true },
  quotaPolicy: { supported: false, temporaryRemainingThreshold: 0, imageUsedWarningThreshold: 0 },
  quotaPresentation: { lowRatio: 0.25, criticalRatio: 0.1 },
  catalog: { minimumVersion: 0, requireCostCeiling: false },
} as const;
export const openaiImagesProfile: GatewayProfile = freeze({
  ...unquoted, id: "openai-images-v1", protocol: "openai-images", label: "OpenAI Images",
  auth: { kind: "bearer" },
  transport: { apiPrefix: "/v1", paths: { catalog: "/models", generate: "/images/generations", toolRun: "/images/edits" }, nativeHeaders: {} },
});
export const geminiProfile: GatewayProfile = freeze({
  ...unquoted, id: "gemini-native-v1", protocol: "gemini-native", label: "Gemini 原生",
  auth: { kind: "google-key" },
  transport: { apiPrefix: "/v1beta", paths: { catalog: "/models", generate: "/models/{model}:generateContent", toolRun: "/models/{model}:generateContent" }, nativeHeaders: {} },
});
export const NOVELAI_IMAGE_URL = "https://image.novelai.net";
export const novelaiProfile: GatewayProfile = freeze({
  ...unquoted, id: "nai-official-v1", protocol: "novelai", label: "NovelAI 官方 · 基础接入",
  auth: { kind: "bearer" },
  transport: { apiPrefix: "", paths: { catalog: "/user/subscription", quota: "/user/subscription", generate: "/ai/generate-image", toolRun: "/ai/generate-image" }, nativeHeaders: {}, pathBases: { catalog: "https://api.novelai.net", quota: "https://api.novelai.net" } },
});
const reasoningOnly = {
  ...unquoted,
  image: false,
  executionRoutes: { nativeFree: false, studio: false, tools: false },
} as const;
export const openaiChatProfile: GatewayProfile = freeze({
  ...reasoningOnly, id: "openai-chat-v1", protocol: "openai-chat", label: "OpenAI Chat 兼容 · ASK",
  reasoning: { cache: "implicit" },
  auth: { kind: "bearer" },
  transport: { apiPrefix: "", rootPrefix: "/v1", paths: { catalog: "/models", reasoning: "/chat/completions" }, nativeHeaders: {} },
});
export const ANTHROPIC_VERSION = "2023-06-01";
export const anthropicMessagesProfile: GatewayProfile = freeze({
  ...reasoningOnly, id: "anthropic-messages-v1", protocol: "anthropic-messages", label: "Anthropic Messages · ASK",
  reasoning: { cache: "breakpoints" },
  // Browser calls must declare direct access; the Key still goes only to the configured address.
  auth: { kind: "anthropic-key", headers: { "anthropic-version": ANTHROPIC_VERSION, "anthropic-dangerous-direct-browser-access": "true" } },
  transport: { apiPrefix: "/v1", paths: { catalog: "/models", reasoning: "/messages" }, nativeHeaders: {} },
});
export const connectionProfiles: readonly GatewayProfile[] = freeze([standardProfile, openaiImagesProfile, geminiProfile, novelaiProfile, openaiChatProfile, anthropicMessagesProfile]);
/** Only locally registered protocols can be selected or restored. */
const profiles: Readonly<Record<string, GatewayProfile>> = freeze(Object.fromEntries(connectionProfiles.map(profile => [profile.id, profile])));

export function profileFor(id: string): GatewayProfile {
  if (!Object.hasOwn(profiles, id)) throw new Error("连接协议不受支持");
  return profiles[id];
}
export function profilePath(profile: GatewayProfile, name: ProfilePath): string {
  const path = profile.transport.paths[name];
  if (!path) throw new Error("连接不支持本次操作");
  return path;
}
