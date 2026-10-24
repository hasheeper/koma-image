import type { AskStop } from "../messages.ts";

/** Decode with the request's codec before calling. Do not alter stored prose. */
export function extractCompletedMemo(text: string, stop: AskStop, hasToolCalls = false): string {
  if (hasToolCalls) throw new Error("压缩时不能调用工具");
  if (stop === "length") throw new Error("压缩结果被截断");
  if (stop === "refusal") throw new Error("压缩请求被拒绝");
  const memo = text.match(/<memo>([\s\S]*?)<\/memo>/)?.[1].trim();
  if (!memo) throw new Error("压缩结果缺少完整且非空的 <memo> 正文");
  return memo;
}
