import { naiInputLimits, naiInputParts } from "../domain/nai-input.ts";
import type { ImagePayload } from "../gateway/routes.ts";
import type { TokenRequest, TokenResponse } from "./nai-tokenizer.worker.ts";

let worker: Worker | undefined, serial = 0, idle: ReturnType<typeof setTimeout> | undefined;
const waiting = new Map<number, { resolve(counts: number[]): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout> }>();
const cache = new Map<string, Promise<number[]>>();
function stop() {
  worker?.terminate(); worker = undefined; cache.clear();
  for (const item of waiting.values()) { clearTimeout(item.timer); item.reject(new Error("NAI token 计数暂不可用")); }
  waiting.clear();
}
export function countNaiTokens(payload: ImagePayload) {
  const limits = naiInputLimits(payload.model);
  if (!limits || typeof Worker === "undefined") return Promise.resolve(null);
  const parts = naiInputParts(payload), texts = [...parts.prompt, ...parts.negative];
  const key = JSON.stringify([limits.encoder, texts]);
  clearTimeout(idle);
  let result = cache.get(key);
  if (!result) {
    result = new Promise<number[]>((resolve, reject) => {
      worker ??= new Worker(new URL("./nai-tokenizer.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }: MessageEvent<TokenResponse>) => {
        const item = waiting.get(data.id); if (!item) return;
        clearTimeout(item.timer); waiting.delete(data.id);
        if (data.error !== undefined) item.reject(new Error(data.error)); else item.resolve(data.counts);
      };
      worker.onerror = stop;
      const id = ++serial;
      waiting.set(id, { resolve, reject, timer: setTimeout(stop, 30_000) });
      worker.postMessage({ id, encoder: limits.encoder, texts, baseUrl: new URL(import.meta.env.BASE_URL, document.baseURI).href } satisfies TokenRequest);
    });
    cache.set(key, result);
    void result.catch(() => { cache.delete(key); });
    if (cache.size > 32) cache.delete(cache.keys().next().value!);
  }
  idle = setTimeout(() => { if (!waiting.size) stop(); }, 60_000);
  return result.then(counts => ({ ...limits, ids: parts.ids, prompt: counts.slice(0, parts.prompt.length), negative: counts.slice(parts.prompt.length) }));
}
