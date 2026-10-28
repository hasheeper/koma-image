import { createNaiTokenizer } from "./nai-tokenizer-engine.ts";

export interface TokenRequest { id: number; encoder: "t5" | "qwen35"; texts: string[]; baseUrl: string }
export type TokenResponse = { id: number; counts: number[]; error?: never } | { id: number; error: string; counts?: never };
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<TokenRequest>) => void) | null; postMessage(value: TokenResponse): void };
const encoders = new Map<string, Promise<ReturnType<typeof createNaiTokenizer>>>();
scope.onmessage = async ({ data }) => {
  try {
    if (!encoders.has(data.encoder)) encoders.set(data.encoder, (async () => {
      const response = await fetch(new URL(`tokenizers/${data.encoder}.json`, data.baseUrl));
      if (!response.ok) throw new Error("词表载入失败");
      return createNaiTokenizer(await response.json(), data.encoder);
    })().catch(error => { encoders.delete(data.encoder); throw error; }));
    const encode = await encoders.get(data.encoder)!;
    scope.postMessage({ id: data.id, counts: data.texts.map(encode) });
  } catch { scope.postMessage({ id: data.id, error: "NAI token 计数暂不可用" }); }
};
