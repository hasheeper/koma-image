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
import { executionRoute, toNativePayload } from "./routes.ts";
import type { ImagePayload } from "./routes.ts";

export class QuoteUnsupported extends Error {
  constructor() {
    super("连接未声明报价能力");
  }
}
const timedSignal = (ms: number, signal?: AbortSignal) =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(ms)])
    : AbortSignal.timeout(ms);

/** A client is bound to one connection/configuration/key revision. */
export function createGateway(
  context: ConnectionContext,
  fetcher: typeof fetch = fetch,
  profile: GatewayProfile = profileFor(context.connection.profileId),
) {
  const transport = createTransport(context, profile, fetcher);
  let cached: Catalog | undefined;
  let rawCache: Record<string, unknown> | undefined,
    fetchedAt = 0;
  async function rawCatalog(force = false, signal?: AbortSignal) {
    context.assertCurrent();
    if (rawCache && !force) return rawCache;
    const raw = validateCatalog(
      await readJson(
        await transport.request(profilePath(profile, "catalog"), {
          signal: timedSignal(15_000, signal),
        }),
      ),
      profile,
    );
    context.assertCurrent();
    rawCache = raw;
    fetchedAt = Date.now();
    cached = undefined;
    return raw;
  }
  async function catalog(
    force = false,
    signal?: AbortSignal,
  ): Promise<Catalog> {
    context.assertCurrent();
    if (cached && !force) return cached;
    const raw = await rawCatalog(force, signal);
    cached = normalizeCatalog(raw, context.routing, context.connection.id);
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
  ): Promise<Quote> {
    if (!profile.quote.supported) throw new QuoteUnsupported();
    const quote = validateQuote(
      await readJson(
        await transport.request(
          profilePath(profile, payload.tool ? "toolEstimate" : "estimate"),
          { body: payload, signal: timedSignal(30_000, signal) },
        ),
      ),
    );
    context.assertCurrent();
    return quote;
  }
  return {
    profile,
    catalog,
    rawCatalog,
    fetchedAt: () => fetchedAt,
    estimate: (payload: ImagePayload, signal?: AbortSignal) =>
      estimateWire(wire(payload), signal),
    async quota(quotaGroup?: string, signal?: AbortSignal) {
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
      const checked = results[1].status === "fulfilled",
        stats = results[1].status === "fulfilled" ? results[1].value : null;
      if (!media && !stats) throw new Error("额度暂不可用");
      return normalizeQuota(profile, media, stats, checked, quotaGroup);
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
        // A declared ceiling needs a fresh quote; estimateWire rejects when quotes are unsupported.
        const quote =
          profile.quote.supported || profile.costCeiling
            ? await estimateWire(payload, signal)
            : null;
        if (quote) {
          options.onQuote?.(quote);
          const notice = (
            options.notice ?? createCostNotice(options.shownCost ?? null)
          )(quote);
          if (notice) options.onNotice?.(notice);
        }
        signal.throwIfAborted();
        context.assertCurrent();
        const route = executionRoute(payload, quote, profile),
          native = route.kind === "native";
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
        const requestBody = native ? toNativePayload(body) : body;
        submitted = true;
        const response = await transport.request(route.path, {
          body: requestBody,
          signal,
          native,
        });
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
