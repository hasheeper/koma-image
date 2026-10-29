import { checkShape } from './schema-check.ts';
import { draftSchema } from './schema.ts';
import { editorModels, validateEditorSource } from "../../domain/media.ts";
import { isEnhanceScale } from "../../domain/nai-enhance.ts";
import type {Draft,DraftState,DraftPlan,ValidateOptions,EditHandoff} from './types.ts';
import type {Picture} from '../library.ts';
import {parseDraft,stateHash,validateDraft} from './validate.ts';
import {editStateHash} from '../../domain/edit-draft.ts';
import type {EditDraftState,EditConfiguration} from '../../domain/edit-draft.ts';
import {DEFAULTS} from '../../domain/drawing.ts';
import {readNaiSettings} from '../../domain/nai.ts';
import {readCharacters,nextCharacterId} from '../../domain/characters.ts';
import {readReferences} from '../../domain/nai-references.ts';
import {sourceRecipe} from '../../domain/image-parameters.ts';
import {emptyDirectorSettings} from '../../domain/director-tools.ts';
import {hash} from '../digest/index.ts';
import {canonical} from '../canonical.ts';

export function initialEditState(p:Picture,base:DraftState):EditDraftState {
 const models=base.edit?.models.length?base.edit.models:base.models;
 const recipe=sourceRecipe(p.params)??{},characters=readCharacters(recipe.localCharacters??recipe.characters);
 const chosen=Object.fromEntries(['img2img','inpaint','upscale'].map(mode=>[mode,(editorModels({models},mode as 'img2img'|'inpaint'|'upscale').find(m=>m.id===recipe.model)??editorModels({models},mode as 'img2img'|'inpaint'|'upscale')[0])?.id??''])) as EditConfiguration['chosen'];
 const settings={...DEFAULTS,...readNaiSettings({...recipe,cfgRescale:recipe.cfgRescale??recipe.cfg_rescale})};
 const fields={...readNaiSettings(settings),transparentBg:recipe.transparentBg===true,prompt:String(recipe.basePrompt??recipe.prompt??''),negative_prompt:String(recipe.baseNegative??recipe.negative_prompt??recipe.negative??''),
   sampler:typeof recipe.sampler==='string'?recipe.sampler:DEFAULTS.sampler,steps:typeof recipe.steps==='number'?recipe.steps:DEFAULTS.steps,scale:typeof recipe.scale==='number'?recipe.scale:DEFAULTS.scale,seed:recipe.seed==null?'':String(recipe.seed),detail:''};
 const config:EditConfiguration={mode:'img2img',chosen,strength:{img2img:.5,inpaint:1},noise:{img2img:0,inpaint:0},focus:{on:false,rect:null},enhance:{on:false,scale:1,magnitude:3,strength:.5,noise:0},fields,characters,placement:recipe.placement==='manual'?'manual':'auto',naiReferences:readReferences(recipe.naiReferences),director:emptyDirectorSettings(),options:{},upscaleOpen:false,directorOpen:false};
 if(recipe.tool==='img2img'||recipe.tool==='inpaint')for(const key of ['strength','noise'] as const){const value=recipe[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1)config[key][recipe.tool]=value;}
 if(recipe.enhance===true&&isEnhanceScale(recipe.enhanceScale))config.enhance={on:true,scale:recipe.enhanceScale,magnitude:typeof recipe.enhanceMagnitude==='number'&&Number.isInteger(recipe.enhanceMagnitude)&&recipe.enhanceMagnitude>=1&&recipe.enhanceMagnitude<=5?recipe.enhanceMagnitude:null,strength:typeof recipe.strength==='number'?recipe.strength:.5,noise:typeof recipe.noise==='number'?recipe.noise:0};
 return {id:crypto.randomUUID(),name:`编辑 ${p.label}`,boardSeq:0,present:true,ready:true,baseId:1,viewId:1,maskRevision:0,source:{...p.size,bytes:p.blob.size,recordId:p.id},config,nextCharacterId:nextCharacterId(characters),models:structuredClone(models),samplers:base.edit?.samplers??base.samplers,mask:{has_mask:false,status:'ready'},blocked:'',photopeaUsed:false};
}
export function parseEditHandoff(input:Readonly<Record<string,unknown>>,base:DraftState,library:readonly Picture[],question:string):Draft {
 if(input.base_hash!==stateHash(base))throw new Error('草稿 base_hash 与本轮快照不符');
 if(!Array.isArray(input.steps)||input.steps.length>12||input.steps.some(s=>!s||typeof s!=='object'||Array.isArray(s)))throw new Error('交接步骤无效');
 const raw=input.steps as Record<string,unknown>[],steps=raw.filter(s=>s.kind==='edit_handoff');
 if(steps.length!==1||raw.some(s=>!['edit_handoff','slate_edit'].includes(String(s.kind))))throw new Error('交接只能与任务步骤组合');
 const step=steps[0];
 checkShape(step,draftSchema.properties.steps.items.anyOf.find(s=>s.properties.kind.enum.includes('edit_handoff'))!,'编辑交接');
 const label=String(step.image??''),p=library.find(p=>p.aliases.includes(label)),origin=p?.origins.find(o=>o.label===label);
 if(!p||!origin||origin.source==='attachment'||label.startsWith('#a'))throw new Error('交接来源不在本轮工作区图片快照中');
 const existing=base.editBoards?.find(s=>s.recordIds?.includes(p.id)||s.sourceKey===`record:${p.id}`||s.id===p.params.editBoardId);
 const target=structuredClone(existing??initialEditState(p,base));
 const params=step.params===undefined?{}:step.params;
 if(!params||typeof params!=='object'||Array.isArray(params))throw new Error('params 无效');
 const proposalSteps:Record<string,unknown>[]=[{kind:'params_patch',params:{...params,editMode:step.mode??'img2img',...(step.inpaint_kind?{inpaintKind:step.inpaint_kind}:{}),...(step.focus_rect?{focusRect:step.focus_rect}:{})}}];
 for(const field of ['prompt','negative'])if(step[field]!==undefined)proposalSteps.push({kind:'prompt_patch',target:`edit.${field}`,mode:'rewrite',text:step[field]});
 if(step.director_tool)proposalSteps.push({...step.director_tool as object,kind:'director_patch'});
 proposalSteps.push(...raw.filter(s=>s.kind==='slate_edit'));
 const fakeBase={...base,workspace:'edit' as const,edit:target};
 const proposal=parseDraft({...input,base_hash:editStateHash(target),steps:proposalSteps},fakeBase,library,question);
 const image={label,source:origin.source,ref:origin.source==='chat'?p.scope?.asset_id??p.id:p.id,binding:p.bindings?.[label]};
 const handoff:EditHandoff={image,target,created:!existing,proposal,params:structuredClone(p.params),origin:origin.source==='chat'?'chat':origin.source==='edit'?'edit':'image'};
 return {...proposal,target:undefined,base:structuredClone(base),baseHash:stateHash(base),editHandoff:handoff};
}
export function validateEditHandoff(draft:Draft,now:DraftState,options:ValidateOptions):DraftPlan {
 const h=draft.editHandoff!,found=now.editBoards?.find(s=>s.id===h.target.id);
 const target=h.created&&!found?h.target:found;
 const p=validateDraft(h.proposal,{...now,workspace:'edit',edit:target},options);
 let issue=options.has?.(h.image)===false?'交接来源已移除':'';
 if(h.created&&found)issue ||= '目标画板已存在';
 const steps=[{id:'edit:handoff',kind:'parameter' as const,label:h.created?'新建编辑画板':'修改已有编辑画板',enabled:true,locked:true,aligned:false,issue,before:h.image.label,after:target?.name??h.target.name},...p.steps.map(s=>({...s,issue:s.issue||issue}))];
 const mode=p.edit?.after.upscaleOpen?'upscale':p.edit?.after.mode??target?.config.mode??'img2img';
 const model=target?.models.find(m=>m.id===(p.edit?.after??target.config).chosen[mode]);
 const sourceIssue=target?.source?validateEditorSource(mode,model,target.source):null;
 if(sourceIssue)steps.push({id:'edit:size',kind:'parameter',label:'底图尺寸',enabled:true,locked:true,aligned:false,issue:'',before:`${target!.source!.width}×${target!.source!.height}`,after:`需先调整 · ${sourceIssue}`});
 const result={...p,edit:p.edit??(!steps.some(s=>s.issue)&&target?{id:target.id,before:target.config,after:target.config,baseId:target.baseId,maskRevision:target.maskRevision}:undefined),editHandoff:h,steps};
 return {...result,fingerprint:hash(canonical(result))};
}
