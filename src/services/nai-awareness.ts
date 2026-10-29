import { collect, drawingPayload } from '../domain/drawing.ts';
import type { DrawingForm } from '../domain/drawing.ts';
import type { CatalogModel } from '../domain/catalog.ts';
import { naiCapabilities, complexities, naiModes } from '../domain/nai.ts';
import { characterCapability } from '../domain/characters.ts';
import { modelSamplers, noiseSchedules, supportsNaiVariety, naiVarietySigma } from '../domain/nai-parameters.ts';
import { activeReferences, referenceOperation, referenceSurcharge } from '../domain/nai-references.ts';
import { naiInputLimits, naiInputParts, naiTextLength } from '../domain/nai-input.ts';
import { naiCost } from '../domain/nai-cost.ts';
import { countNaiTokens } from '../native/nai-tokenizer.ts';
import type { ImagePayload } from '../gateway/routes.ts';
import type { QuoteState } from './quote-preview.ts';
import { canonical } from '../ask/canonical.ts';
import { hash } from '../ask/digest/index.ts';
import { object } from '../domain/value.ts';
import { parameterSchema } from '../ask/draft/parameters.ts';

/** Frozen read ports only. No source selection, quota refresh or encoding here. */
export interface NaiAwarenessInput {
  form: DrawingForm;
  models: readonly CatalogModel[];
  samplers: readonly string[];
  operation?: 'image' | 'img2img' | 'inpaint' | 'upscale' | 'director';
  payload?: ImagePayload;
  quote?: QuoteState;
  account?: unknown;
  accountAt?: number;
  accountSource?: string;
  referenceMinimum?: number;
  referenceCosts?: Readonly<Record<string, number | undefined>>;
  quoteKey?: string;
  quoteAt?: number;
}
export const naiSourceKey = (model?: Pick<CatalogModel,'connection'|'profileId'|'sourceRevision'>) => model ? hash(canonical([model.connection,model.profileId,model.sourceRevision])) : '';
export const naiQuoteKey = (form: DrawingForm, model?: CatalogModel) => hash(canonical({form, source:model ?? null}));
/** Keep only local pricing inputs, never a raw account response in a saved draft. */
export function naiAccountSnapshot(value: unknown) {
  const account=object(value), usage=object(account.usage);
  return { ...(typeof account.active==='boolean'?{active:account.active}:{}),
    ...Object.fromEntries(['accountType','expiresAt','tier'].flatMap(key=>typeof account[key]==='number'?[[key,account[key]]]:[])),
    ...(typeof usage.isNegative==='boolean'?{usage:{isNegative:usage.isNegative}}:{}) };
}
export function naiAwareness(input: NaiAwarenessInput, counter = countNaiTokens) {
  const { form } = input, model = input.models.find(m => m.id === form.model);
  const cap = naiCapabilities(form.model), operation = input.operation ?? 'image';
  const applicable = cap.supported && operation !== 'upscale' && operation !== 'director';
  const supported = (kind: 'vibe' | 'precise') => model?.profileId === 'nai-official-v1' && referenceOperation(form.model, kind, operation === 'image' ? undefined : operation);
  const refs = form.naiReferences, roles = characterCapability(form.model);
  let params: ReturnType<typeof collect> | null = null, payload: ImagePayload = {model:form.model}, inputError = '';
  try {
    params = model ? collect({ ...form, seed: form.seed || '0' }, model, form.batchCount) : null;
    payload = structuredClone(input.payload ?? (params ? drawingPayload(params) : payload));
  } catch (error) { inputError = error instanceof Error ? error.message : '输入不可用'; }
  const referenceMinimum = input.referenceMinimum ?? input.referenceCosts?.[form.model];
  if (referenceMinimum !== undefined) payload.referenceMinimum = referenceMinimum;
  const input_hash = hash(canonical({ payload, source: model ?? null }));
  const limits = applicable ? naiInputLimits(form.model) : null;
  const parts = naiInputParts(payload);
  const textParts = parts.prompt.map(naiTextLength), usedText = textParts.reduce((a,b) => a+b,0);
  const budget = (status: string, counts?: Awaited<ReturnType<typeof countNaiTokens>>, reason?: string) => ({
    status, model_id: form.model, input_hash, ...(limits ? { encoder: limits.encoder } : {}), ...(reason ? { reason } : {}),
    ...(limits ? { positive: direction(counts?.prompt, limits.tokens), negative: direction(counts?.negative, limits.tokens),
      text: { used: usedText, limit: limits.text, overflow: Math.max(0, usedText-limits.text), base: textParts[0], characters: Object.fromEntries(parts.ids.slice(1).map((id,i)=>[id,textParts[i+1]])) },
      characters: form.characters.map(c=>({ id:c.id, enabled:c.on, positive: c.on, negative:c.on && !cap.medium })) } : {}),
  });
  function direction(counts: number[] | undefined, limit: number) {
    if (!counts) return { limit };
    const used = counts.reduce((a,b)=>a+b,0);
    return { used, limit, remaining: Math.max(0,limit-used), overflow:Math.max(0,used-limit), base:counts[0], characters:Object.fromEntries(parts.ids.slice(1).map((id,i)=>[id,counts[i+1]])) };
  }
  const diagnostics: { severity: 'warning' | 'error'; message: string }[] = [];
  if (inputError) diagnostics.push({severity:'error',message:inputError});
  if (!model) diagnostics.push({ severity:'error', message:'当前型号没有可用来源' });
  if (form.characters.filter(c=>c.on).length > roles.max) diagnostics.push({ severity:'error', message:`当前型号最多 ${roles.max} 个启用角色` });
  if (limits && usedText > limits.text) diagnostics.push({ severity:'error', message:`Text: ${usedText}/${limits.text} 字符，执行前须缩短` });
  if (refs.active && activeReferences(refs).length && !supported(refs.active)) diagnostics.push({severity:'error',message:'当前来源或操作不支持已启用的参考'});
  const freshAccount = input.accountSource===naiSourceKey(model) && input.accountAt !== undefined && Date.now()-input.accountAt < 60_000 ? input.account : undefined;
  const estimated = !inputError && model?.profileId === 'nai-official-v1' ? naiCost(payload, freshAccount) : null;
  const matchedQuote = !!model && input.quoteKey === naiQuoteKey(form,model) && !!input.quoteAt && Date.now()-input.quoteAt < 60_000;
  const quoted = !inputError && matchedQuote && input.quote?.status === 'ready' ? input.quote.quote : null;
  const price = quoted ?? estimated;
  const encoding = typeof price?.encodingCost === 'number' ? price.encodingCost : undefined;
  const cost = { status: price ? 'ready' : input.quote?.quote ? 'stale' : input.quote?.status === 'loading' ? 'loading' : input.quote?.status === 'unsupported' ? 'unsupported' : input.quote?.status === 'error' ? 'error' : 'unknown', input_hash,
    operation, dimensions:[payload.width,payload.height],
    ...(price ? { source:price.estimated ? 'local_estimate' : 'provider_quote', unit:price.unit ?? 'credits', obtained_at:quoted ? input.quoteAt : Date.now(),
      ...(encoding !== undefined ? {per_image:price.cost-encoding,encoding_once:encoding,batch_total:(price.cost-encoding)*form.batchCount+encoding} : {per_image:price.cost,...(!payload.referencePlan ? {batch_total:price.cost*form.batchCount}: {})}),
      ...(payload.referencePlan ? {reference_per_image:referenceSurcharge(payload.referencePlan)} : {}),
      ...(price.usagePercent !== undefined ? {usage_note:'另有 V5 用量消耗；百分比仅为基准近似'} : {})
    } : { reason:inputError || '尚无适用于当前输入与来源的费用；不会主动请求报价', ...(payload.referencePlan ? {lower_bound:referenceSurcharge(payload.referencePlan),lower_bound_unit:'Anlas'} : {}) }) };
  const snapshot = {
    capabilities: { ready:!!model, model_id: form.model, model_name:model?.name, profile:model?.profileId, operation,
      available_models:input.models.map(m=>({id:m.id,name:m.name})),
      parameters: { seed:{...parameterSchema.properties.seed,random:''}, scale:{...parameterSchema.properties.scale, slider_max:10}, steps:cap.medium ? {fixed:14} : parameterSchema.properties.steps, cfgRescale:cap.medium || !cap.supported ? {supported:false} : parameterSchema.properties.cfgRescale,
        sampler: { options:modelSamplers(model,input.samplers), ...(cap.medium ? { fixed:'k_euler_ancestral' } : {}) },
        noiseSchedule:{options:model?.profileId === 'nai-official-v1' && cap.supported && !cap.v5 ? noiseSchedules : ['karras']},
        varietyPlus:{supported:supportsNaiVariety(model)}, qualityPreset:{options:cap.quality}, negativePreset:{options:cap.negative,fixed:cap.medium},
        naiMode:{supported:cap.supported,options:naiModes},complexity:{supported:cap.v5,options:cap.v5?complexities:['none']}, transparentBg:{supported:!!model?.transparentBackground}, effort:cap.effort ? cap.medium ? 'medium' : 'high' : null },
      dimensions:{alignment:64,min:64,max_pixels:model?.maxPixels, ...(operation==='image'?{max_side:2048}:{file_bytes:8*1024*1024})},
      characters:{...roles,enabled:form.characters.filter(c=>c.on).length},
      references:{supported_kinds:(['vibe','precise'] as const).filter(supported), active_kind:refs.active,active_count:activeReferences(refs).length,mutually_exclusive:true},
    },
    effective:{ model_id:form.model, effort:cap.effort ? cap.medium?'medium':'high':null, steps:payload.steps, sampler:payload.sampler, scale:payload.scale, cfgRescale:cap.medium ? null : payload.cfg_rescale,
      noiseSchedule:payload.noise_schedule, varietyPlus:supportsNaiVariety(model) && form.varietyPlus,
      ...(supportsNaiVariety(model) && form.varietyPlus ? {skip_cfg_above_sigma:naiVarietySigma(form.model,true,payload.width,payload.height)}:{}),
      naiMode:params?.naiMode,qualityPreset:params?.qualityPreset,negativePreset:cap.medium?'fixed-heavy':params?.negativePreset,complexity:params?.complexity,transparentBg:params?.transparentBg,
      ignored:cap.medium?['saved.steps','saved.sampler','saved.negative','saved.character_negative','saved.cfgRescale']:[],
    }, input_budget:budget(!applicable?'not_applicable':inputError?'error':!model?'unavailable':'pending',undefined,inputError||undefined), cost, diagnostics,
  };
  return { snapshot, payload, async counted() {
    if (!applicable || !model || inputError) return snapshot;
    try {
      const counts = await counter(payload);
      const warnings = counts && [counts.prompt,counts.negative].some(a=>a.reduce((x,y)=>x+y,0)>counts.tokens) ? [{severity:'warning' as const,message:'Token 超出型号预算，上游可能截断；不会自动删词'}] : [];
      return {...snapshot,input_budget:budget(counts?'ready':'unavailable',counts),diagnostics:[...diagnostics,...warnings]};
    } catch { return {...snapshot,input_budget:budget('error',undefined,'本地分词暂不可用')}; }
  } };
}
export type NaiAwareness = ReturnType<typeof naiAwareness>['snapshot'];
