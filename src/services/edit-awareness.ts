import type { ImagePayload } from '../gateway/routes.ts';
import { editDrawingForm, editStateHash } from '../domain/edit-draft.ts';
import type { EditDraftState } from '../domain/edit-draft.ts';
import { naiAwareness, naiQuoteKey, naiSourceKey } from './nai-awareness.ts';
import { collect, drawingPayload } from '../domain/drawing.ts';
import { inpaintFocusPlan, focusContains, supportsFocusedInpaint } from '../domain/inpaint-focus.ts';
import { supportsNaiEnhance, availableEnhanceScales, naiEnhanceSize } from '../domain/nai-enhance.ts';
import { directorTools, directorEmotions, directorSize, directorCost } from '../domain/director-tools.ts';
import { editorModels, validateEditorSource, naiUpscaleLimit, MAX_INPUT_BYTES } from '../domain/media.ts';
import { canonical } from '../ask/canonical.ts';
import { editStrengthRange } from '../domain/nai-parameters.ts';

/** A read-only projection; never builds raster payloads or chooses a source. */
export function editAwareness(s: EditDraftState) {
  if (!s.ready || !s.source) {
    const snapshot = { ready:false, active_board_id:s.id, board_seq:s.boardSeq, board_name:s.name,
      base_hash:editStateHash(s), reason:'请先导入编辑底图' };
    return { snapshot, async counted() { return snapshot; } };
  }
  const c = s.config, form = editDrawingForm(s), mode = c.upscaleOpen ? 'upscale' : c.mode;
  const model = s.models.find(m => m.id === form.model), source = mode==='upscale'?(s.viewing??s.source):s.source;
  let payload: ImagePayload | undefined;
  try {
    payload = model ? mode === 'upscale' ? {model:model.id,tool:mode,width:source?.width,height:source?.height}
      : {...drawingPayload(collect({...form,seed:form.seed||'0'},model,1)),tool:mode,
        strength: c.enhance.on && mode==='img2img' ? c.enhance.strength : c.strength[mode],
        noise: mode==='img2img' ? c.enhance.on ? c.enhance.noise : c.noise.img2img : 0} : undefined;
  } catch { /* The shared builder reports invalid role/reference configurations. */ }
  let focus_box: Record<string,unknown> = {has_box:!!c.focus.rect};
  if (source && c.focus.rect) {
    const r=c.focus.rect;
    focus_box={has_box:true,rect:{x:r.x/source.width,y:r.y/source.height,w:r.width/source.width,h:r.height/source.height},pixel_rect:r};
    try {
      const p=inpaintFocusPlan(source,r), contains=s.mask.status==='ready' && !!s.mask.pixel_bbox && focusContains(r,s.mask.pixel_bbox);
      Object.assign(focus_box,{proc_size:[p.targetWidth,p.targetHeight],contains_mask:contains,valid:contains,
        ...(!contains?{invalid_reason:s.mask.status!=='ready'?'mask_pending':s.mask.has_mask?'mask_outside':'no_mask'}:{})});
      if(payload && mode==='inpaint' && c.focus.on) {payload.width=p.targetWidth;payload.height=p.targetHeight;}
    } catch {Object.assign(focus_box,{valid:false,invalid_reason:'size'});}
  }
  if(payload && source && mode==='img2img' && c.enhance.on) {
    payload.enhance=true;payload.enhanceScale=c.enhance.scale;
    try {if(c.enhance.scale!=='max')Object.assign(payload,naiEnhanceSize(source,c.enhance.scale,form.model));} catch { /* Invalid saved values stay visible. */ }
  }
  const pricing=s.pricing, sameSource=pricing?.sourceKey===canonical(model?[model.id,naiSourceKey(model),model.upstreamId]:null);
  const nai=naiAwareness({form,models:s.models,samplers:s.samplers,operation:mode,payload,
    referenceCosts:pricing?.referenceCosts, account:sameSource?pricing?.account:undefined,accountAt:sameSource?pricing?.accountAt:undefined,accountSource:naiSourceKey(model),
    quote:sameSource?pricing?.quote:undefined,quoteAt:pricing?.quoteAt,
    quoteKey:sameSource && pricing?.configKey===canonical(c) ? naiQuoteKey(form,model) : undefined});
  const available=(mode:'img2img'|'inpaint'|'upscale')=>editorModels({models:s.models},mode);
  const sourceIssue=source ? validateEditorSource(mode,model,source) : null;
  const capabilities={...nai.snapshot.capabilities,
    parameters:mode==='upscale'?{upscaleKind:{options:[...new Set(available('upscale').map(m=>m.provider==='fal'?'external':'native'))]}}:{...nai.snapshot.capabilities.parameters,
      strength:editStrengthRange(model?.profileId==='nai-official-v1',mode==='inpaint'),noise:mode==='inpaint'?{supported:false}:{min:0,max:model?.profileId==='nai-official-v1'?.99:1}},
    ...(mode==='upscale'?{dimensions:{file_bytes:MAX_INPUT_BYTES,...(model?.provider==='novelai'?{max_pixels:naiUpscaleLimit(model)}:{max_pixels:model?.sourceMaxPixels})}}:{}),
    modes:(['img2img','inpaint','upscale'] as const).filter(mode=>available(mode).length),
    inpaint_kinds:['normal',...(model&&supportsFocusedInpaint(model)?['focused']:[])],
    models:{img2img:available('img2img').map(m=>m.id),inpaint:available('inpaint').map(m=>m.id)},
    enhance_scales:source&&model&&supportsNaiEnhance(model)?availableEnhanceScales(source,model.id):[],
    director_tools:s.models.some(m=>m.profileId==='nai-official-v1'&&m.tools.includes('director')),
    director_presets:directorTools.map(t=>t.id),emotions:directorEmotions.map(([id])=>id),
    upscale_kinds:[...new Set(available('upscale').map(m=>m.provider==='fal'?'external':'native'))],
    source_editable:!!source&&!!model&&!sourceIssue,source_issues:sourceIssue?[sourceIssue]:[]};
  const directorModel=s.models.find(m=>m.profileId==='nai-official-v1'&&m.tools.includes('director'));
  const directorOptions=c.director.tool==='colorize'?c.director.colorize:c.director.tool==='emotion'?c.director.emotion:{};
  let directorSizeValue:ReturnType<typeof directorSize>|null=null;
  try {directorSizeValue=(s.viewing??source)?directorSize((s.viewing??source)!):null;} catch { /* Source issue remains visible. */ }
  const directorPrice=directorModel && directorSizeValue ? directorCost({model:directorModel.id,tool:'director',directorTool:c.director.tool,...directorSizeValue,...directorOptions},
    sameSource && directorModel.connection===model?.connection && pricing?.accountAt && Date.now()-pricing.accountAt<60_000 ? pricing.account : undefined) : null;
  const {naiReferences:_refs,negative_prompt:_negative,historyLimit:_history,tagSuggest:_tags,localCache:_local,optimize:_optimize,cfg:_cfg,batchCount:_batch,...saved}=form as typeof form & {negative_prompt?:string};
  const snapshot={ready:s.ready,active_board_id:s.id,board_seq:s.boardSeq,board_name:s.name,base_hash:editStateHash(s),mask_revision:s.maskRevision,
    mode,inpaint_kind:mode==='inpaint'?(c.focus.on?'focused':'normal'):undefined,mask:s.mask,focus_box,
    form:mode==='upscale'?{model:form.model,upscale:{kind:model?.provider==='fal'?'external':'native'}}:
      {...saved,references_summary:nai.snapshot.capabilities.references,strength:c.strength[mode],...(mode==='img2img'?{noise:c.noise.img2img}:{}),enhance:c.enhance},
    director_tool:{tool:c.director.tool,...directorOptions,open:c.directorOpen,size:directorSizeValue,
      cost:directorPrice?{status:'ready',source:'local_estimate',unit:directorPrice.unit,per_image:directorPrice.cost}:{status:'unknown'}},
    ...nai.snapshot,capabilities,effective:{...nai.snapshot.effective,dimensions:[payload?.width,payload?.height],...(mode!=='upscale'?{strength:payload?.strength,...(mode==='img2img'?{noise:payload?.noise,enhance:!!payload?.enhance,enhanceScale:payload?.enhanceScale}: {})}:{})},...(s.blocked?{blocked:s.blocked}:{})};
  return {snapshot,async counted(){return {...snapshot,...await nai.counted(),capabilities,effective:snapshot.effective};}};
}
