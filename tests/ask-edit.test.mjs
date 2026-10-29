import test from 'node:test';import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/domain/drawing.ts';
import { emptyDirectorSettings } from '../src/domain/director-tools.ts';
import { parseDraft,validateDraft,stateHash } from '../src/ask/draft/validate.ts';
import { summarizeMask } from '../src/domain/mask-summary.ts';
import { editAwareness } from '../src/services/edit-awareness.ts';
const model={id:'nai-diffusion-4-5-full',profileId:'nai-official-v1',provider:'novelai',name:'V4.5',maxPixels:3145728,sourceMaxPixels:3145728,upstreamId:'nai-diffusion-4-5-full',operations:['edit'],tools:['img2img','inpaint','upscale','director'],transparentBackground:false};
const config={mode:'img2img',chosen:{img2img:model.id,inpaint:model.id,upscale:model.id},strength:{img2img:.5,inpaint:1},noise:{img2img:0,inpaint:0},focus:{on:false,rect:null},enhance:{on:false,scale:1,magnitude:3,strength:.5,noise:0},fields:{...DEFAULTS,negative_prompt:'bad',prompt:'cat'},characters:[],placement:'auto',naiReferences:DEFAULTS.naiReferences,director:emptyDirectorSettings(),options:{},upscaleOpen:false,directorOpen:false};
export const base=()=>({workspace:'edit',form:structuredClone(DEFAULTS),composer:'',conversationId:'chat1',models:[model],samplers:['k_euler_ancestral'],edit:{id:'eb1',name:'test',boardSeq:1,present:true,ready:true,baseId:1,viewId:2,maskRevision:1,source:{width:512,height:512,bytes:100,recordId:'source'},config:structuredClone(config),nextCharacterId:1,models:[model],samplers:['k_euler_ancestral'],mask:{has_mask:true,status:'ready',pixel_bbox:{x:96,y:96,width:40,height:40}},blocked:'',photopeaUsed:false}});
const propose=(s,steps)=>parseDraft({draft_title:'test',base_hash:stateHash(s),steps},s,[]);
const validate=(d,s)=>validateDraft(d,s,{off:new Set()});
test('an empty EDIT board never fabricates input budgets or costs, even with a configured model', async()=>{
 const s=base();s.edit.ready=false;s.edit.source=null;
 const state=await editAwareness(s.edit).counted();
 assert.equal(state.ready,false);assert.equal(state.active_board_id,s.edit.id);
 assert.equal(state.input_budget,undefined);assert.equal(state.cost,undefined);
 assert.throws(()=>propose(s,[{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'dog'}]),/导入编辑底图/);
});
test('EDIT defaults to frozen board, changes prompts without touching IMAGE',()=>{
 const s=base(),d=propose(s,[{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'dog'}]),p=validate(d,s);
 assert.equal(p.workspace,'edit');assert.equal(p.edit.after.fields.prompt,'dog');assert.equal(s.form.prompt,'');assert.equal(p.edit.baseId,1);
 assert.throws(()=>propose(s,[{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'dog'},{kind:'prompt_patch',target:'image.prompt',mode:'rewrite',text:'cat'}]),/不能同稿/);
 const closed={...s,edit:undefined};assert.ok(validate(d,closed).steps.some(r=>r.issue.includes('关闭')));
});
test('mode strength belongs to target, focus containment rechecks live mask, no automatic expansion',()=>{
 const s=base(),d=propose(s,[{kind:'params_patch',params:{editMode:'inpaint',inpaintKind:'focused',strength:1,focusRect:{x:.1,y:.1,w:.5,h:.5}}}]),p=validate(d,s);
 assert.equal(p.edit.after.strength.img2img,.5);assert.equal(p.edit.after.strength.inpaint,1);assert.equal(p.edit.after.focus.rect.x,48);
 const next=structuredClone(s);next.edit.maskRevision++;next.edit.mask.pixel_bbox={x:400,y:400,width:32,height:32};
 assert.ok(validate(d,next).steps.some(r=>r.issue.includes('完整包含')));
 const invalid=propose(s,[{kind:'params_patch',params:{editMode:'inpaint',noise:.2}}]);assert.ok(validate(invalid,s).steps.some(r=>r.issue.includes('噪声')));
});
test('Enhance values stay separate, Director is preset only, blocked operations remain pending',()=>{
 const s=base(),d=propose(s,[{kind:'params_patch',params:{enhance:{enabled:true,scale:1},strength:.7}},{kind:'director_patch',tool:'emotion',emotion:'smug',defry:3}]),p=validate(d,s);
 assert.equal(p.edit.after.strength.img2img,.5);assert.equal(p.edit.after.enhance.strength,.7);assert.equal(p.edit.after.director.emotion.emotion,'smug');assert.equal(p.edit.after.directorOpen,true);
 const busy=structuredClone(s);busy.edit.blocked='请先完成高级编辑回传';assert.equal(validate(d,busy).edit,undefined);
});
test('mask summary uses outbound threshold, exact coverage and separate connected regions',()=>{
 const data=new Uint8ClampedArray(8*8*4);for(const [x,y] of [[1,1],[1,2],[6,6]])data[(y*8+x)*4+3]=33;
 data[3]=32;const s=summarizeMask(data,8,8);assert.equal(s.region_count,2);assert.equal(s.coverage_ratio,.047);assert.deepEqual(s.pixel_bbox,{x:1,y:1,width:6,height:6});
});

test('final model drives Medium locks, role capacity and restore validation independent of step order',()=>{
 const s=base(),medium={...model,id:'nai-diffusion-5-full-medium'},full={...model,id:'nai-diffusion-5-full'};
 s.models.push(medium,full);s.edit.models=[...s.models];
 const valid=validate(propose(s,[{kind:'character_edit',op:'add',prompt:'girl'},{kind:'params_patch',params:{model:medium.id}}]),s);
 assert.equal(valid.edit.after.chosen.img2img,medium.id);assert.equal(valid.edit.after.characters.length,1);
 for(const steps of [
   [{kind:'params_patch',params:{model:medium.id,steps:14}}],
   [{kind:'params_patch',params:{model:medium.id}},{kind:'prompt_patch',target:'edit.negative',mode:'rewrite',text:''}],
   [{kind:'params_patch',params:{editMode:'upscale'}},{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'cat'}],
   [{kind:'params_patch',params:{model:full.id,effort:'medium'}}]
 ]) assert.ok(validate(propose(s,steps),s).steps.some(r=>r.issue));
 const picture={id:'history',label:'#h1',aliases:['#h1'],params:{model:medium.id,steps:25},size:{width:512,height:512},blob:new Blob(),origins:[{source:'history',label:'#h1'}]};
 const restore=parseDraft({draft_title:'restore',base_hash:stateHash(s),steps:[{kind:'restore_partial',source:'#h1',fields:['model','steps']}]},s,[picture]);
 assert.ok(validate(restore,s).steps.some(r=>r.issue));
 const switched=validate(propose(s,[{kind:'params_patch',params:{model:full.id}}]),s);assert.equal(switched.edit.after.chosen.img2img,full.id);
});

test('EDIT rejects malformed nested fields and preserves the final recipe in a composite file draft',()=>{
 const s=base();
 assert.throws(()=>propose(s,[{kind:'director_patch',tool:'lineart',unknown:'ignored'}]),/不支持/);
 assert.throws(()=>propose(s,[{kind:'params_patch',params:{enhance:{enabled:'true'}}}]),/类型/);
 const p=validate(propose(s,[{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'new recipe'},{kind:'save_ref',document:'recipe'}]),s);
 assert.equal(p.edit.after.fields.prompt,'new recipe');
 assert.equal(JSON.parse(p.files[0].text).board.form.prompt,'new recipe');
});
