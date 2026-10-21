import test from 'node:test';
import assert from 'node:assert/strict';
import { newConversation, beginTurn, completeVersion, contextSnapshot, chatDraftKey } from '../src/domain/conversation.ts';
import { chatSnapshot, chatContext } from '../src/ask/chat-context.ts';
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
test('ASK CHAT branch: source locked, optional text/exclusions, stale context blocks every write and new source stays unsent',()=>{
 const s=fixture(),base={form:{...DEFAULTS},composer:s.current.prompt,conversationId:s.current.id,models:[],samplers:[],chat:chatSnapshot(s)};
 const d=parseDraft({title:'提纯分支',base_hash:stateHash(base),steps:[{kind:'chat_distill_branch',source:'#c1.1',exclude:['#c2.1','#c3.1'],text:'distilled'}]},base,'整理描述',[]);
 const p=validateDraft(d,base,{off:new Set()});assert.ok(p.steps[0].locked);assert.equal(p.branch.after.headId,s.current.turns[0].id);assert.equal(p.branch.after.mainId,'image1');assert.equal(p.branch.after.prompt,'distilled');
 const off=validateDraft(d,base,{off:new Set(['0:exclude','0:text'])});assert.deepEqual(off.branch.after.skipTurnIds,[]);assert.equal(off.branch.after.prompt,'next input');
 s.current.keepIds.push('manual');const stale=validateDraft(d,{...base,chat:chatSnapshot(s)},{off:new Set()});assert.equal(stale.branch,undefined);assert.ok(stale.steps.every(s=>s.issue));
 assert.throws(()=>parseDraft({title:'x',base_hash:stateHash(base),steps:[{kind:'chat_distill_branch',source:'#c9.1',exclude:[],text:'x'}]},base,'',[]),/起点/);
});
test('ASK CHAT conflict fingerprint covers versions, generation and context, preserves cosmetic title edits',()=>{
 const s=fixture(),key=chatDraftKey(s.current);s.current.title='rename';assert.equal(chatDraftKey(s.current),key);
 s.current.turns[0].selectedVersion=1;assert.notEqual(chatDraftKey(s.current),key);
});
