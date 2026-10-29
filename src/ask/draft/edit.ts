import { checkEditConfiguration } from "./edit-configuration.ts";
import { editorModels } from "../../domain/media.ts";
import { modelSamplers } from "../../domain/nai-parameters.ts";
import { recipeDocument } from "../../bridge/export.ts";
import { boardForm } from "../../domain/drawing.ts";
import { parseDraft,validateDraft,stateHash } from './validate.ts';
import type { Draft,DraftState,DraftPlan,ValidateOptions,DirectorStep,CheckedStep } from './types.ts';
import type { Picture } from '../library.ts';
import { editDrawingForm } from '../../domain/edit-draft.ts';
import type { EditDraftState,EditConfiguration } from '../../domain/edit-draft.ts';
import { canonical } from '../canonical.ts';
import { hash } from '../digest/index.ts';
import { parameterSchema } from './parameters.ts';
import { checkShape } from './schema-check.ts';
import { directorSchema, editParameterProperties } from './edit-schema.ts';
import { naiCapabilities,NAI_FULL,NAI_MEDIUM } from '../../domain/nai.ts';
import { editStrengthRange } from '../../domain/nai-parameters.ts';
import { snapFocusRect,inpaintFocusPlan,focusContains,supportsFocusedInpaint } from '../../domain/inpaint-focus.ts';
import { supportsNaiEnhance,availableEnhanceScales,naiEnhanceMagnitudes } from '../../domain/nai-enhance.ts';
import { isDirectorTool,directorEmotions,directorName } from '../../domain/director-tools.ts';

const extraKeys=['editMode','inpaintKind','strength','noise','enhance','upscaleKind','effort','focusRect'];
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('编辑参数需要对象');return v as Record<string,unknown>;};
export function draftTarget(input:Readonly<Record<string,unknown>>,base:DraftState) {
 const steps=Array.isArray(input.steps)?input.steps.map(obj):[];
 const textTargets=steps.filter(s=>s.kind==='prompt_patch').map(s=>String(s.target).split('.')[0]);
 if(textTargets.includes('image')&&textTargets.includes('edit'))throw new Error('IMAGE 与 EDIT 不能同稿');
 if(textTargets.includes('edit')&&base.workspace!=='edit')throw new Error('请使用 edit_handoff 把图片送入 EDIT');
 if(steps.some(s=>s.kind==='chat_handoff'||s.kind==='chat_distill_branch')||textTargets.includes('chat'))return 'chat';
 return textTargets.includes('edit')||base.workspace==='edit'&&!textTargets.includes('image')?'edit':'image';
}
const adapted=(base:DraftState,s:EditDraftState):DraftState=>({...base,workspace:'image',edit:undefined,boardId:s.id,boardName:s.name,boardPresent:s.present,
 nextCharacterId:s.nextCharacterId,form:editDrawingForm(s),models:s.models,samplers:s.samplers,samplersByModel:Object.fromEntries(s.models.map(m=>[m.id,modelSamplers(m,s.samplers)]))});
export function parseDirector(raw:Readonly<Record<string,unknown>>):DirectorStep {
 checkShape(raw,directorSchema,'Director 预设');
 if(!isDirectorTool(raw.tool))throw new Error('Director 工具无效');
 if(raw.emotion!==undefined&&(raw.tool!=='emotion'||!directorEmotions.some(([id])=>id===raw.emotion)))throw new Error('表情无效');
 if(raw.defry!==undefined&&(!['colorize','emotion'].includes(raw.tool)||!Number.isInteger(raw.defry)||Number(raw.defry)<0||Number(raw.defry)>5))throw new Error('Director 强度须为 0–5');
 if(raw.prompt!==undefined&&(!['colorize','emotion'].includes(raw.tool)||typeof raw.prompt!=='string'||raw.prompt.length>24000))throw new Error('Director 描述无效');
 return {kind:'director_patch',tool:raw.tool,...(raw.emotion!==undefined?{emotion:String(raw.emotion)}:{}),...(raw.defry!==undefined?{defry:Number(raw.defry)}:{}),...(raw.prompt!==undefined?{prompt:String(raw.prompt)}:{})};
}
export function parseEditDraft(input:Readonly<Record<string,unknown>>,base:DraftState,library:readonly Picture[],question:string):Draft {
 const s=base.edit;if(!s?.ready)throw new Error('请先导入编辑底图');
 if(input.base_hash!==stateHash(base))throw new Error('草稿 base_hash 与本轮快照不符');
 if(input.new_board_name!==undefined)throw new Error('EDIT 页内草稿不能创建 IMAGE 画板');
 if(!Array.isArray(input.steps)||!input.steps.length||input.steps.length>12)throw new Error('草稿需要 1–12 个步骤');
 const extras:Draft['steps'][number][]=[], common:Record<string,unknown>[]=[];
 for(const raw of input.steps) {
   const step=obj(raw);
   if(step.kind==='director_patch'){extras.push(parseDirector(step));continue;}
   if(step.kind==='params_patch') {
     const params=obj(step.params),regular:Record<string,unknown>={},extra:Record<string,unknown>={};
     for(const [k,v] of Object.entries(params)) {if(extraKeys.includes(k))extra[k]=v;else if(['width','height','batchCount'].includes(k))throw new Error('编辑尺寸由底图决定，不能由草稿修改');else if(Object.hasOwn(parameterSchema.properties,k))regular[k]=v;else throw new Error(`不能修改编辑参数 ${k}`);}
     if(Object.keys(regular).length) common.push({...step,params:regular});
     if(Object.keys(extra).length){checkShape(extra,{type:'object',properties:editParameterProperties,additionalProperties:false},'编辑参数');extras.push({kind:'edit_config',params:structuredClone(extra)});}
     if(!Object.keys(params).length)throw new Error('params 不能为空');
   } else if(step.kind==='prompt_patch')common.push({...step,target:String(step.target).replace(/^edit\./,'image.')});
   else if(['restore_partial','character_edit','slate_edit','save_ref'].includes(String(step.kind))) {
     if(step.kind==='restore_partial'&&Array.isArray(step.fields)&&step.fields.some(f=>['width','height','batchCount'].includes(f)))throw new Error('编辑不能恢复尺寸或批次');
     common.push(step);
   } else throw new Error('此步骤不能与 EDIT 页内草稿组合');
 }
 const inner=adapted(base,s),synthetic=!common.length;
 const parsed=parseDraft({...input,base_hash:stateHash(inner),steps:common.length?common:[{kind:'prompt_patch',target:'image.prompt',mode:'rewrite',text:inner.form.prompt}]},inner,library,question);
 return {...parsed,target:'edit',base:structuredClone(base),baseHash:stateHash(base),synthetic,steps:[...parsed.steps,...extras]};
}
export function configureEdit(s:EditDraftState,params:Readonly<Record<string,unknown>>,config=structuredClone(s.config)):EditConfiguration {
 const c=config;
 if(params.editMode!==undefined){if(!['img2img','inpaint','upscale'].includes(String(params.editMode)))throw new Error('编辑模式无效');c.upscaleOpen=params.editMode==='upscale';if(params.editMode!=='upscale')c.mode=params.editMode as 'img2img'|'inpaint';}
 if(params.inpaintKind!==undefined){if(!['normal','focused'].includes(String(params.inpaintKind)))throw new Error('重绘类型无效');c.focus.on=params.inpaintKind==='focused';}
 if(params.upscaleKind!==undefined){if(!['native','external'].includes(String(params.upscaleKind)))throw new Error('放大类型无效');const m=editorModels({models:s.models},'upscale').find(m=>(m.provider==='fal')===(params.upscaleKind==='external'));if(!m)throw new Error('没有可用放大来源');c.chosen.upscale=m.id;}
 if(c.upscaleOpen&&Object.keys(params).some(k=>!['editMode','upscaleKind'].includes(k)))throw new Error('放大模式只接受放大类型');
 if(params.effort!==undefined){if(!['high','medium'].includes(String(params.effort))||!naiCapabilities(c.chosen[c.mode]).effort)throw new Error('Effort 仅用于 V5 Full');c.chosen[c.mode]=params.effort==='medium'?NAI_MEDIUM:NAI_FULL;}
 const m=s.models.find(m=>m.id===c.chosen[c.upscaleOpen?'upscale':c.mode]);
 if(!m||!editorModels({models:s.models},c.upscaleOpen?'upscale':c.mode).includes(m))throw new Error('目标型号没有此编辑能力');
 if(params.inpaintKind!==undefined&&c.mode!=='inpaint'||!c.upscaleOpen&&c.mode==='inpaint'&&c.focus.on&&!supportsFocusedInpaint(m))throw new Error('当前型号或操作不支持聚焦重绘');
 if(params.enhance!==undefined){const e=obj(params.enhance);for(const k of Object.keys(e))if(!['enabled','scale','magnitude'].includes(k))throw new Error(`Enhance 参数无效 ${k}`);
   if(e.enabled!==undefined){if(typeof e.enabled!=='boolean')throw new Error('Enhance enabled 需要布尔值');c.enhance.on=e.enabled;}
   if(e.scale!==undefined){if(!s.source||!availableEnhanceScales(s.source,c.chosen.img2img).includes(e.scale as never))throw new Error('此 Enhance 倍率不可用');c.enhance.scale=e.scale as typeof c.enhance.scale;}
   if(e.magnitude!==undefined){if(!Number.isInteger(e.magnitude)||Number(e.magnitude)<1||Number(e.magnitude)>5)throw new Error('Magnitude 须为 1–5');c.enhance.magnitude=Number(e.magnitude);Object.assign(c.enhance,naiEnhanceMagnitudes[Number(e.magnitude)-1]);}
   if(c.enhance.on&&!supportsNaiEnhance(s.models.find(m=>m.id===c.chosen.img2img)??m))throw new Error('当前型号不支持 Enhance');
 }
 for(const key of ['strength','noise'] as const)if(params[key]!==undefined){const value=params[key],range=key==='strength'?editStrengthRange(m.profileId==='nai-official-v1',c.mode==='inpaint'):{min:0,max:m.profileId==='nai-official-v1'?.99:1};
   if(key==='noise'&&c.mode==='inpaint')throw new Error('重绘不接受噪声参数');
   if(typeof value!=='number'||!Number.isFinite(value)||value<range.min||value>range.max)throw new Error(`${key} 超出范围`);
   if(c.mode==='img2img'&&c.enhance.on){if(params.enhance&&obj(params.enhance).magnitude!==undefined&&value!==c.enhance[key])throw new Error('Magnitude 与自定义强度冲突');c.enhance[key]=value;if(!params.enhance||obj(params.enhance).magnitude===undefined)c.enhance.magnitude=null;}
   else c[key][c.mode]=value;
 }
 if(params.focusRect!==undefined){if(c.mode!=='inpaint'||!c.focus.on||!s.source)throw new Error('聚焦框仅用于聚焦重绘');
   if(params.focusRect===null)c.focus.rect=null;
   else {const r=obj(params.focusRect);if(['x','y','w','h'].some(k=>typeof r[k]!=='number'||!Number.isFinite(r[k])||Number(r[k])<0||Number(r[k])>1)||Number(r.w)<=0||Number(r.h)<=0||Number(r.x)+Number(r.w)>1||Number(r.y)+Number(r.h)>1)throw new Error('聚焦框需要有效 0–1 范围');
     c.focus.rect=snapFocusRect(s.source,{x:Number(r.x)*s.source.width,y:Number(r.y)*s.source.height,width:Number(r.w)*s.source.width,height:Number(r.h)*s.source.height});inpaintFocusPlan(s.source,c.focus.rect);
   }
 }
 if(c.mode==='inpaint'&&c.focus.on&&c.focus.rect){if(s.mask.status!=='ready')throw new Error('蒙版摘要尚未就绪');if(s.mask.pixel_bbox&&!focusContains(c.focus.rect,s.mask.pixel_bbox))throw new Error('聚焦框必须完整包含当前蒙版');}
 return c;
}
export function validateEditDraft(draft:Draft,now:DraftState,options:ValidateOptions):DraftPlan {
 const base=draft.base.edit!,live=now.edit;
 let issue=!live?.present?'编辑画板已关闭':live.blocked;
 const s=live??base;let after=structuredClone(s.config);
 if(s.baseId!==base.baseId)issue ||= '底图已变化，请重新提议';
 const extras=draft.steps.filter(step=>step.kind==='edit_config'||step.kind==='director_patch');
 const common=[...draft.steps.filter(step=>step.kind!=='edit_config'&&step.kind!=='director_patch')];
 const extraRows:CheckedStep[]=[];
 try {
   const merged=Object.assign({},...extras.flatMap(step=>step.kind==='edit_config'?[step.params]:[]));
   const model=common.flatMap(step=>step.kind==='params_patch'&&step.params.model?[step.params.model]:step.kind==='restore_partial'&&step.fields.includes('model')&&typeof step.values.model==='string'?[step.values.model]:[]).at(-1);
   const targetMode=merged.editMode==='inpaint'?'inpaint':merged.editMode==='img2img'?'img2img':after.mode;
   if(model)after.chosen[targetMode]=model;
   if(model&&merged.effort&&model!==(merged.effort==='medium'?NAI_MEDIUM:NAI_FULL))throw new Error('model 与 effort 冲突');
   after=configureEdit(s,merged,after);
   if(merged.effort&&!model)common.push({kind:'params_patch',params:{model:after.chosen[after.mode]}});
   if(canonical(s.config)!==canonical(base.config)&&extras.length)throw new Error('编辑配置已变化，请重新提议');
   for(const [i,step] of extras.entries()){
     if(step.kind==='director_patch'){
       if(!s.models.some(m=>m.profileId==='nai-official-v1'&&m.tools.includes('director')))throw new Error('Director Tools 没有可用来源');
       after.director.tool=step.tool as typeof after.director.tool;after.directorOpen=true;after.upscaleOpen=false;
       if(step.tool==='emotion'||step.tool==='colorize')Object.assign(after.director[step.tool],{...(step.prompt!==undefined?{prompt:step.prompt}:{}),...(step.defry!==undefined?{defry:step.defry}:{}),...(step.emotion!==undefined?{emotion:step.emotion}:{})});
     }
     const add=(label:string,before:string,after:string)=>extraRows.push({id:`edit:${i}:${extraRows.length}`,kind:'parameter',label,locked:true,enabled:true,issue:'',aligned:false,before,after});
     const mode=(c:EditConfiguration)=>c.upscaleOpen?'放大':c.mode==='inpaint'?c.focus.on?'聚焦重绘':'重绘':'图生图';
     if(step.kind==='director_patch')add('Director Tools',directorName(s.config.director.tool),[directorName(step.tool as typeof after.director.tool),step.emotion,step.defry===undefined?'':`强度 ${step.defry}`,step.prompt].filter(Boolean).join(' · '));
     else {
       const p=step.params;
       if(p.editMode!==undefined||p.inpaintKind!==undefined)add('编辑模式',mode(s.config),mode(after));
       for(const key of ['strength','noise'] as const)if(p[key]!==undefined) {
         const enhanced=after.mode==='img2img'&&after.enhance.on;
         add(`${enhanced?'Enhance · ':''}${key==='strength'?'强度':'噪声'}`,String(enhanced?s.config.enhance[key]:s.config[key][after.mode]),String(enhanced?after.enhance[key]:after[key][after.mode]));
       }
       if(p.enhance!==undefined)add('Enhance',s.config.enhance.on?`${s.config.enhance.scale}×`:'关闭',after.enhance.on?`${after.enhance.scale==='max'?'Max':after.enhance.scale+'×'} · ${after.enhance.magnitude??'自定义'}${after.mode==='inpaint'?' · 重绘时不生效':''} · 执行时随机 Seed`:'关闭');
       if(p.upscaleKind!==undefined)add('放大类型','',p.upscaleKind==='external'?'外部放大':'原生放大');
       if(p.effort!==undefined)add('Effort',naiCapabilities(s.config.chosen[s.config.mode]).medium?'Medium':'High',p.effort==='medium'?'Medium':'High');
       if(p.focusRect!==undefined){const r=after.focus.rect;add('聚焦框','',r?`${r.x}, ${r.y} · ${r.width}×${r.height}${s.mask.has_mask?'':' · 请在框内涂抹蒙版'}`:'清除');}
     }
   }
 }catch(e){issue ||= e instanceof Error?e.message:String(e);}
 const forMode=(state:EditDraftState)=>({...state,config:{...state.config,mode:after.mode,upscaleOpen:after.upscaleOpen}});
 const baseInner=adapted(draft.base,forMode(base)),liveInner=adapted(now,forMode(s));
 // Shared text/role diff engine operates on the editing form, never IMAGE's form.
 const generic=validateDraft({...draft,target:undefined,base:baseInner,baseHash:stateHash(baseInner),steps:common},liveInner,{...options,editing:true});
 const changes=generic.changes;
 for(const change of changes){if(change.field==='negative')after.fields.negative_prompt=String(change.after);else if(change.field==='model'&&!extras.some(step=>step.kind==='edit_config'&&step.params.effort))after.chosen[after.mode]=String(change.after);else if(['characters','placement','naiReferences'].includes(change.field))Object.assign(after,{[change.field]:structuredClone(change.after)});else if(Object.hasOwn(after.fields,change.field))Object.assign(after.fields,{[change.field]:change.after});}
 const cap=naiCapabilities(after.chosen[after.mode]);
 if(cap.medium&&common.some(step=>step.kind==='prompt_patch'&&step.target.endsWith('negative')||step.kind==='params_patch'&&Object.keys(step.params).some(k=>['steps','sampler','cfgRescale','negativePreset'].includes(k))||step.kind==='character_edit'&&step.negative||step.kind==='restore_partial'&&step.fields.some(k=>['steps','sampler','cfgRescale','negativePreset','negative_prompt'].includes(k)||k==='characters'&&Array.isArray(step.values.characters)&&step.values.characters.some(c=>c.negative))))issue ||= 'Medium 的步数、采样器、负向与 Rescale 固定';
 if(after.upscaleOpen&&!draft.synthetic&&common.some(step=>step.kind==='prompt_patch'||step.kind==='character_edit'||step.kind==='restore_partial'||step.kind==='params_patch'))issue ||= '放大模式不接受提示词或生成参数';
 try { configureEdit(s,{},after);issue ||= checkEditConfiguration(s,after); }catch(e){issue ||= e instanceof Error?e.message:String(e);}
 if(issue&&!extraRows.length&&draft.synthetic)extraRows.push({id:'edit:issue',kind:'parameter',label:'编辑配置',before:'',after:'',issue,enabled:true,locked:true,aligned:false});
 const steps=[...(draft.synthetic?[]:generic.steps),...extraRows].map(step=>({...step,locked:true,issue:step.issue||issue}));
 if(options.off.size)steps.forEach(step=>Object.assign(step,{issue:'编辑配置请整体应用或重新提议'}));
 const edit=!steps.some(step=>step.issue)&&canonical(s.config)!==canonical(after)?{id:s.id,before:s.config,after,baseId:s.baseId,maskRevision:s.maskRevision}:undefined;
 const finalForm=editDrawingForm(s,after);
 const slate=generic.slate?structuredClone(generic.slate):undefined;
 if(slate?.after?.golden_recipe&&draft.steps.some(step=>step.kind==='slate_edit'&&step.captureRecipe))slate.after.golden_recipe.form=boardForm(finalForm);
 const files=generic.files?.map(file=>{
   if(file.document!=='recipe')return file;
   const original=JSON.parse(file.text),doc=recipeDocument({id:s.id,name:s.name,color:'',nextCharacterId:s.nextCharacterId,form:boardForm(finalForm)},finalForm,original.exported_at);
   return {...file,text:doc.formats.json!,summary:`编辑画板 · ${s.name} · ${finalForm.model} · ${finalForm.width} × ${finalForm.height}`};
 });
 const plan={...generic,...(slate?{slate}:{}),...(files?{files}:{}),boardId:undefined,boardName:s.name,editSourceTag:s.sourceTag,workspace:'edit' as const,steps,changes:[],edit,aligned:generic.aligned||!!issue};
 return {...plan,fingerprint:hash(canonical(plan))};
}
