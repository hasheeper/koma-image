import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/domain/drawing.ts';
import { emptyDirectorSettings } from '../src/domain/director-tools.ts';
import { editAwareness } from '../src/services/edit-awareness.ts';
import { imageEditContext } from '../src/domain/edit-image-context.ts';
import { parseDraft, stateHash, validateDraft } from '../src/ask/draft/validate.ts';
import { checkEditConfiguration } from '../src/ask/draft/edit-configuration.ts';
import { proposeDraft } from '../src/ask/draft/tool.ts';

const field=(options,def,extra={})=>({options,default:def,...extra});
const common={chat:true,operations:['generate','edit'],tools:['image-edit'],maxImages:8,maxPixels:4194304,sourceMaxPixels:32000000,parameterSource:'declared',sourceRevision:'r1'};
const models=[
  {...common,id:'gpt-image-2',name:'Image 2',family:'gpt',markup:true,upstreamId:'vendor/custom-img',connection:'a',profileId:'openai-images-v1',provider:'openai',fields:{quality:field(['high','low'],'high'),size:field(['auto','1024x1024'],'auto'),'custom.strength':field([],'0.5',{type:'number',min:0,max:1}),enabled:field([],'true',{type:'boolean'})}},
  {...common,id:'gemini-3-pro-image',name:'香蕉',family:'gemini',upstreamId:'vendor/banana',connection:'b',profileId:'gemini-native-v1',provider:'google',fields:{aspect_ratio:field(['1:1','16:9'],'1:1'),image_size:field(['1K','2K'],'2K')}},
  {...common,id:'my-model',name:'创作模型',family:'seedream',upstreamId:'vendor/custom-seedream',connection:'b',profileId:'seedream-v1',provider:'seedream',fields:{size:field(['2K','3K'],'2K'),watermark:field(['true','false'],'false',{type:'boolean'})}},
];
function base(id=models[0].id) {
  const form=structuredClone(DEFAULTS);
  return {workspace:'edit',boardId:'image',boardPresent:true,form,composer:'',conversationId:'c1',models:structuredClone(models),samplers:['k_euler_ancestral'],
    edit:{id:'edit',name:'编辑板',boardSeq:1,present:true,ready:true,baseId:1,viewId:1,maskRevision:0,nextCharacterId:1,
      source:{width:1200,height:1200,bytes:1,recordId:'src'},models:structuredClone(models),samplers:['k_euler_ancestral'],connectionNames:{a:'来源 A',b:'来源 B'},
      mask:{has_mask:false,status:'ready'},blocked:'',photopeaUsed:false,
      config:{mode:'img2img',chosen:{img2img:id,inpaint:id,upscale:''},strength:{img2img:.5,inpaint:1},noise:{img2img:0,inpaint:0},focus:{on:false,rect:null},enhance:{on:false,scale:1,magnitude:3,strength:.5,noise:0},
        fields:{...form,negative_prompt:''},characters:[],placement:'auto',naiReferences:form.naiReferences,director:emptyDirectorSettings(),options:{},upscaleOpen:false,directorOpen:false}}};
}
const params=values=>({kind:'params_patch',params:values});
const input=(s,steps)=>({base_hash:stateHash(s),draft_title:'修改来源参数',steps});
const proposal=(s,steps)=>parseDraft(input(s,steps),s,[],'调整参数');
const plan=(s,steps,now=s)=>validateDraft(proposal(s,steps),now,{off:new Set()});

test('generic EDIT awareness separates saved/default options, exposes source identity and matching write permissions',()=>{
  for(const m of models){const s=base(m.id),v=editAwareness(s.edit).snapshot;
    assert.deepEqual(v.form.image_options,{});assert.deepEqual(v.effective.image_options,Object.fromEntries(Object.entries(m.fields).map(([k,f])=>[k,f.default])));
    assert.equal(v.source.upstream_id,m.upstreamId);assert.equal(v.source.connection_id,m.connection);
    assert.equal(v.capabilities.available_models.length,models.length);assert.ok(v.capabilities.draft_fields.includes('image_options'));
    assert.equal(v.capabilities.family,m.family);assert.equal(v.capabilities.native_markup,m.markup===true);
    assert.deepEqual(v.capabilities.available_models.map(m=>[m.family,m.native_markup]),[['gpt',true],['gemini',false],['seedream',false]]);
    assert.deepEqual(v.capabilities.modes,['img2img','inpaint']);
    assert.equal(v.capabilities.models,undefined);assert.equal(v.capabilities.emotions,undefined);
    assert.equal(v.input_budget.status,'not_applicable');assert.equal(v.form.steps,undefined);
  }
});

test('source fields accept typed scalars, custom declared keys, reset and omit without mutating unrelated options',()=>{
  const s=base();s.edit.config.options[models[1].id]={image_size:'1K'};
  const p=plan(s,[params({image_options:{quality:'low','custom.strength':.7,enabled:false}}),params({image_options:{size:''}})]);
  assert.ok(p.edit,JSON.stringify(p.steps));assert.ok(p.edit.sourceKey);
  assert.deepEqual(p.edit.after.options[models[0].id],{quality:'low','custom.strength':'0.7',enabled:'false',size:''});
  assert.deepEqual(p.edit.after.options[models[1].id],{image_size:'1K'});
  assert.equal(s.edit.config.options[models[0].id],undefined);
  const next=structuredClone(s);next.edit.config=p.edit.after;
  const reset=plan(next,[params({image_options:{quality:null}})]);
  assert.equal(Object.hasOwn(reset.edit.after.options[models[0].id],'quality'),false);
  assert.equal(editAwareness({...next.edit,config:reset.edit.after}).snapshot.effective.image_options.quality,'high');
  assert.equal(reset.steps.at(-1).after,'high');
});

test('model/mode plus options use the final target contract regardless of step order',()=>{
  const s=base();
  for(const steps of [[params({image_options:{image_size:'1K'}}),params({model:models[1].id,editMode:'inpaint'})],[params({model:models[1].id}),params({editMode:'inpaint',image_options:{image_size:'1K'}})]]) {
    const p=plan(s,steps);assert.ok(p.edit,JSON.stringify(p.steps));
    assert.equal(p.edit.after.chosen.inpaint,models[1].id);assert.equal(p.edit.after.options[models[1].id].image_size,'1K');
  }
});

test('invalid source fields, NAI fields and changed capabilities cannot reach confirmation',async()=>{
  const s=base();
  for(const values of [{quality:'ultra'},{unknown:'x'},{'custom.strength':2},{image_size:'2K'}]) {
    const p=plan(s,[params({image_options:values})]);assert.equal(p.edit,undefined);assert.ok(p.steps.some(r=>r.issue));
    const result=await proposeDraft.run(input(s,[params({image_options:values})]),{draftBase:s,library:[],question:'调整'});
    assert.equal(result.error,true);assert.equal(result.draft,undefined);
  }
  assert.equal(plan(s,[params({image_options:JSON.parse('{"__proto__":"x"}')})]).edit,undefined);
  assert.equal(plan(s,[params({strength:.3})]).edit,undefined);
  const steps=[params({image_options:{quality:'low'}})], p=plan(s,steps), changed=structuredClone(s);
  changed.edit.models[0].fields.quality=field(['high'],'high');
  assert.equal(plan(s,steps,changed).edit,undefined);
  assert.match(checkEditConfiguration(changed.edit,p.edit.after),/参数 quality/);
  const switched=structuredClone(s);switched.edit.models[0].connection='other';
  assert.equal(plan(s,steps,switched).edit,undefined);
});

test('comparison context preserves original/raw/composite identity, frozen mask and pending review across resolution differences',()=>{
  const src={id:1,sequence:1,recordId:'src',entity_key:'a',width:1200,height:1200,kind:'source'};
  const raw={id:2,sequence:2,recordId:'raw',width:1024,height:1024,comparison:{sourceId:1,rawId:2,mask:{width:1200,height:1200,bits:new Uint8Array(180000).fill(255,0,22500)},edges:{dilate:.006,feather:.003}}};
  const session={id:'e',boardSeq:1,baseId:1,viewId:2,versions:[src,raw],imageEdit:{edges:{dilate:.02,feather:0},textOnly:false}};
  const annotation={image:{record_id:'src',entity_key:'a'},width:1200,height:1200,regions:[{shape:'point',bbox:{x:.2,y:.3,w:0,h:0},comment:'眉毛'}]};
  const state=imageEditContext(session,annotation,{mode:'composite',preview:'ready'});
  assert.equal(state.comparison.compatible,true);assert.equal(state.comparison.status,'awaiting_review');assert.equal(state.comparison.composite,null);
  assert.equal(state.comparison.frozen_mask.coverage_ratio,.125);assert.notDeepEqual(state.settings.edges,state.comparison.frozen_edges);
  assert.equal(state.comparison.display.preview,'ready');assert.equal(state.annotations.regions[0].w,undefined);assert.equal(state.annotations.regions[0].x,.2);assert.equal(state.annotations.regions[0].n,1);
  assert.doesNotMatch(JSON.stringify(state),/"bits"|blob:|base64/);
  raw.width=1536;assert.equal(imageEditContext(session).comparison.can_apply,false);
  raw.width=1024;raw.comparison.compositeId=3;session.versions.push({...src,id:3,sequence:3,recordId:'merged'});
  assert.equal(imageEditContext(session).comparison.status,'applied');
});

test('qualified CHAT aliases keep a concrete source for EDIT handoff before candidate expansion',async()=>{
 const {newConversation,beginTurn,contextSnapshot,completeVersion}=await import('../src/domain/conversation.ts');
 const {chatPictures}=await import('../src/ask/chat-context.ts');
 const {createChatPictureIds}=await import('../src/ask/chat-identity.ts');
 const current=newConversation(),{turn,version}=beginTurn(current,contextSnapshot(current),'source',{});
 completeVersion(current,turn,version,[{type:'image',assetId:'asset'}],null,current.selectionRevision);
 const s={...base(),workspace:'image'},library=chatPictures({current,models}, {assets:{assets:new Map([['asset',{id:'asset',width:512,height:768,blob:new Blob(['pixels'])}]])}},false,createChatPictureIds());
 const draft=parseDraft(input(s,[{kind:'edit_handoff',image:'#c1:1.1',prompt:'adjust lighting'}]),s,library);
 assert.equal(draft.editHandoff.image.source,'chat');assert.equal(draft.editHandoff.image.ref,'asset');
 assert.equal(draft.editHandoff.target.source.recordId,library[0].id);
});


test('EDIT reference drafts bind images independently, preserve existing R labels, validate capacity and remain internal',async()=>{
 const {internalDraftSchema,draftSchema}=await import('../src/ask/draft/schema.ts');
 const {remapHandoffDraft,prepareProjectHandoffs}=await import('../src/ask/handoff-images.ts');
 const s=base();s.edit.config.references=[{id:'old',label:'R3',name:'coat',usage:'服装'}];s.edit.nextReferenceNumber=5;
 const pictures=[{id:'old',label:'#e1:r3',aliases:['#e1:r3'],blob:new Blob(['old']),size:{width:100,height:100},createdAt:1,params:{},origins:[{label:'#e1:r3',source:'edit'}]},
 {id:'#a1',label:'#a1',aliases:['#a1'],attachment:true,scope:{kind:'ask',id:'scope'},blob:new Blob(['new']),size:{width:100,height:100},createdAt:1,params:{},origins:[{label:'#a1',source:'attachment'}]}];
 const raw=input(s,[{kind:'edit_references',references:[{image:'#a1',usage:'参考徽章'},{image:'#e1:r3'}]}]);
 const d=parseDraft(raw,s,pictures),p=validateDraft(d,s,{off:new Set()});
 assert.ok(p.edit,JSON.stringify(p.steps));assert.deepEqual(p.edit.after.references.map(r=>[r.label,r.usage]),[['R5','参考徽章'],['R3','服装']]);
 assert.equal(p.edit.after.references[1].id,'old');assert.equal(p.editReferences[0].image.ref,'scope/#a1');assert.equal(s.edit.config.references.length,1);
 assert.equal(validateDraft(d,s,{off:new Set(),has:()=>false}).edit,undefined);
 const changed=structuredClone(s);changed.edit.config.references=[];assert.equal(validateDraft(d,changed,{off:new Set()}).edit,undefined);
 const remapped=remapHandoffDraft(d,'scope','new-scope');assert.equal(remapped.steps.at(-1).items[0].image.ref,'new-scope/#a1');
 const clear=validateDraft(parseDraft(input(s,[{kind:'edit_references',references:[]}]),s,pictures),s,{off:new Set()});assert.deepEqual(clear.edit.after.references,[]);
 assert.ok(internalDraftSchema.properties.steps.items.anyOf.some(step=>step.properties.kind.enum.includes('edit_references')));
 assert.ok(!draftSchema.properties.steps.items.anyOf.some(step=>step.properties.kind.enum.includes('edit_references')));
 const paths=[];await prepareProjectHandoffs({steps:[{kind:'edit_references',references:[{image:'references/logo.png'}]}]},async p=>{paths.push(p);return '#a1';});assert.deepEqual(paths,['references/logo.png']);
 const narrow=base();narrow.edit.models.forEach(m=>m.maxImages=1);const nd=parseDraft(input(narrow,[{kind:'edit_references',references:[{image:'#a1'}]}]),narrow,pictures);assert.equal(validateDraft(nd,narrow,{off:new Set()}).edit,undefined);
 const annotated=structuredClone(s);annotated.edit.models.forEach(m=>m.maxImages=3);annotated.edit.imageEditing={settings:{markup:false,textOnly:false},annotations:{regions:[{comment:'徽章'}]}};
 const annotatedPlan=()=>validateDraft(parseDraft(input(annotated,raw.steps),annotated,pictures),annotated,{off:new Set()});
 assert.equal(annotatedPlan().edit,undefined);assert.match(annotatedPlan().steps.at(-1).issue,/最多可用 1 张/);
 annotated.edit.imageEditing.settings.markup=true;assert.ok(annotatedPlan().edit);
 const named=parseDraft(input(s,[{kind:'prompt_patch',target:'edit.prompt',mode:'rewrite',text:'参考 #a1 的徽章与 #e1:r3 的服装'},...raw.steps]),s,pictures);
 const namedPlan=validateDraft(named,s,{off:new Set()});assert.equal(namedPlan.edit.after.fields.prompt,'参考 R5 的徽章与 R3 的服装');assert.equal(namedPlan.steps[0].after,'参考 R5 的徽章与 R3 的服装');
 s.edit.config.fields.prompt='参考 #e1:r3 的服装';
 const patch=parseDraft(input(s,[{kind:'prompt_patch',target:'edit.prompt',mode:'replace',anchor:'#e1:r3 的服装',text:'#e1:r3 的徽章'}]),s,pictures);
 assert.equal(validateDraft(patch,s,{off:new Set()}).edit.after.fields.prompt,'参考 R3 的徽章');
});
