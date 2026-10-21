import { object } from "../domain/value.ts";
import { errorMessage } from "../gateway/transport.ts";

/** The one message shape the runner speaks; adapters translate it per protocol. */
export interface AskTool {
  readonly name: string;
  readonly description: string;
  readonly schema: Readonly<Record<string, unknown>>;
}
export interface AskText {
  readonly type: "text";
  readonly text: string;
}
export interface AskImage {
  readonly type: "image";
  readonly mime: "image/png" | "image/jpeg" | "image/webp";
  /** Base64 without the data: prefix. */
  readonly data: string;
}
export interface AskCall {
  readonly type: "call";
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}
export interface AskResult {
  readonly type: "result";
  readonly id: string;
  readonly content: readonly (AskText | AskImage)[];
  readonly error?: boolean;
}
export type AskBlock = AskText | AskImage | AskCall | AskResult;
export interface AskMessage {
  readonly role: "user" | "assistant";
  readonly content: readonly AskBlock[];
}
/**
 * Payload order follows the cache layout: tools, system block 1 (constitution,
 * workspace, all-model knowledge), system block 2 (preferences, codebook),
 * history, then the current turn with its workspace state at the tail.
 */
export interface AskRequest {
  readonly model: string;
  readonly tools: readonly AskTool[];
  readonly system: readonly [core: string, preferences: string];
  readonly messages: readonly AskMessage[];
  /** Sent where the protocol requires an output limit (Anthropic). */
  readonly maxTokens: number;
}
/** Token counts as reported upstream; input includes cached tokens. */
export interface AskUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}
export type AskStop = "end" | "tool" | "length" | "refusal" | "other";
export type AskEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "call"; readonly call: AskCall }
  | { readonly type: "done"; readonly stop: AskStop; readonly usage: AskUsage | null };

export type ProviderErrorKind =
  | "auth"
  | "rejected"
  | "config"
  | "rate"
  | "server"
  | "network"
  | "timeout"
  | "empty"
  | "protocol";
const fallback: Record<ProviderErrorKind, string> = {
  auth: "Key 无效或无权访问",
  rejected: "请求被渠道或模型拒绝",
  config: "请求不被接受，请检查地址、模型 ID 与协议",
  rate: "请求过于频繁或额度不足",
  server: "服务暂时不可用",
  network: "连接中断",
  timeout: "响应超时",
  empty: "模型没有返回内容",
  protocol: "返回格式无法识别",
};
/** Upstream text is shown as is; the kind only decides which retries the UI offers. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status: number | undefined;
  constructor(kind: ProviderErrorKind, detail = "", status?: number) {
    super(detail || (status ? `${fallback[kind]} (${status})` : fallback[kind]));
    this.name = "ProviderError";
    this.kind = kind;
    this.status = status;
  }
}
const filtered =
  /content[\s_-]?filter|moderation|safety|sensitive|blocked|prohibited|violat|inappropriate|审核|敏感|违规|违禁|拦截|屏蔽/i;
/** Classifies an HTTP error body or an error event inside the stream. */
export function classify(status: number, data: unknown): ProviderError {
  const error = object(object(data).error),
    type = String(error.type ?? error.code ?? "").toLowerCase(),
    detail = errorMessage(data, "");
  const kind: ProviderErrorKind =
    status === 401 || /authentication|api_key/.test(type)
      ? "auth"
      : filtered.test(detail) || filtered.test(type)
        ? "rejected"
        : status === 403 || type.includes("permission")
          ? type.includes("permission") ? "auth" : "rejected"
          : status === 429 || /rate_limit|quota/.test(type)
            ? "rate"
            : status === 408 || status === 504
              ? "timeout"
              : status >= 500 || /overloaded|api_error|server_error/.test(type)
                ? "server"
                : "config";
  return new ProviderError(kind, detail, status || undefined);
}
