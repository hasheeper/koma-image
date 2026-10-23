import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, boardForm, collect, drawingPayload, readBoards } from '../src/domain/drawing.ts';
import { activeCharacters, charactersFromNai, gridLabel, sameValue } from '../src/domain/characters.ts';
import { toNativePayload, toStandardPayload } from '../src/gateway/routes.ts';
import { buildDigest } from '../src/ask/digest/index.ts';
import { createIds } from '../src/ask/ids.ts';
import { parseDraft, stateHash, validateDraft } from '../src/ask/draft/validate.ts';
import { draftView } from '../src/ask/draft/view.ts';
import { createDraftWriter } from '../src/ask/draft/apply.ts';
import { createDraftStack } from '../src/ask/draft/stack.ts';
import { newConversation } from '../src/domain/conversation.ts';
import { metadata, differences, snapshotPictures } from '../src/ask/library.ts';
import { searchHistory } from '../src/ask/search-history.ts';
import { historyIndex } from '../src/ask/digest/history.ts';
import { readBackupPreferences } from '../src/storage/backup-schema.ts';

const role = (id, prompt, extra = {}) => ({ id, on: true, prompt, negative: '', centers: [{x:.24,y:.76}], ...extra });
const model = id => ({id,upstreamId:id,name:id,replaces:[],maxPixels:2200000,transparentBackground:false});
const state = (over = {}) => ({boardId:'a',boardPresent:true,nextCharacterId:8,form:{...DEFAULTS,characters:[role('c1','girl, red hair'),role('c4','boy, blue eyes')],prompt:'2people, outdoors'},composer:'',conversationId:'chat',models:[model('nai-diffusion-5-full'),model('nai-diffusion-4-5-full')],samplers:['k_euler_ancestral'],...over});
const propose = (s, steps, library=[]) => parseDraft({draft_title:'角色调整',base_hash:stateHash(s),steps},s,library);
const check = (d,s=d.base,off=[]) => validateDraft(d,s,{off:new Set(off)});
const patch = (id,field,anchor,text) => ({kind:'prompt_patch',target:`image.char.${id}.${field}`,mode:'replace',anchor,text});
const edit = (op, fields={}) => ({kind:'character_edit',op,...fields});
const image = (id, at, chars, boardId='a') => ({id,createdAt:at,params:{prompt:'shared scene',model:'nai-diffusion-5-full',characters:chars,placement:'manual',boardId},size:{width:832,height:1216},blob:new Blob(['synthetic'])});

test('boards and native roles: independent clones, disabled omission, grid projection and paired empty negatives',()=>{
  const original={...DEFAULTS,characters:[role('c1','girl, red hair'),role('c4','boy, blue eyes',{negative:'red hair'}),role('c7','other',{on:false})],placement:'manual',seed:'0'};
  const boards=readBoards(original); assert.equal(boards.activeId,'board-1');assert.equal(boards.items[0].nextCharacterId,8);
  boards.items[0].form.characters[0].prompt='changed';assert.equal(original.characters[0].prompt,'girl, red hair');
  const form=structuredClone(original);form.model='nai-diffusion-4-5-full';
  const params=collect(form,model(form.model),1), sent=drawingPayload(params), wire=toNativePayload(sent);
  assert.equal(wire.parameters.v4_prompt.use_coords,true);
  assert.deepEqual(wire.parameters.v4_prompt.caption.char_captions.map(c=>c.char_caption),['girl, red hair','boy, blue eyes']);
  assert.deepEqual(wire.parameters.v4_negative_prompt.caption.char_captions.map(c=>c.char_caption),['','red hair']);
  assert.deepEqual(wire.parameters.v4_prompt.caption.char_captions[0].centers,[{x:.3,y:.7}]);
  assert.equal(gridLabel(wire.parameters.v4_prompt.caption.char_captions[0].centers[0]),'B4');
  assert.deepEqual(form.characters[0].centers,[{x:.24,y:.76}]);assert.equal(params.localCharacters.length,3);
  form.characters[0].prompt='later';assert.equal(params.characters[0].prompt,'girl, red hair');
  assert.deepEqual(charactersFromNai(wire.parameters).characters.map(c=>c.negative),['','red hair']);
  assert.equal(toNativePayload({...sent,placement:'auto'}).parameters.v4_prompt.use_coords,false);
  assert.deepEqual(activeCharacters(original.characters,'gpt-image-1.5'),[]);
  assert.throws(()=>activeCharacters(Array.from({length:7},(_,i)=>role(`c${i+1}`,'girl')), 'nai-diffusion-4-5-full'),/最多 6/);
  assert.equal(sameValue({a:[{x:1,y:2}],b:3},{b:3,a:[{y:2,x:1}]}),true);
});

test('state: active board is complete, other boards/history are directories; hash covers all generation inputs',()=>{
  const s=state(), ids=createIds(), h=image('history',1,[role('c2','history_secret')]);
  const input={workspace:'image',anchor:null,form:s.form,boardId:s.boardId,boards:[{id:'a',name:'A',form:s.form},{id:'b',name:'B',form:{...s.form,prompt:'inactive_secret'}}],modelName:null,history:[h],favorites:[],current:h,generation:{state:'done',busy:false},composer:'',chat:null,ids};
  const result=buildDigest(input), value=JSON.parse(result.json);
  assert.equal(result.baseHash,stateHash(s));assert.equal(value.image.form.prompt,s.form.prompt);
  assert.deepEqual(value.image.form.characters.map(c=>[c.id,c.on,c.prompt,c.negative,c.position]),[['c1',true,'girl, red hair','','auto'],['c4',true,'boy, blue eyes','','auto']]);
  assert.doesNotMatch(result.json,/inactive_secret|history_secret/);
  for(const change of [{seed:'17'},{placement:'manual'},{scale:7},{characters:[role('c1','changed')]}]) assert.notEqual(stateHash({...s,form:{...s.form,...change}}),result.baseHash);
  assert.notEqual(stateHash({...s,boardId:'b'}),result.baseHash);
  assert.equal(stateHash({...s,form:{...s.form,tagSuggest:false}}),result.baseHash);
});

test('character drafts: one grouped card, stable ID after reorder, deleted targets and external structure conflicts',()=>{
  const s=state(), d=propose(s,[patch('c4','prompt','blue eyes','green eyes'),edit('set_enabled',{id:'c4',on:false}),edit('set_position',{id:'c4',x:.8,y:.3})]), p=check(d);
  assert.deepEqual(p.changes.map(c=>c.field),['characters']);
  assert.deepEqual(p.changes[0].after.find(c=>c.id==='c4'),role('c4','boy, green eyes',{on:false,centers:[{x:.8,y:.3}]}));
  const v=draftView(p);assert.equal(v.fields.length,1);assert.equal(v.fields[0].key,'character:c4');assert.equal(v.fields[0].steps.length,3);
  const reordered=structuredClone(s);reordered.form.characters.reverse();
  const text=check(propose(s,[patch('c4','prompt','blue eyes','green eyes')]),reordered);
  assert.equal(text.changes[0].after[0].id,'c4');assert.equal(text.changes[0].after[0].prompt,'boy, green eyes');
  assert.match(check(d,reordered).steps[1].issue,/外部修改/);
  const removed=structuredClone(s);removed.form.characters=removed.form.characters.filter(c=>c.id!=='c4');
  assert.match(check(d,removed).steps[0].issue,/不存在/);
  assert.deepEqual(check(d,{...s,boardPresent:false}).changes,[]);
});

test('character drafts: monotonic allocation, coordinates, limit, dependent actions and whole-group restoration',()=>{
  const s=state(), add=propose(s,[edit('add',{prompt:'girl, blonde hair',negative:'blue hair',on:false,x:.8,y:.4})]);
  const p=check(add,{...s,nextCharacterId:12});assert.equal(p.changes[0].after.at(-1).id,'c12');assert.equal(p.changes[0].after.at(-1).on,false);
  assert.throws(()=>propose(s,[edit('set_position',{id:'c1',x:2,y:0})]),/坐标/);
  assert.match(check(propose(s,[edit('set_position',{id:'c1',cell:'B3'})])).steps[0].issue,/不匹配/);
  const v45=structuredClone(s);v45.form.model='nai-diffusion-4-5-full';
  assert.deepEqual(check(propose(v45,[edit('set_position',{id:'c1',cell:'B3'})])).changes[0].after[0].centers,[{x:.3,y:.5}]);
  const imported=structuredClone(s);imported.form.characters[0].centers.push({x:.8,y:.2});
  const positioned=check(propose(imported,[edit('set_position',{id:'c1',x:.7,y:.4}),edit('set_placement',{placement:'manual'})]));
  const positionedForm={...imported.form,...Object.fromEntries(positioned.changes.map(c=>[c.field,c.after]))};
  assert.deepEqual(positionedForm.characters[0].centers,[{x:.7,y:.4}]);
  assert.deepEqual(toStandardPayload(drawingPayload(collect(positionedForm,model(positionedForm.model),1))).characters[0].center,{x:.7,y:.4});
  assert.match(check(propose(s,[edit('reorder',{ids:['c1','c1']})])).steps[0].issue,/不重复/);
  const deleted=check(propose(s,[edit('remove',{id:'c4'}),patch('c4','prompt','blue eyes','green eyes')]));assert.match(deleted.steps[1].issue,/不存在/);
  const restore=propose(s,[{kind:'restore_partial',source:'#h1',fields:['characters']}],[{aliases:['#h1'],params:{characters:[role('c1','girl, imported')],placement:'manual'}}]);
  const restored=check(restore);assert.equal(restored.changes.find(c=>c.field==='characters').after[0].id,'c8');assert.equal(restored.changes.find(c=>c.field==='placement').after,'manual');assert.match(restored.steps[0].after,/girl, imported/);
  const missing=propose(s,[{kind:'restore_partial',source:'#h1',fields:['characters']}],[{aliases:['#h1'],params:{}}]);assert.equal(check(missing).changes.length,0);
  const empty=propose(s,[{kind:'restore_partial',source:'#h1',fields:['characters']}],[{aliases:['#h1'],params:{characters:[],placement:'auto'}}]);assert.deepEqual(check(empty).changes[0].after,[]);
});

test('history: role terms and changes stay board-local, image similarity sees effective character prompts',()=>{
  const a=image('a',1,[role('c1','girl, red hair')]), unrelated=image('b',2,[role('c1','girl, green hair')],'b'), newer=image('c',3,[role('c1','girl, blue hair')]);
  newer.params.localCharacters=[...newer.params.characters,role('c8','unused',{on:false})];
  const library=snapshotPictures([newer,unrelated,a],[],createIds());
  const hits=searchHistory({query:'blue',changed_field:'characters'},library,4);
  assert.equal(hits.matches.length,1);assert.equal(hits.matches[0].matched_field,'characters.c1.prompt');assert.equal(hits.matches[0].compared_to,'#h1');
  const diff=differences(a,newer);assert.equal(diff.characters.alignment,'stable_id');assert.equal(diff.characters.items[0].after.prompt,'girl, blue hair');
  assert.equal(differences(a,unrelated).characters.alignment,'list_order_only_identity_unknown');
  assert.equal(metadata(newer).local_characters.length,2);assert.equal(metadata(newer).characters.length,1);
  assert.equal(historyIndex(library,library[2]).t1.length,0);
});

test('backup: boards preserve generation values and reject duplicate identities or invalid coordinates',()=>{
  const s=state(), value={boards:{activeId:'a',items:[{id:'a',name:'A',color:'#b3a1ff',nextCharacterId:8,form:boardForm(s.form)}]}};
  const saved=JSON.stringify(value);assert.equal(readBackupPreferences({drawing:saved}).drawing,saved);
  for(const mutate of [v=>v.boards.items.push(structuredClone(v.boards.items[0])),v=>v.boards.items[0].form.characters[0].centers[0].x=2,v=>v.boards.items[0].form.prompt=5,v=>v.boards.items[0].nextCharacterId=1]) {
    const invalid=structuredClone(value);mutate(invalid);assert.throws(()=>readBackupPreferences({drawing:JSON.stringify(invalid)}),/备份/);
  }
});

test('board writer and W4: source-bound edits, new-board apply/undo/redo and suffix preflight across boards',async()=>{
  const s=state(), items=[{id:'a',name:'A',color:'#b3a1ff',nextCharacterId:8,form:boardForm(s.form)},{id:'b',name:'B',color:'#7bc4a8',nextCharacterId:8,form:boardForm({...s.form,prompt:'B'})}];let active='b';
  const current=newConversation(), writes=[];
  const drawing={snapshot:()=>({boards:items,form:{...DEFAULTS,...items.find(b=>b.id===active).form}}),writeDraft:async(values,expected,id)=>{const b=items.find(b=>b.id===id);assert.ok(b);assert.ok(Object.entries(expected).every(([k,v])=>sameValue(b.form[k],v)));Object.assign(b.form,structuredClone(values));active=id;writes.push(id);},insertBoardDraft:async b=>{items.push(structuredClone(b));active=b.id;},removeBoardDraft:async(id,_expected,source)=>{items.splice(items.findIndex(b=>b.id===id),1);active=source;}};
  const router={route:{value:{workspace:'image',overlay:null}},switchWorkspace(w){this.route.value.workspace=w;}};
  const writer=createDraftWriter(drawing,{snapshot:()=>({current})},router), stack=createDraftStack(writer);
  const da=propose(s,[patch('c4','prompt','blue eyes','green eyes')]), pa=check(da), ra=stack.create(da,'ask',1);await stack.apply(ra,pa);
  assert.equal(writes[0],'a');assert.equal(items[1].form.prompt,'B');
  const sb={...s,boardId:'b',form:{...DEFAULTS,...structuredClone(items[1].form)}};
  const db=propose(sb,[{kind:'prompt_patch',target:'image.prompt',mode:'rewrite',text:'B2'}]), pb=check(db), rb=stack.create(db,'ask',2);await stack.apply(rb,pb);
  assert.deepEqual(stack.preflight([ra.id,rb.id]),[rb.id,ra.id]);await stack.undo(rb.id);await stack.undo(ra.id);assert.equal(items[0].form.characters[1].prompt,'boy, blue eyes');
  const created={...structuredClone(items[0]),id:'new',form:{...items[0].form,...Object.fromEntries(pa.changes.map(c=>[c.field,c.after]))}};
  const nr=stack.create(da,'ask',3), np={...pa,createdBoard:created};await stack.apply(nr,np);assert.equal(items.length,3);assert.equal(items[0].form.characters[1].prompt,'boy, blue eyes');
  items[2].form.prompt='manual';assert.equal(writer.canUndo(np),false);items[2].form.prompt=created.form.prompt;
  assert.deepEqual(stack.preflight([nr.id]),[nr.id]);await stack.undo(nr.id);assert.equal(items.length,2);await stack.restore(nr.id);assert.equal(items[2].id,'new');
  items.splice(0,1);assert.match(writer.conflict(np,'after'),/来源画板已删除/);
});
