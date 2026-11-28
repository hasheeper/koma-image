import { supportsFocusedInpaint } from "../domain/inpaint-focus.ts";
import { imageConnections } from "../config/connections.ts";
import type { CatalogModel } from "../domain/catalog.ts";
import type { QuotaStatus } from "../domain/quota.ts";
import type { Quote } from "../domain/quote.ts";
import { insufficientFunds, supportsSourcePayload } from "../domain/source-funding.ts";
import type { GatewayImageResponse, ImagePayload } from "../gateway/routes.ts";
import type { createGateway } from "../gateway/client.ts";
import type { createConnections } from "./connections.ts";
import { profileFor } from "../gateway/profile.ts";
import { acceptsSplitOptions } from "../gateway/image-channel-models.ts";
import { supportsNaiEnhance } from "../domain/nai-enhance.ts";
import { naiCost } from "../domain/nai-cost.ts";
import { referenceSurcharge } from "../domain/nai-references.ts";

type Gateway = ReturnType<typeof createGateway>;
type GatewayOptions = NonNullable<Parameters<Gateway["execute"]>[2]>;
type Consume<T> = (response: GatewayImageResponse, native: boolean, signal: AbortSignal) => Promise<T>;
export interface SourceSelection { model: CatalogModel; quota: QuotaStatus | null; quote: Quote | null; insufficient: string | null; skipped: string[] }
export type SourceOptions = Omit<GatewayOptions, "beforeSubmit"> & {
  onSource?: (selection: SourceSelection) => void | Promise<void>;
  onlyConnection?: string;
};
class InsufficientSource extends Error {}

export function createSourcePriority(connections: ReturnType<typeof createConnections>, gateway: (id: string) => Gateway,
  pendingCost?: (plan: NonNullable<ImagePayload["referencePlan"]>, model: string) => Promise<number>) {
  async function* candidates(wanted: CatalogModel, payload: ImagePayload | undefined, signal?: AbortSignal, get = gateway, operation?: string, onlyConnection?: string) {
    const routing = connections.configuration;
    const configured = imageConnections(routing).filter(c => (!onlyConnection || c.id === onlyConnection) && connections.hasCredential(c.credentialRef));
    const assertCurrent = configured[0] ? connections.context(configured[0].id).assertCurrent : () => {};
    for (const connection of configured) {
      signal?.throwIfAborted();
      assertCurrent();
      const profile = profileFor(connection);
      if (profile.protocol === "novelai" && wanted.provider !== "novelai") continue;
      if (profile.channelModels) {
        const binding = profile.channelModels.find(item => item.templateId === (wanted.templateId ?? wanted.id));
        if (!binding || (payload?.layerDecomposition && !binding.decompose)) continue;
        if (payload?.layerDecomposition && binding.splitLimits && !acceptsSplitOptions(binding.splitLimits, payload.layerDecomposition)) continue;
      }
      const client = get(connection.id), catalog = await client.catalog(false, signal);
      const model = catalog.models.find(m => m.id === wanted.id);
      if (!model || !supportsSourcePayload(model, payload)) continue;
      if (operation === "focused-inpaint" ? !supportsFocusedInpaint(model) : operation === "enhance" ? !supportsNaiEnhance(model) : operation === "chat" ? !model.chat : operation && !supportsSourcePayload(model, { model: model.id, tool: operation })) continue;
      if (payload?.sampler && !catalog.samplers.includes(String(payload.sampler))) continue;
      assertCurrent();
      yield { model, client };
    }
  }
  async function readQuota(client: Gateway, model: CatalogModel, signal?: AbortSignal) {
    const context = connections.context(model.connection);
    try { return await client.quota(model.quotaGroup, signal); }
    catch {
      signal?.throwIfAborted();
      // A failed balance read means unknown. Configuration/Key changes still invalidate the request.
      context.assertCurrent();
      return null;
    }
  }
  return {
    /** Read-only preview. With no payload, no quote is requested. */
    async select(wanted: CatalogModel, signal?: AbortSignal, payload?: ImagePayload, operation?: string): Promise<SourceSelection> {
      const skipped: string[] = [];
      let first: SourceSelection | undefined;
      for await (const { model, client } of candidates(wanted, payload, signal, gateway, operation)) {
        const [serverQuote, quota] = await Promise.all([
          payload && (client.profile.quote.supported || client.profile.costCeiling) ? client.estimate(payload, signal) : null,
          readQuota(client, model, signal),
        ]);
        let quote = serverQuote;
        let assessed = payload;
        if (payload && client.profile.protocol === "novelai") {
          const minimum = payload.referencePlan && !payload.preparedReferences && pendingCost
            ? referenceSurcharge(payload.referencePlan) + await pendingCost(payload.referencePlan, model.id) : payload.referenceMinimum;
          assessed = { ...payload, referenceMinimum: minimum };
          quote = naiCost({ ...assessed, model: model.upstreamId ?? payload.model }, quota?.media.subscription);
        }
        signal?.throwIfAborted();
        const insufficient = insufficientFunds(model, quota, quote, assessed);
        const selection = { model, quota, quote, insufficient, skipped: [...skipped] };
        if (!insufficient) return selection;
        first ??= selection;
        skipped.push(model.connection);
      }
      if (first) return first;
      throw new Error("没有支持当前模型与参数的可用来源");
    },
    /** Advance only before submission, on a fresh quote/balance check. Never retry a submitted request. */
    async execute<T>(wanted: CatalogModel, payload: ImagePayload, consume: Consume<T>, options: SourceOptions = {}, get = gateway) {
      const skipped: string[] = [];
      for await (const { model, client } of candidates(wanted, payload, options.signal, get, undefined, options.onlyConnection)) {
        try {
          return await client.execute(payload, consume, {
            ...options,
            beforeSubmit: async quote => {
              const quota = await readQuota(client, model, options.signal);
              const insufficient = insufficientFunds(model, quota, quote, payload);
              if (insufficient) throw new InsufficientSource(insufficient);
              await options.onSource?.({ model, quota, quote, insufficient: null, skipped: [...skipped] });
            },
          });
        } catch (error) {
          if (!(error instanceof InsufficientSource)) throw error;
          skipped.push(model.connection);
        }
      }
      if (options.onlyConnection) throw new Error(skipped.length ? "所选供应商额度不足，未提交生成" : "所选供应商暂不可用或不支持当前参数");
      throw new Error(skipped.length ? "所有可用来源的额度均不足，未提交生成" : "没有支持当前模型与参数的可用来源");
    },
  };
}
