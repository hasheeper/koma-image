import test from 'node:test';
import { createChatPictureIds } from '../src/ask/chat-identity.ts';
import assert from 'node:assert/strict';
import { newConversation, beginTurn, beginVersion, completeVersion, contextSnapshot, chatDraftKey } from '../src/domain/conversation.ts';
import { chatImage, chatTurn, chatSnapshot, chatContext, chatDraftModel, chatModelState, chatPictures } from '../src/ask/chat-context.ts';
import { draftView } from '../src/ask/draft/view.ts';
import { summarizePlan } from '../src/ask/compact/ledger.ts';
import { idPattern } from '../src/ask/ids.ts';
import { searchHistory } from '../src/ask/search-history.ts';
import { DEFAULTS } from '../src/domain/drawing.ts';
import { handoffImage, parseDraft, stateHash, validateDraft } from '../src/ask/draft/validate.ts';
import { createTools } from '../src/ask/tools.ts';
import { normalizeCatalog } from '../src/domain/catalog.ts';
import { nativeCatalog, nativeMappedCatalog } from '../src/gateway/native-protocols.ts';
import { profileFor } from '../src/gateway/profile.ts';
import { SEEDREAM_LITE, SEEDREAM_55 } from '../src/domain/seedream.ts';
function fixture(){
 const current=newConversation();
 for(let n=1;n<=3;n++){const {turn,version}=beginTurn(current,contextSnapshot(current),`prompt ${n}`,{});completeVersion(current,turn,version,[{type:'image',assetId:`image${n}`}],null,current.selectionRevision);}
 current.prompt='next input';current.keepIds=['reference1','reference2'];
 return {current,model:{maxImages:2},quota:null};
}
test('ASK CHAT context: locked current branch, selected texts, image cap/drops, actual text, no private IDs or settings',()=>{
 const s=fixture();s.current.skipTurnIds=[s.current.turns[1].id];s.current.settings.secret='not outbound';
 const result=createTools().get('get_chat_context').run({}, {chatContext:chatContext(s)});
 const text=result.content[0].text;
 assert.match(text,/#c3.1/);assert.match(text,/prompt 1/);assert.doesNotMatch(text,/not outbound/);
 const ctx=chatContext(s);assert.deepEqual(ctx.turns.map(t=>t.included),[true,false,true]);
 assert.equal(ctx.images.sent,2);assert.equal(ctx.images.dropped,1);assert.match(ctx.actual_text,/next input/);assert.doesNotMatch(ctx.actual_text,/prompt 2/);
});
test('ASK CHAT model: declared family and whitelisted controls, no source identities or arbitrary settings',()=>{
 const s=fixture(),gemini={id:'gemini-3-pro-image',upstreamId:'private-upstream',connection:'private-connection',name:'Gemini Image',family:'gemini',parameterSource:'declared',maxImages:14,fields:{
  aspect_ratio:{options:['1:1','16:9','9:16'],default:'1:1'},image_size:{options:['1K','2K','4K'],default:'1K'},output_format:{options:['png','jpeg'],default:'png'},seed:{options:['secret-field'],default:'secret-field'}}};
 s.current.settings={model:gemini.id,options:{aspect_ratio:'16:9',image_size:'8K',secret:'not outbound'}};
 const state={...s,ready:true,model:gemini,models:[gemini,{...gemini,id:'other',name:'Gemini Image'},{...gemini,id:'gpt',name:'GPT Image',fields:{}}]};
 const model=chatModelState(state);
 assert.deepEqual(model,{ready:true,name:'Gemini Image',family:'gemini',parameter_source:'declared',native_markup:false,max_images:14,read_only:{output_format:{value:'png',options:['png','jpeg']}},writable:{aspect_ratio:{value:'16:9',options:['1:1','16:9','9:16']},image_size:{value:'1K',options:['1K','2K','4K']}}});
 const openai={...gemini,name:'GPT Image',family:'gpt',maxImages:16,fields:{size:{options:['auto','1024x1024','1536x1024','1024x1536'],default:'auto'},quality:{options:['auto','low','medium','high'],default:'auto'}}};
 s.current.settings={model:'gpt',options:{size:'1536x1024',quality:'high'}};
 assert.deepEqual(chatModelState({...state,model:openai}),{ready:true,name:'GPT Image',family:'gpt',parameter_source:'declared',native_markup:false,max_images:16,writable:{size:{value:'1536x1024',options:['auto','1024x1024','1536x1024','1024x1536']}},read_only:{quality:{value:'high',options:['auto','low','medium','high']}}});
 const ctx=chatContext(state),text=JSON.stringify(ctx);
 assert.deepEqual(ctx.available_models,['Gemini Image','GPT Image']);
 for(const secret of ['private-upstream','private-connection','gemini-3-pro-image','not outbound','secret-field'])assert.doesNotMatch(text,new RegExp(secret));
 assert.equal(chatModelState({...state,model:{...openai,family:undefined,parameterSource:undefined}}).family,null,'no family guessed from a display name');
 assert.deepEqual(chatModelState({...state,ready:false}),{ready:false});assert.deepEqual(chatContext({...state,ready:false}).available_models,[]);
});
test('ASK sees 2.6 and Seedream capabilities through renamed models and custom upstream IDs without widening drafts',()=>{
 for(const [templateId,profileId,family,control,chosen] of [
  ['gpt-image-2.6-sunburst','openai-images-v1','gpt','complexity','medium'],
  [SEEDREAM_LITE,'seedream-v1','seedream','watermark','false'],
  [SEEDREAM_55,'seedream-v1','seedream','watermark','false'],
 ]){
  const profile=profileFor(profileId),id='model-synthetic',connection='private-connection',upstream='private-upstream',config={version:1,
   models:[{id,name:'我的创作模型',templateId,defaults:{}}],
   connections:{[connection]:{id:connection,name:'private-name',profileId:profile.id,baseUrl:'https://private.example.test',credentialRef:'private-key',revision:'r1'}},
   links:{[connection]:{[id]:{id:upstream,manual:true,on:true}}}};
  const raw=nativeMappedCatalog(profile,nativeCatalog(profile,{data:[{id:upstream}]}),config,connection);
  const model=normalizeCatalog(raw,config,connection,profile).models.find(m=>m.id===id);
  assert.ok(model,templateId);
  const state={...fixture(),ready:true,model,models:[model]};state.current.settings={model:id,options:{[control]:chosen,unknown:'private-option'}};
  const projected=chatModelState(state);
  assert.equal(projected.family,family);assert.equal(projected.parameter_source,'reference');
  assert.equal(projected.read_only[control].value,chosen);assert.equal(projected.read_only.output_format.value,'png');
  assert.equal(projected.native_markup,family==='gpt');assert.equal(projected.max_images,model.maxImages);
  assert.deepEqual(Object.keys(projected.writable),['size']);
  assert.deepEqual(chatDraftModel(state),{id,name:model.name,maxImages:model.maxImages,writable:projected.writable});
  assert.doesNotMatch(JSON.stringify(projected),/private-|model-synthetic/);
  const fields={...model.fields};delete fields[control];
  assert.equal(chatModelState({...state,model:{...model,fields,markup:false}}).read_only[control],undefined,'removed source controls stay absent');
  assert.equal(chatModelState({...state,model:{...model,markup:false}}).native_markup,false);
 }
});
test('ASK CHAT branch: source locked, optional text/exclusions, stale context blocks every write and new source stays unsent',()=>{
 const s=fixture(),base={form:{...DEFAULTS},composer:s.current.prompt,conversationId:s.current.id,models:[],samplers:[],chat:chatSnapshot(s)};
 const d=parseDraft({title:'提纯分支',base_hash:stateHash(base),steps:[{kind:'chat_distill_branch',source:'#c1.1',exclude:['#c2.1','#c3.1'],text:'distilled'}]},base,[]);
 const p=validateDraft(d,base,{off:new Set()});assert.ok(p.steps[0].locked);assert.equal(p.branch.after.headId,s.current.turns[0].id);assert.equal(p.branch.after.mainId,'image1');assert.equal(p.branch.after.prompt,'distilled');
 const off=validateDraft(d,base,{off:new Set(['0:exclude','0:text'])});assert.deepEqual(off.branch.after.skipTurnIds,[]);assert.equal(off.branch.after.prompt,'next input');
 s.current.keepIds.push('manual');const stale=validateDraft(d,{...base,chat:chatSnapshot(s)},{off:new Set()});assert.equal(stale.branch,undefined);assert.ok(stale.steps.every(s=>s.issue));
 assert.throws(()=>parseDraft({title:'x',base_hash:stateHash(base),steps:[{kind:'chat_distill_branch',source:'#c9.1',exclude:[],text:'x'}]},base,[]),/起点/);
});
test('ASK CHAT ids: every version and image is addressable, #cN.M aliases the first image, branch source uses the exact requested version',()=>{
 const s=fixture(),c=s.current,t2=c.turns[1],head=c.turns[2].id;
 const v=beginVersion(t2);completeVersion(c,t2,v,[{type:'image',assetId:'image2b'},{type:'text',text:'note'},{type:'image',assetId:'image2c'}],null,c.selectionRevision);
 const failed=beginVersion(t2);failed.status='error';t2.selectedVersion=1;c.headId=head;
 t2.settings={model:'gpt',options:{size:'1536x1024',quality:'high',secret:'not outbound'}};
 const state={...s,ready:true,model:{name:'GPT Image',maxImages:2,fields:{}},models:[{id:'gpt',name:'GPT Image',connection:'private-connection',fields:{}}]};
 const chat={assets:{assets:new Map(['image1','image2','image2b','image2c','image3'].map(id=>[id,{width:64,height:48,blob:new Blob()}]))}};
 const library=chatPictures(state,chat);
 assert.deepEqual(library.map(p=>p.label),['#c1.1','#c2.1','#c2.2a','#c2.2b','#c3.1']);
 assert.deepEqual(library.map(p=>p.origins[0].order),[1,2,3,4,5]);
 assert.equal(new Set(library.map(p=>p.id)).size,5);
 assert.ok(library[2].aliases.includes('#c2.2'));assert.ok(library[1].aliases.includes('#c2.1.1'));
 const tools=createTools(),meta=JSON.parse(tools.get('get_meta').run({id:'#c2.2'},{library}).content[0].text.match(/\{[\s\S]*\}/)[0]);
 assert.equal(meta.id,'#c2.2');assert.equal(meta.version,2);assert.equal(meta.image_index,1);assert.equal(meta.selected,true);
 assert.equal(meta.modelName,'GPT Image');assert.deepEqual(meta.chat_options,{quality:'high',size:'1536x1024'});
 assert.doesNotMatch(JSON.stringify(library.map(p=>p.params)),/not outbound|private-connection/);
 assert.throws(()=>tools.get('get_meta').run({id:'#c2.3'},{library}),/不在本轮图片快照/);
 assert.deepEqual('#c2.2.2 与 #c2.1。'.match(idPattern),['#c2.2.2','#c2.1']);
 assert.deepEqual(searchHistory({scope:'chat',limit:15},library,0).matches.map(m=>m.id),['#c3.1','#c2.2b','#c2.2a','#c2.1','#c1.1']);
 const ctx=chatContext(state);
 assert.deepEqual(ctx.turns[1].versions,[{id:'#c2.1',status:'done',selected:false,images:['#c2.1']},{id:'#c2.2',status:'done',selected:true,images:['#c2.2a','#c2.2b']},{id:'#c2.3',status:'error',selected:false,images:[]}]);
 assert.equal(ctx.turns[1].id,'#c2.2');
 const base={form:{...DEFAULTS},composer:c.prompt,conversationId:c.id,models:[],samplers:[],chat:chatSnapshot(state)};
 const branch=source=>parseDraft({title:'分支',base_hash:stateHash(base),steps:[{kind:'chat_distill_branch',source,exclude:['#c3.1.1'],text:'x'}]},base,[]);
 const p=validateDraft(branch('#c2.2.2'),base,{off:new Set()});
 assert.equal(p.branch.after.headId,t2.id);assert.equal(p.branch.after.mainId,'image2c');assert.deepEqual(p.branch.after.skipTurnIds,[c.turns[2].id]);
 assert.equal(validateDraft(branch('#c2.2'),base,{off:new Set()}).branch.after.mainId,'image2b');
 assert.equal(validateDraft(branch('#c2.1'),base,{off:new Set()}).branch.after.mainId,'image2');assert.throws(()=>branch('#c2.3'),/起点/);
 assert.throws(()=>parseDraft({title:'x',base_hash:stateHash(base),steps:[{kind:'chat_distill_branch',source:'#c2.2',exclude:['#c9.1'],text:'x'}]},base,[]),/排除轮次/);
 // Drafts saved before multi-version IDs keep resolving the selected first image.
 const legacy={...base,chat:{...base.chat,sources:base.chat.sources.map(({versions,...rest})=>rest)}};
 const old=parseDraft({title:'旧',base_hash:stateHash(legacy),steps:[{kind:'chat_distill_branch',source:'#c1.1',exclude:[],text:'x'}]},legacy,[]);
 assert.equal(validateDraft(old,legacy,{off:new Set()}).branch.after.mainId,'image1');
});
test('ASK CHAT handoff: one step, whitelisted size values, deduplicated images within the cap, IMAGE-origin CHAT writes redirected',()=>{
 const s=fixture(),openai={id:'gpt',name:'GPT Image',maxImages:2,fields:{size:{options:['auto','1024x1024','1536x1024','1024x1536'],default:'auto'},quality:{options:['auto','high'],default:'auto'}}};
 s.current.settings={model:'gpt',options:{size:'auto',quality:'high'}};
 const state={...s,ready:true,model:openai,models:[openai]};
 const library=[{id:'record-1',aliases:['#h1','#f1'],origins:[{source:'history',label:'#h1',order:1},{source:'favorites',label:'#f1',order:1}],params:{},size:{width:64,height:64}},
  {id:'attachment-1',aliases:['#a1'],origins:[{source:'attachment',label:'#a1',order:1}],params:{},size:{width:64,height:64}},
  {id:'edit-record',aliases:['#e2','#e1.2'],origins:[{source:'edit',label:'#e2',order:2},{source:'edit',label:'#e1.2',order:2}],params:{},size:{width:64,height:64}}];
 const base={form:{...DEFAULTS},composer:s.current.prompt,conversationId:s.current.id,models:[],samplers:[],chat:chatSnapshot(state),workspace:'image',chatModel:chatDraftModel(state)};
 assert.deepEqual(base.chatModel,{id:'gpt',name:'GPT Image',maxImages:2,writable:{size:{value:'auto',options:['auto','1024x1024','1536x1024','1024x1536']}}});
 const draft=(step,b=base)=>parseDraft({title:'交接',base_hash:stateHash(b),steps:[{kind:'chat_handoff',images:[],options:{},text:'close-up',...step}]},b,library);
 assert.deepEqual(draft({images:['#e2','#e1.2']}).steps[0].images,[{label:'#e2',source:'edit',ref:'edit-record'}]);
 const d=draft({images:['#h1','#f1','#c2.1'],options:{size:'1536x1024'}});
 assert.deepEqual(d.steps[0].images,[{label:'#h1',source:'history',ref:'record-1'},{label:'#c2.1',source:'chat',ref:'image2'}]);
 const p=validateDraft(d,base,{off:new Set()});
 assert.deepEqual(p.handoff,{model:'gpt',options:{size:'1536x1024'},text:d.steps[0].text,images:d.steps[0].images});
 assert.deepEqual(p.changes,[{field:'composer',before:'',after:d.steps[0].text}]);assert.equal(p.workspace,'chat');
 assert.deepEqual(p.steps.map(s=>s.id),['0:new','0:image:0','0:image:1','0:option:size','0:text']);
 assert.ok(p.steps[0].locked);assert.equal(p.steps[3].displayBefore,'自动');assert.equal(p.steps[3].displayAfter,'横向');
 assert.deepEqual(draftView(p).fields.map(f=>f.key),['handoff','composer']);assert.match(summarizePlan(p).delta,/handoff/);
 // The header names the new conversation; images are reference rows and the input is shown verbatim.
 const view=draftView(validateDraft(draft({images:['#h1','#c2.1'],options:{size:'1536x1024'},text:'参考 #h1，改成横版\n保留红色外套'}),base,{off:new Set()}));
 assert.deepEqual(view.destination,{label:'新对话',name:'GPT Image'});
 assert.deepEqual(view.fields[0].steps.map(s=>[s.kind,s.kind==='ref'?s.label:s.kind==='param'?s.after:'']),[['ref','#h1'],['ref','#c2.1'],['param','横向']]);
 assert.equal(view.fields[1].full,null);assert.match(view.fields[1].steps[0].hunks[0][0].text,/参考 第 1 张图，改成横版\n保留红色外套/);
 assert.deepEqual(p.steps.filter(s=>s.id.startsWith('0:image:')).map(s=>[s.label,s.locked]),[['底图',true],['参考图 1',true]]);
 for(const [key,value] of Object.entries({quality:'high',complexity:'medium',watermark:'false',output_format:'png',native_markup:'true'}))
  assert.throws(()=>draft({options:{[key]:value}}),/不能由草稿写入；需要时在回复中提醒用户手动调整/);
 assert.throws(()=>draft({options:{aspect_ratio:'16:9'}}),/没有 aspect_ratio/);
 assert.throws(()=>draft({options:{size:'4096x4096'}}),/size 只能取/);
 assert.throws(()=>draft({images:['#a1']}),/附件不能/);
 assert.throws(()=>draft({images:['#h1','#c1.1','#c3.1']}),/最多使用 2 张/);
 assert.throws(()=>draft({images:['#c9.1']}),/不在当前分支/);
 assert.throws(()=>draft({text:'  '}),/非空/);
 assert.throws(()=>draft({},{...base,chatModel:null}),/未就绪/);
 assert.throws(()=>parseDraft({title:'x',base_hash:stateHash(base),steps:[{kind:'chat_handoff',images:[],options:{},text:'a'},{kind:'chat_handoff',images:[],options:{},text:'b'}]},base,library),/独立提交/);
 const patch={kind:'prompt_patch',target:'chat.composer',mode:'rewrite',text:'x'},branch={kind:'chat_distill_branch',source:'#c3.1',exclude:[],text:'x'};
 for(const workspace of ['image','tags'])for(const step of [patch,branch]){
  const b={...base,workspace};assert.throws(()=>parseDraft({title:'x',base_hash:stateHash(b),steps:[step]},b,[]),/改用 chat_handoff/);
 }
 const inChat={...base,workspace:'chat'};
 for(const step of [patch,branch])assert.equal(parseDraft({title:'x',base_hash:stateHash(inChat),steps:[step]},inChat,[]).steps.length,1);
 const removed=validateDraft(d,base,{off:new Set(),has:i=>i.source==='chat'});
 assert.match(removed.steps[1].issue,/图片已移除/);assert.equal(removed.handoff,undefined);assert.notEqual(removed.fingerprint,p.fingerprint);
 const switched=validateDraft(d,{...base,chatModel:{...base.chatModel,id:'other'}},{off:new Set()});
 assert.ok(switched.steps.every(s=>s.issue==='对话模型已变化，请重新提议'));assert.equal(switched.handoff,undefined);assert.deepEqual(switched.changes,[]);
 assert.equal(validateDraft(d,{...base,chatModel:null},{off:new Set()}).handoff,undefined);
 const narrowed=validateDraft(d,{...base,chatModel:{...base.chatModel,writable:{size:{value:'auto',options:['auto']}}}},{off:new Set()});
 assert.equal(narrowed.steps[3].issue,'当前模型不支持此值');assert.deepEqual(narrowed.handoff.options,{});
 const off=validateDraft(d,base,{off:new Set(['0:text','0:image:0'])});
 assert.equal(off.handoff,undefined);assert.deepEqual(off.changes,[]);assert.match(off.steps[0].issue,/整体应用/);
 assert.equal(validateDraft(d,base,{off:new Set(['0:text','0:image:0','0:image:1'])}).handoff,undefined);
});
test('ASK CHAT conflict fingerprint covers versions, generation and context, preserves cosmetic title edits',()=>{
 const s=fixture(),key=chatDraftKey(s.current);s.current.title='rename';assert.equal(chatDraftKey(s.current),key);
 s.current.turns[0].selectedVersion=1;assert.notEqual(chatDraftKey(s.current),key);
});

test('qualified CHAT IDs distinguish conversations and survive branching and local composition',()=>{
 const ids=createChatPictureIds(), a=fixture(), b=fixture();
 const assets=new Map(['image1','image2','image3','merged'].map(id=>[id,{id,width:64,height:48,blob:new Blob()}]));
 const chat={assets:{assets}}, state=s=>({...s,models:[]});
 const before=chatPictures(state(a),chat,true,ids), other=chatPictures(state(b),chat,true,ids);
 assert.equal(before[0].label,'#c1:1.1');assert.equal(other[0].label,'#c2:1.1');
 assert.deepEqual('#c1:1.1、#c2:1.1b、#c2:1.1.27。'.match(idPattern),['#c1:1.1','#c2:1.1b','#c2:1.1.27']);
 a.current.headId=a.current.turns[0].id;
 a.current.turns[0].versions[0].composites={image1:'merged'};
 const after=chatPictures(state(a),chat,true,ids);
 for(const p of before)assert.equal(after.find(x=>x.id===p.id).label,p.label,'raw sample keeps its code');
 const merged=after.find(p=>p.scope.asset_id==='merged');assert.notEqual(merged.label,before[0].label);
 const snapshot=chatSnapshot(state(a),true,ids);
 assert.equal(chatImage(snapshot,before[0].label).assetId,'image1');
 assert.equal(chatImage(snapshot,merged.label).assetId,'merged');
 assert.equal(chatTurn(snapshot,before[2].label).turnId,a.current.turns[2].id);
 assert.equal(chatImage(snapshot,other[0].label),null,'foreign conversation cannot be used as a local branch');
 assert.equal(handoffImage(other[0].label,{chat:snapshot},other).ref,'image1','qualified foreign images can be handed off after reading');
 const base={workspace:'chat',form:{...DEFAULTS},composer:a.current.prompt,conversationId:a.current.id,models:[],samplers:[],chat:snapshot};
 const draft=parseDraft({title:'回退原图',base_hash:stateHash(base),steps:[{kind:'chat_distill_branch',source:before[0].label,exclude:[],text:'new direction'}]},base,after);
 assert.equal(validateDraft(draft,base,{off:new Set()}).branch.after.mainId,'image1');
});

test('CHAT input codes expose exact base/reference roles and can be handed off without pretending to be generated versions', () => {
 const s={...fixture(),models:[]},ids=createChatPictureIds(),blob=new Blob(['original']);
 const chat={assets:{assets:new Map(['image1','image2','image3','reference1','reference2'].map(id=>[id,{id,width:64,height:48,blob}]))}};
 const library=chatPictures(s,chat,false,ids),ctx=chatContext(s,library);
 assert.deepEqual(ctx.input_images.map(p=>[p.id,p.role,p.included]),[['#c3.1','base',true],['#c1:r1','reference',true],['#c1:r2','reference',false]]);
 assert.deepEqual([...('#c1:r1 和 #c1:r2。').matchAll(idPattern)].map(m=>m[0]),['#c1:r1','#c1:r2']);
 const ref=library.find(p=>p.label==='#c1:r1');assert.equal(ref.blob,blob);assert.equal(handoffImage(ref.label,{},library).ref,'reference1');
 assert.equal(chatImage(chatSnapshot(s,false,ids),ref.label),null,'an uploaded reference is not a rollback version');
 s.current.keepIds.reverse();assert.equal(chatPictures(s,chat,false,ids).find(p=>p.scope.asset_id==='reference1').label,ref.label,'reordering does not rename uploaded images');
 const other={...s,current:{...s.current,id:'another'}};assert.notEqual(chatPictures(other,chat,false,ids).find(p=>p.scope.asset_id==='reference1').label,ref.label);
});

test('current CHAT image drafts freeze context and keep images plus text together', () => {
 const s={...fixture(),models:[]},ids=createChatPictureIds(),chat={assets:{assets:new Map(['image1','image2','image3','reference1','reference2'].map(id=>[id,{id,width:64,height:48,blob:new Blob(['x'])}]))}};
 const base={form:{...DEFAULTS},composer:'old text',conversationId:s.current.id,workspace:'chat',models:[],samplers:[],chat:chatSnapshot(s,false,ids),chatModel:{id:'gpt',name:'GPT',maxImages:3,writable:{}}};
 const library=chatPictures(s,chat,false,ids),step={kind:'chat_handoff',destination:'current',images:['#c3.1','#c1:r1'],base_image:'#c1:r1',options:{},text:'修正 #c1:r1，光线参考 #c3.1'};
 const draft=parseDraft({base_hash:stateHash(base),draft_title:'准备底图',steps:[step]},base,library),plan=validateDraft(draft,base,{off:new Set()});
 assert.deepEqual(plan.handoff.current,{id:base.conversationId,key:base.chat.key});assert.equal(plan.handoff.images[0].ref,'reference1');assert.match(plan.handoff.text,/修正 第 1 张图，光线参考 第 2 张图/);
 assert.equal(draftView(plan).destination.label,'当前对话');assert.equal(plan.changes[0].before,'old text');
 assert.equal(validateDraft(draft,{...base,chat:{...base.chat,key:'changed'}},{off:new Set()}).handoff,undefined);
 assert.equal(validateDraft(draft,base,{off:new Set(['0:image:0'])}).handoff,undefined);
 assert.equal(validateDraft(draft,{...base,chatModel:{...base.chatModel,maxImages:1}},{off:new Set()}).handoff,undefined);
 assert.throws(()=>parseDraft({base_hash:stateHash(base),draft_title:'x',steps:[step]},{...base,workspace:'image'},library),/新开会话/);
 assert.throws(()=>parseDraft({base_hash:stateHash(base),draft_title:'x',steps:[step]},{...base,chat:{...base.chat,annotated:true}},library),/批注/);
});
