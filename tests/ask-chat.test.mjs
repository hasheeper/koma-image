import test from 'node:test';
import assert from 'node:assert/strict';
import { newConversation, beginTurn, beginVersion, completeVersion, contextSnapshot, chatDraftKey } from '../src/domain/conversation.ts';
import { chatSnapshot, chatContext, chatDraftModel, chatModelState, chatPictures } from '../src/ask/chat-context.ts';
import { draftView } from '../src/ask/draft/view.ts';
import { summarizePlan } from '../src/ask/compact/ledger.ts';
import { idPattern } from '../src/ask/ids.ts';
import { searchHistory } from '../src/ask/search-history.ts';
import { DEFAULTS } from '../src/domain/drawing.ts';
import { parseDraft, stateHash, validateDraft } from '../src/ask/draft/validate.ts';
import { createTools } from '../src/ask/tools.ts';
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
test('ASK CHAT model: whitelisted size and quality options, display names only, unready catalog says so',()=>{
 const s=fixture(),gemini={id:'gemini-3-pro-image',upstreamId:'private-upstream',connection:'private-connection',name:'Gemini Image',maxImages:14,fields:{
  aspect_ratio:{options:['1:1','16:9','9:16'],default:'1:1'},image_size:{options:['1K','2K','4K'],default:'1K'},output_format:{options:['png','jpeg'],default:'png'},seed:{options:['secret-field'],default:'secret-field'}}};
 s.current.settings={model:gemini.id,options:{aspect_ratio:'16:9',image_size:'8K',secret:'not outbound'}};
 const state={...s,ready:true,model:gemini,models:[gemini,{...gemini,id:'other',name:'Gemini Image'},{...gemini,id:'gpt',name:'GPT Image',fields:{}}]};
 const model=chatModelState(state);
 assert.deepEqual(model,{ready:true,name:'Gemini Image',max_images:14,read_only:{},writable:{aspect_ratio:{value:'16:9',options:['1:1','16:9','9:16']},image_size:{value:'1K',options:['1K','2K','4K']}}});
 const openai={...gemini,name:'GPT Image',maxImages:16,fields:{size:{options:['auto','1024x1024','1536x1024','1024x1536'],default:'auto'},quality:{options:['auto','low','medium','high'],default:'auto'}}};
 s.current.settings={model:'gpt',options:{size:'1536x1024',quality:'high'}};
 assert.deepEqual(chatModelState({...state,model:openai}),{ready:true,name:'GPT Image',max_images:16,writable:{size:{value:'1536x1024',options:['auto','1024x1024','1536x1024','1024x1536']}},read_only:{quality:{value:'high',options:['auto','low','medium','high']}}});
 const ctx=chatContext(state),text=JSON.stringify(ctx);
 assert.deepEqual(ctx.available_models,['Gemini Image','GPT Image']);
 for(const secret of ['private-upstream','private-connection','gemini-3-pro-image','not outbound','secret-field','png'])assert.doesNotMatch(text,new RegExp(secret));
 assert.deepEqual(chatModelState({...state,ready:false}),{ready:false});assert.deepEqual(chatContext({...state,ready:false}).available_models,[]);
});
test('ASK CHAT branch: source locked, optional text/exclusions, stale context blocks every write and new source stays unsent',()=>{
 const s=fixture(),base={form:{...DEFAULTS},composer:s.current.prompt,conversationId:s.current.id,models:[],samplers:[],chat:chatSnapshot(s)};
 const d=parseDraft({title:'提纯分支',base_hash:stateHash(base),steps:[{kind:'chat_distill_branch',source:'#c1.1',exclude:['#c2.1','#c3.1'],text:'distilled'}]},base,[]);
 const p=validateDraft(d,base,{off:new Set()});assert.ok(p.steps[0].locked);assert.equal(p.branch.after.headId,s.current.turns[0].id);assert.equal(p.branch.after.mainId,'image1');assert.equal(p.branch.after.prompt,'distilled');
 const off=validateDraft(d,base,{off:new Set(['0:exclude','0:text'])});assert.deepEqual(off.branch.after.skipTurnIds,[]);assert.equal(off.branch.after.prompt,'next input');
 s.current.keepIds.push('manual');const stale=validateDraft(d,{...base,chat:chatSnapshot(s)},{off:new Set()});assert.equal(stale.branch,undefined);assert.ok(stale.steps.every(s=>s.issue));
 assert.throws(()=>parseDraft({title:'x',base_hash:stateHash(base),steps:[{kind:'chat_distill_branch',source:'#c9.1',exclude:[],text:'x'}]},base,[]),/起点/);
});
test('ASK CHAT ids: every version and image is addressable, #cN.M aliases the first image, branch source stays in the selected version',()=>{
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
 assert.throws(()=>branch('#c2.1'),/选中的版本/);assert.throws(()=>branch('#c2.3'),/起点/);
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
 assert.deepEqual(p.handoff,{model:'gpt',options:{size:'1536x1024'},text:'close-up',images:d.steps[0].images});
 assert.deepEqual(p.changes,[{field:'composer',before:'',after:'close-up'}]);assert.equal(p.workspace,'chat');
 assert.deepEqual(p.steps.map(s=>s.id),['0:new','0:image:0','0:image:1','0:option:size','0:text']);
 assert.ok(p.steps[0].locked);assert.equal(p.steps[3].displayBefore,'自动');assert.equal(p.steps[3].displayAfter,'横向');
 assert.deepEqual(draftView(p).fields.map(f=>f.key),['handoff','composer']);assert.match(summarizePlan(p).delta,/handoff/);
 // The header names the new conversation; images are reference rows and the input is shown verbatim.
 const view=draftView(validateDraft(draft({images:['#h1','#c2.1'],options:{size:'1536x1024'},text:'参考 #h1，改成横版\n保留红色外套'}),base,{off:new Set()}));
 assert.deepEqual(view.destination,{label:'新对话',name:'GPT Image'});
 assert.deepEqual(view.fields[0].steps.map(s=>[s.kind,s.kind==='ref'?s.label:s.kind==='param'?s.icon:'']),[['ref','#h1'],['ref','#c2.1'],['param','i-frame']]);
 assert.equal(view.fields[1].full,null);assert.deepEqual(view.fields[1].steps[0].hunks,[[{sign:'ins',text:'参考 #h1，改成横版\n保留红色外套'}]]);
 assert.deepEqual([view.added,view.removed],[4,1]);
 assert.throws(()=>draft({options:{quality:'high'}}),/quality 不能由草稿写入；需要时在回复中提醒用户手动调整/);
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
 assert.equal(removed.steps[1].issue,'图片已移除');assert.deepEqual(removed.handoff.images.map(i=>i.label),['#c2.1']);assert.notEqual(removed.fingerprint,p.fingerprint);
 const switched=validateDraft(d,{...base,chatModel:{...base.chatModel,id:'other'}},{off:new Set()});
 assert.ok(switched.steps.every(s=>s.issue==='对话模型已变化，请重新提议'));assert.equal(switched.handoff,undefined);assert.deepEqual(switched.changes,[]);
 assert.equal(validateDraft(d,{...base,chatModel:null},{off:new Set()}).handoff,undefined);
 const narrowed=validateDraft(d,{...base,chatModel:{...base.chatModel,writable:{size:{value:'auto',options:['auto']}}}},{off:new Set()});
 assert.equal(narrowed.steps[3].issue,'当前模型不支持此值');assert.deepEqual(narrowed.handoff.options,{});
 const off=validateDraft(d,base,{off:new Set(['0:text','0:image:0'])});
 assert.equal(off.handoff.text,'');assert.deepEqual(off.changes,[]);assert.deepEqual(off.handoff.images.map(i=>i.label),['#c2.1']);
 assert.equal(validateDraft(d,base,{off:new Set(['0:text','0:image:0','0:image:1'])}).handoff,undefined);
});
test('ASK CHAT conflict fingerprint covers versions, generation and context, preserves cosmetic title edits',()=>{
 const s=fixture(),key=chatDraftKey(s.current);s.current.title='rename';assert.equal(chatDraftKey(s.current),key);
 s.current.turns[0].selectedVersion=1;assert.notEqual(chatDraftKey(s.current),key);
});
