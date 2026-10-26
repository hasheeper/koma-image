import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/domain/drawing.ts';
import { createIds } from '../src/ask/ids.ts';
import { snapshotPictures } from '../src/ask/library.ts';
import { parseDraft, stateHash, validateDraft } from '../src/ask/draft/validate.ts';
import { receiveDraft, DRAFT_SCHEMA, inboxDigest } from '../src/bridge/protocol.ts';
import { liveState, previewPictures } from '../src/bridge/state.ts';
import { safePath, readInbox, fileDriver } from '../src/bridge/fs-driver.ts';
import { protocolDocument } from '../src/bridge/protocol-doc.ts';
const full = 'nai-diffusion-5-full', old = 'nai-diffusion-4-5-full', medium = full+'-medium';
const model = id => ({id, upstreamId:id, profileId:'novelai-v1', maxPixels:2200000, replaces:[], transparentBackground:id===full});
const base = () => ({workspace:'image',boardId:'board-a',boardName:'画板 A',boardPresent:true,form:{...structuredClone(DEFAULTS), model:full,prompt:'blue sky'},composer:'',conversationId:'c1',models:[full,old,medium].map(model),samplers:['k_euler_ancestral','k_euler']});
const snapshot = () => ({base:base(),pictureScope:'scope-a',library:[]});
const envelope = (steps, extra={}) => ({schema:DRAFT_SCHEMA,draft_id:'test-1',draft_title:'参数建议',steps,...extra});
const params = p => ({kind:'params_patch',params:p});
const patch = (text=', moon') => ({kind:'prompt_patch',target:'image.prompt',mode:'append',text});
const plan = (d, now=d.base, off=[]) => validateDraft(d, now, {off:new Set(off)});

test('B1 direct parameters share internal/external parsing, diff, seed zero and frozen baseline', () => {
  const snap=snapshot(), steps=[params({width:1216,height:832,scale:6,cfgRescale:.2,seed:'0',complexity:'high'}),patch()];
  const external=receiveDraft(envelope(steps),snap), internal=parseDraft({base_hash:stateHash(snap.base),draft_title:'参数建议',steps},snap.base,[]);
  assert.deepEqual(external,internal);
  assert.equal(plan(external).changes.find(c=>c.field==='seed').after,'0');
  assert.equal(plan(external).steps.filter(s=>s.kind==='parameter').length,6);
  snap.base.form.width=640;
  assert.equal(external.base.form.width,832);
  assert.deepEqual(plan(external,snap.base).changes,[],'direct parameter conflict does not partially apply text');
});
test('B1 direct proposals reject arbitrary fields, wrong types/ranges and unimplemented steps', () => {
  for(const p of [{},{url:'secret'},{serverCache:true},{seed:0},{seed:'4294967296'},{seed:'-1'},{width:800},{steps:51},{scale:-1},{cfgRescale:2},{complexity:'random'},{batchCount:1.5}])
    assert.throws(()=>receiveDraft(envelope([params(p)]),snapshot()),JSON.stringify(p));
  for(const bad of [{kind:'slate_edit',op:'add'},{kind:'prompt_patch',target:'image.params',mode:'rewrite',text:'x'},{kind:'prompt_patch',target:'chat.composer',mode:'rewrite',text:'x'}])
    assert.throws(()=>receiveDraft(envelope([bad]),snapshot()));
  assert.throws(()=>receiveDraft(envelope([patch()],{ops:[]}),snapshot()),/ops/);
  assert.throws(()=>receiveDraft(envelope([{...params({scale:6}),values:{url:'x'}}]),snapshot()),/步骤结构/);
});
test('B1 capability and coupled model/size validation obey final selected steps', () => {
  for(const p of [{model:old,complexity:'high'},{model:old,qualityPreset:'light'},{model:old,transparentBg:true},{model:medium,steps:20},{model:medium,cfgRescale:.1},{width:2048,height:2048},{sampler:'missing'},{model:'missing'},{cfg:10}])
    assert.throws(()=>receiveDraft(envelope([params(p)]),snapshot()),JSON.stringify(p));
  const snap=snapshot();
  const d=receiveDraft(envelope([params({model:medium,steps:14,cfgRescale:0})]),snap);
  assert.equal(plan(d).changes.find(c=>c.field==='model').after,medium);
  assert.deepEqual(plan(d,snap.base,['0:steps']).changes,[],'disabled required medium step blocks incompatible model');
  assert.equal(receiveDraft(envelope([params({seed:''})]),snap).steps[0].params.seed,'');
});
test('B1 omitted hash anchors live state; explicit stale hash and mismatched picture scope reject', () => {
  const snap=snapshot();
  assert.equal(receiveDraft(envelope([patch()]),snap).baseHash,stateHash(snap.base));
  for(const base_hash of ['',null,'old']) assert.throws(()=>receiveDraft(envelope([patch()],{base_hash}),snap));
  assert.throws(()=>receiveDraft(envelope([{kind:'restore_partial',source:'#h1',fields:['seed']}]),snap),/作用域/);
  assert.throws(()=>receiveDraft(envelope([patch()],{picture_scope_id:'other'}),snap),/作用域/);
});
test('B1 state exports exact snapshot names, lightweight aliases and only four deduplicated previews', () => {
  const records=Array.from({length:6},(_,i)=>({id:`i${i}`,createdAt:i,blob:new Blob(['synthetic']),size:{width:832,height:1216},params:{...structuredClone(DEFAULTS),seed:i,basePrompt:'a'.repeat(200),baseNegative:'raw negative',negative_prompt:'sent negative',localCharacters:[],apiKey:'must-not-export',url:'https://secret.example',image:'binary'}}));
  const snap=snapshot();snap.library=snapshotPictures(records,[records[0]],createIds());
  const state=liveState(snap,{boards:[{id:'board-a',name:'A',color:'blue',nextCharacterId:1,form:snap.base.form}],workspace:'tags',selectedId:'i5',scope:'page',revision:1,receipt:null});
  assert.equal(state.active_workspace,'tags');assert.equal(state.history_index.length,6);assert.equal(state.favorites_index.length,1);
  assert.equal(state.history_index[0].seed,0);assert.equal(state.history_index[0].prompt_excerpt.length,160);
  assert.deepEqual(Object.keys(state.history_index[0]).sort(),['label','width','height','seed','prompt_excerpt'].sort());
  assert.equal(previewPictures(snap.library,'i5').pictures.length,4);
  assert.equal(previewPictures(snap.library,'i0').pictures.length,3);
  assert.equal(state.selected_image.preview,null);
  assert.equal(state.selected_image.params.baseNegative,'raw negative');assert.equal(state.selected_image.params.negative_prompt,'sent negative');
  assert.ok('cfgRescale' in state.form);assert.ok('naiReferences' in state.form);
  assert.doesNotMatch(JSON.stringify(state),/must-not-export|secret.example|binary/);
  const restored=receiveDraft(envelope([{kind:'restore_partial',source:snap.library[0].label,fields:['seed']}],{picture_scope_id:snap.pictureScope}),snap);
  assert.equal(restored.steps[0].values.seed,0);
  assert.equal(plan(restored).changes.find(c=>c.field==='seed').after,'0');
});
test('B1 file paths are bounded; interrupted writable aborts instead of closing', async () => {
  for(const path of ['../a','/a','x/../../a','x\\a','x//a','x/./a','C:/a','x\0']) assert.throws(()=>safePath(path));
  let closed=0,aborted=0;const signal=new AbortController();
  const driver=fileDriver({getFileHandle:async()=>({createWritable:async()=>({write:async()=>signal.abort(),close:async()=>closed++,abort:async()=>aborted++})})});
  await assert.rejects(()=>driver.write('state.live.json','{}',signal.signal));
  assert.equal(closed,0);assert.equal(aborted,1);
});
test('B1 half-written JSON receives one re-read; persistent malformed input is not accepted', async () => {
  let reads=0;const first={text:'{"draft_id":',version:'1'};
  const value=await readInbox({read:async()=>++reads===1?first:{text:'{"draft_id":"ok"}',version:'2'}},new AbortController().signal);
  assert.equal(reads,2);assert.equal(value.value.draft_id,'ok');
  reads=0;await assert.rejects(()=>readInbox({read:async()=>{reads++;return first}},new AbortController().signal));assert.equal(reads,2);
});
test('B1 canonical dedup digest and generated protocol share the actual schema', async () => {
  assert.equal(await inboxDigest({a:1,b:2}),await inboxDigest({b:2,a:1}));
  assert.notEqual(await inboxDigest({a:1}),await inboxDigest({a:2}));
  const schema=JSON.parse([...protocolDocument().matchAll(/```json\n([\s\S]*?)\n```/g)].at(-1)[1]);
  assert.ok(schema.properties.steps.items.anyOf.some(s=>s.properties.kind.enum.includes('params_patch')));
});
