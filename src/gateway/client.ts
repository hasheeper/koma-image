import { countNaiTokens } from "../native/nai-tokenizer.ts";
import { validateNaiText } from "../domain/nai-input.ts";
import { readEncoding } from "../native/reference-images.ts";
import { referenceModel } from "../domain/nai-references.ts";
import { normalizeCatalog, validateCatalog } from "../domain/catalog.ts";
import type { Catalog } from "../domain/catalog.ts";
import { normalizeQuota } from "../domain/quota.ts";
import { createCostNotice, validateQuote } from "../domain/quote.ts";
import type { Quote } from "../domain/quote.ts";
import type { ConnectionContext } from "../services/connections.ts";
import type { ReservationPort } from "../services/scheduler.ts";
import { profileFor, profilePath } from "./profile.ts";
import type { GatewayProfile } from "./profile.ts";
import { createTransport, readJson, errorMessage } from "./transport.ts";
import { executionRoute, toNativePayload, toStandardPayload } from "./routes.ts";
import type { ImagePayload } from "./routes.ts";
import { nativeCatalog, nativeMappedCatalog, nativeRequest } from "./native-protocols.ts";
import { naiCost } from "../domain/nai-cost.ts";

export class QuoteUnsupported extends Error {
  constructor() {
    super("连接未声明报价能力");
  }
}
const timedSignal = (ms: number, signal?: AbortSignal) =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(ms)])
    : AbortSignal.timeout(ms);

/** Only raw upstream metadata is shared; model mapping and execution remain context-bound. */
export interface GatewayCatalogCache { raw?: Record<string, unknown>; fetchedAt?: number }

/** A client is bound to one connection/configuration/key revision. */
export function createGateway(
  context: ConnectionContext,
  fetcher: typeof fetch = fetch,
  profile: GatewayProfile = profileFor(context.connection.profileId),
  catalogCache: GatewayCatalogCache = {},
) {
  const transport = createTransport(context, profile, fetcher);
  let cached: Catalog | undefined;
  let mappedRaw: Record<string, unknown> | undefined;
  async function rawCatalog(force = false, signal?: AbortSignal) {
    context.assertCurrent();
    if (catalogCache.raw && !force) return catalogCache.raw;
    const readSignal = timedSignal(15_000, signal);
    const source = await readJson(await transport.request(profilePath(profile, "catalog"), { signal: readSignal }));
    const raw = validateCatalog(profile.protocol && profile.protocol !== "standard" ? nativeCatalog(profile, source) : source, profile);
    context.assertCurrent();
    catalogCache.raw = raw;
    catalogCache.fetchedAt = Date.now();
    cached = undefined;
    return raw;
  }
  async function catalog(
    force = false,
    signal?: AbortSignal,
  ): Promise<Catalog> {
    context.assertCurrent();
    if (cached && !force && mappedRaw === catalogCache.raw) return cached;
    const raw = await rawCatalog(force, signal);
    const mapped = nativeMappedCatalog(profile, raw, context.routing, context.connection.id);
    cached = normalizeCatalog(mapped, context.routing, context.connection.id, profile);
    mappedRaw = raw;
    return cached;
  }
  function wire(payload: ImagePayload): ImagePayload {
    const model = cached?.models.find((m) => m.id === payload.model);
    return {
      ...structuredClone(payload),
      model: model?.upstreamId ?? payload.model,
    };
  }
  async function estimateWire(
    payload: ImagePayload,
    signal?: AbortSignal,
  ): Promise<Quote | null> {
    if (profile.quote.local && profile.protocol === "novelai") {
      if (payload.tool === "upscale") return naiCost(payload, undefined);
      const balance = await quota(undefined, signal).catch(() => { signal?.throwIfAborted(); context.assertCurrent(); return null; });
      return naiCost(payload, balance?.media.subscription);
    }
    if (!profile.quote.supported) throw new QuoteUnsupported();
    const quote = validateQuote(
      await readJson(
        await transport.request(
          profilePath(profile, payload.tool ? "toolEstimate" : "estimate"),
          { body: !profile.protocol || profile.protocol === "standard" ? toStandardPayload(payload) : payload, signal: timedSignal(30_000, signal) },
        ),
      ),
    );
    context.assertCurrent();
    return quote;
  }
  async function quota(quotaGroup?: string, signal?: AbortSignal) {
    if (profile.protocol !== "novelai") throw new Error("此账户读取仅适用于 NovelAI");
    const subscription = await readJson(await transport.request(profilePath(profile, "quota"), { signal: timedSignal(10_000, signal) }));
    context.assertCurrent();
    const steps = subscription.trainingStepsLeft as Record<string, unknown> | undefined;
    const fixed = steps?.fixedTrainingStepsLeft, purchased = steps?.purchasedTrainingSteps;
    const remaining = typeof fixed === "number" && typeof purchased === "number" && Number.isFinite(fixed) && Number.isFinite(purchased) ? fixed + purchased : null;
    return normalizeQuota(profile, { credits: { remaining }, subscription }, null, quotaGroup);
  }
  return {
    profile,
    catalog,
    rawCatalog,
    fetchedAt: () => catalogCache.fetchedAt ?? 0,
    estimate: (payload: ImagePayload, signal?: AbortSignal) =>
      estimateWire(wire(payload), signal),
    async quota(quotaGroup?: string, signal?: AbortSignal) {
      if (profile.quotaPolicy.supported === false) {
        context.assertCurrent();
        signal?.throwIfAborted();
        if (profile.protocol !== "novelai") return normalizeQuota(profile, {}, null, quotaGroup);
        return quota(quotaGroup, signal);
      }
      const results = await Promise.allSettled([
        transport
          .request(profilePath(profile, "quota"), {
            signal: timedSignal(10_000, signal),
          })
          .then(readJson),
        transport
          .request(profilePath(profile, "stats"), {
            signal: timedSignal(8_000, signal),
            stats: true,
          })
          .then(readJson),
      ]);
      signal?.throwIfAborted();
      context.assertCurrent();
      const media = results[0].status === "fulfilled" ? results[0].value : null;
      const stats = results[1].status === "fulfilled" ? results[1].value : null;
      if (!media && !stats) throw new Error("额度暂不可用");
      return normalizeQuota(profile, media, stats, quotaGroup);
    },
    async encodeVibe(model: string, image: string, information: number, signal: AbortSignal) {
      if (profile.protocol !== "novelai" || !referenceModel(model)) throw new Error("此连接不支持 Vibe 编码");
      if (!image || !Number.isFinite(information) || information < 0 || information > 1) throw new Error("Vibe 编码参数无效");
      const upstream = wire({model}).model.replace(/@local$/, "");
      if (!referenceModel(upstream) || upstream !== model.replace(/@local$/, "")) throw new Error("Vibe 编码模型映射无效");
      const bounded = timedSignal(120_000, signal);
      const response = await transport.request(profilePath(profile, "encodeVibe"), { body:{ image, information_extracted:information, model:upstream }, signal:bounded });
      if (!response.ok) throw new Error(errorMessage(await response.json().catch(()=>null), `Vibe 编码失败 (${response.status})`));
      if (/json|text\//i.test(response.headers.get("content-type") ?? "")) throw new Error(errorMessage(await response.json().catch(()=>null), "Vibe 编码未返回二进制结果"));
      // Keep a completed paid receipt even if settings changed while it was in flight.
      // Further requests still assert this captured context before submission.
      return readEncoding(response, bounded);
    },
    /** The caller consumes/validates the response inside the task and timeout scope. */
    async execute<T>(
      input: ImagePayload,
      consume: (
        response: Response,
        native: boolean,
        signal: AbortSignal,
      ) => Promise<T>,
      options: {
        signal?: AbortSignal;
        beforeSubmit?: (quote: Quote | null) => void | Promise<void>;
        onQuote?: (quote: Quote) => void;
        onNotice?: (notice: string) => void;
        notice?: ReturnType<typeof createCostNotice>;
        shownCost?: number | null;
        reservation?: { port: ReservationPort; taskId: string; pool: string };
      } = {},
    ) {
      const controller = new AbortController();
      const abort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      const timer = setTimeout(
        () =>
          controller.abort(
            new DOMException(
              "请求超时；上游可能仍在处理，请勿重复提交",
              "TimeoutError",
            ),
          ),
        240_000,
      );
      const signal = controller.signal,
        start = performance.now();
      let reservation:
        | Awaited<ReturnType<ReservationPort["reserve"]>>
        | undefined;
      let submitted = false,
        acknowledged = false;
      try {
        const payload = wire(input);
        validateNaiText(payload);
        const adapted = profile.protocol && profile.protocol !== "standard" ? nativeRequest(profile, payload) : null;
        if (profile.protocol === "novelai" && payload.tool !== "upscale" && payload.tool !== "director") {
          const counts = await countNaiTokens(payload).catch(() => null);
          if (counts && [counts.prompt, counts.negative].some(parts => parts.reduce((a, b) => a + b, 0) > counts.tokens))
            options.onNotice?.(`提示词超过当前型号的 ${counts.tokens} token 预算，超出部分可能被上游截断`);
        }
        // A declared ceiling needs a fresh quote; estimateWire rejects when quotes are unsupported.
        const quote =
          profile.quote.supported || profile.quote.local || profile.costCeiling
            ? await estimateWire(payload, signal)
            : null;
        if (options.beforeSubmit) await options.beforeSubmit(quote);
        if (quote) {
          options.onQuote?.(quote);
          const notice = (
            options.notice ?? createCostNotice(options.shownCost ?? null)
          )(quote);
          if (notice) options.onNotice?.(notice);
        }
        signal.throwIfAborted();
        context.assertCurrent();
        const route = adapted ? { path: adapted.path } : executionRoute(payload, quote, profile),
          native = adapted ? adapted.native : "kind" in route && route.kind === "native";
        if (native) {
          try {
            new DecompressionStream("deflate-raw");
          } catch {
            throw new Error("浏览器不支持原生图片包解压，请更新浏览器后生成");
          }
        }
        // Without a quote there is no ceiling to reserve.
        if (options.reservation && quote)
          reservation = await options.reservation.port.reserve({
            taskId: options.reservation.taskId,
            requestId: crypto.randomUUID(),
            connectionId: context.connection.id,
            credentialRevision: context.credentialRevision,
            pool: options.reservation.pool,
            maxCost: quote.cost,
            signal,
          });
        signal.throwIfAborted();
        context.assertCurrent();
        const body =
          quote && profile.costCeiling
            ? { ...payload, [profile.costCeiling.field]: quote.cost }
            : payload;
        const requestBody = adapted ? adapted.body : native ? toNativePayload(body) : toStandardPayload(body);
        submitted = true;
        const response = await transport.request(route.path, {
          body: requestBody,
          signal,
          native,
          model: adapted && "model" in adapted ? adapted.model : undefined,
        });
        signal.throwIfAborted();
        context.assertCurrent();
        if (!response.ok)
          throw new Error(
            errorMessage(
              await response.json().catch(() => null),
              `请求失败 (${response.status})`,
            ),
          );
        const value = await consume(response, native, signal);
        signal.throwIfAborted();
        acknowledged = true;
        return {
          value,
          quote,
          native,
          ms: performance.now() - start,
          via: { connection: context.connection.id, upstreamId: payload.model },
        };
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        await reservation?.finish(
          acknowledged
            ? "acknowledged"
            : submitted
              ? "uncertain"
              : "not-submitted",
        );
      }
    },
  };
}
