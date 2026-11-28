import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyReferences, readReferences, referencePlan, referenceStrengths, referenceSurcharge, referenceWire, vibeModel, referenceKinds, referenceProblem, referenceSummary } from '../src/domain/nai-references.ts';
import { collect, DEFAULTS, drawingPayload, readBoards, reuseFields } from '../src/domain/drawing.ts';
import { toNativePayload, toStandardPayload } from '../src/gateway/routes.ts';
import { supportsSourcePayload, insufficientFunds } from '../src/domain/source-funding.ts';
import { novelaiProfile } from '../src/gateway/profile.ts';
import { normalizeQuota } from '../src/domain/quota.ts';
import { base64Blob, readEncoding } from '../src/native/reference-images.ts';
const r = (id, strength=0.6) => ({id,assetId:'a'.repeat(64),on:true,strength,information:.7,fidelity:.85,type:'character&style'});
const model = {id:'nai-diffusion-4-5-full',name:'NAI V4.5 Full',upstreamId:'nai-diffusion-4-5-full',profileId:'nai-official-v1',operations:['generate'],maxPixels:4194304,maxImages:1,fields:{}};
test('NAI references: per-board JSON snapshots, excluded rows, mutual group and explicit 16-image cap',()=>{
  const refs={...emptyReferences(),active:'vibe',vibe:[r('1'),{...r('2'),on:false}],precise:[r('p')]};
  const params=collect({...DEFAULTS,naiReferences:refs},model,2), payload=drawingPayload(params);
  refs.vibe[0].strength=.1;
  assert.equal(payload.referencePlan.items[0].strength,.6);
  assert.equal(payload.referencePlan.items.length,1);
  assert.equal(params.naiReferences.precise.length,1);
  const restored=readBoards({boards:{activeId:'a',items:[{id:'a',form:{...DEFAULTS,naiReferences:refs}}]}});
  assert.deepEqual(restored.items[0].form.naiReferences,refs);
  assert.deepEqual(reuseFields({params}).naiReferences,params.naiReferences);
  for(const kind of ['vibe','precise'])assert.throws(()=>referencePlan({...emptyReferences(),active:kind,[kind]:Array.from({length:17},(_,i)=>r(String(i)))}),/16/);
  assert.equal(referencePlan({...refs,active:null}),undefined);
  assert.deepEqual(readReferences({vibe:[r('1'),r('1'),{...r('bad'),assetId:'invalid'}]}).vibe,[r('1')]);
  assert.equal(vibeModel('nai-diffusion-5-full'),false);
});
test('NAI wire: normalization only above 1, encoded Vibe omits extraction array; Precise inverts Fidelity',()=>{
  const plan={kind:'vibe',normalize:true,items:[r('1',.3),r('2',.2)]};
  assert.deepEqual(referenceStrengths(plan),[.3,.2]);
  plan.items=[r('1',.8),r('2',.8)];assert.deepEqual(referenceStrengths(plan),[.5,.5]);
  assert.equal(referenceSurcharge({...plan,items:Array.from({length:6},(_,i)=>r(String(i)))}),4);
  const prepared={kind:'vibe',images:['YWJj'],strengths:[.6],information:[.7],fidelities:[.85],types:['character&style']};
  assert.deepEqual(referenceWire(prepared,model.id),{reference_image_multiple:['YWJj'],reference_strength_multiple:[.6]});
  const payload={model:model.id,prompt:'synthetic',preparedReferences:prepared};
  const wire=toNativePayload(payload,()=>0,true).parameters;
  assert.deepEqual(wire.reference_image_multiple,['YWJj']);
  assert.equal('reference_information_extracted_multiple' in wire,false);
  const precise=referenceWire({...prepared,kind:'precise'},model.id);
  assert.deepEqual(precise.director_reference_descriptions,[{caption:{base_caption:'character&style',char_captions:[]},legacy_uc:false}]);
  assert.ok(Math.abs(precise.director_reference_secondary_strength_values[0]-.15)<1e-12);
  assert.throws(()=>toStandardPayload(payload),/参考生成协议/);
  assert.throws(()=>toNativePayload({...payload,model:'nai-diffusion-5-full'},()=>0,true),/不支持参考/);
  assert.throws(()=>toNativePayload({model:model.id,referencePlan:plan},()=>0,true),/尚未准备/);
});
test('reference routing: keep complete payload, only declared official V4.5 source and known surcharge floor',()=>{
  const plan={kind:'precise',normalize:false,items:[r('1'),r('2')]}, payload={model:model.id,width:832,height:1216,referencePlan:plan};
  assert.equal(supportsSourcePayload(model,payload),true);
  assert.equal(supportsSourcePayload({...model,profileId:'koma-standard-v1'},payload),false);
  assert.equal(supportsSourcePayload({...model,id:'nai-diffusion-5-full'},payload),false);
  const quota=n=>normalizeQuota(novelaiProfile,{credits:{remaining:n},subscription:{active:true,tier:3}},null);
  assert.match(insufficientFunds(model,quota(9),null,payload),/Anlas/);
  assert.equal(insufficientFunds(model,quota(10),null,payload),null);
  assert.equal(insufficientFunds(model,quota(null),null,payload),null);
  assert.match(insufficientFunds(model,quota(11),null,{...payload,referenceMinimum:12}),/Anlas/);
});
test('Vibe binary response: bounded bytes, empty/error bodies and cancellation cannot masquerade as cache',async()=>{
  assert.equal(await readEncoding(new Response(new Uint8Array([0,1,254,255])),new AbortController().signal),'AAH+/w==');
  await assert.rejects(readEncoding(new Response(new Uint8Array()),new AbortController().signal),/为空/);
  assert.throws(()=>base64Blob('bad'),/编码无效/);
  assert.throws(()=>base64Blob('YWJj','application/octet-stream',2),/过大/);
  const abort=new AbortController();abort.abort();
  await assert.rejects(readEncoding(new Response(new Uint8Array([1])),abort.signal),e=>e.name==='AbortError');
});

test('reference wire rejects mismatched Precise arrays and imported backups require complete asset closure',async()=>{
  assert.throws(()=>referenceWire({kind:'precise',images:['YWJj'],strengths:[1],information:[],fidelities:[1],types:['style']},model.id),/不完整/);
  const {validateBackupManifest}=await import('../src/storage/backup-schema.ts');
  const {backupFormat}=await import('../src/storage/backup-schema.ts');
  const ref=r('1'),value={...backupFormat,id:'11111111-1111-4111-8111-111111111111',createdAt:new Date(0).toISOString(),favorites:[],assets:[],conversations:[],preferences:{drawing:JSON.stringify({naiReferences:{...emptyReferences(),vibe:[ref]}})},referenceAssets:[],vibeEncodings:[]};
  assert.throws(()=>validateBackupManifest(value),/缺少参考图片/);
  value.referenceAssets=[{id:ref.assetId,width:512,height:512,image:{path:'references/images/0.png',type:'image/png'},thumbnail:null}];
  assert.equal(validateBackupManifest(value).referenceAssets.length,1);
  value.referenceAssets[0].image=null;
  assert.throws(()=>validateBackupManifest(value),/不完整/);
});

test('V5 reference capabilities match the official model, operation and image source', () => {
  for (const id of ['nai-diffusion-5-full', 'nai-diffusion-5-full-medium', 'nai-diffusion-5-curated@local']) {
    assert.deepEqual(referenceKinds(id), ['precise']);
    assert.deepEqual(referenceKinds(id, 'img2img'), ['precise']);
    for (const tool of ['inpaint','upscale','director']) assert.deepEqual(referenceKinds(id, tool), []);
    const source = {...model, id, upstreamId:id.replace(/@local$/, '')};
    const payload = {model:id, referencePlan:{kind:'precise', items:[r('ref', 5)]}};
    assert.ok(supportsSourcePayload(source,payload));
    assert.equal(supportsSourcePayload({...source,upstreamId:model.id},payload),false);
    assert.equal(supportsSourcePayload({...source,profileId:'koma-standard-v1'},payload),false);
  }
  assert.deepEqual(referenceKinds('nai-diffusion-5-curated-medium'), []);
  assert.deepEqual(referenceKinds(model.id, 'inpaint'), ['precise']);
});

test('V5 recipe fields round-trip through boards and Slate, keeping dormant settings and missing legacy fields', async () => {
  const {recipeForm} = await import('../src/slate/edit.ts');
  const rows = [r('old'), {...r('off',3.5),type:'costume',on:false}, {...r('on'),preferSameOutfit:false}];
  const refs = {...emptyReferences(),active:'precise',precise:rows};
  for (const value of [readReferences(refs),recipeForm({naiReferences:refs}).naiReferences]) assert.deepEqual(value, refs);
  assert.equal(referenceProblem(refs,model.id,referenceKinds(model.id)), '');
  rows[1].on = true;
  assert.match(referenceProblem(refs,model.id,referenceKinds(model.id)), /第 2 张/);
  assert.deepEqual(referencePlan(refs).items,rows);
  assert.equal(referenceSummary(refs).precise[2].preferSameOutfit, false);
  assert.equal(JSON.stringify(referenceSummary(refs)).includes(rows[0].assetId), false);
});

test('V5 descriptions, strength and secondary arrays pair all six combinations with enabled images in order', () => {
  const id='nai-diffusion-5-full';
  const types=['character','character','style','costume','character&style','character&style'];
  const prepared={kind:'precise',images:types.map((_,i)=>String(i)),types,strengths:[0,.05,1,5,2,3.5],
    information:types.map(()=>1),fidelities:types.map(()=>.85),preferSameOutfits:[false,true,false,true,false,true]};
  const wire=referenceWire(prepared,id);
  assert.deepEqual(wire.director_reference_descriptions.map(d=>d.caption.base_caption),
    ['character','character_mainoutfit','style','costume','character&style_anyoutfit','character&style']);
  for (const d of wire.director_reference_descriptions) assert.deepEqual({...d,caption:{...d.caption,base_caption:''}},{caption:{base_caption:'',char_captions:[]},legacy_uc:false});
  assert.deepEqual(wire.director_reference_secondary_strength_values,Array(6).fill(0));
  assert.deepEqual(wire.director_reference_strength_values,prepared.strengths);
  assert.throws(()=>referenceWire({...prepared,preferSameOutfits:[]},id),/不完整/);
  assert.throws(()=>referenceWire({...prepared,strengths:[NaN,...prepared.strengths.slice(1)]},id),/强度/);
  assert.throws(()=>referenceWire(prepared,model.id),/强度/);
  assert.throws(()=>referenceWire({...prepared,kind:'vibe'},id),/不支持/);
  const rows = Array.from({length:17},(_,i)=>({...r(String(i),i===1?3.5:1),on:i!==1}));
  const plan=referencePlan({...emptyReferences(),active:'precise',precise:rows});
  assert.equal(referenceSurcharge(plan),80);
  assert.deepEqual(plan.items.map(r=>r.id),rows.filter(r=>r.on).map(r=>r.id));
  rows[1].on=true;
  assert.throws(()=>referencePlan({...emptyReferences(),active:'precise',precise:rows}),/16/);
});

test('V5 JSON uses an HMAC of base64 text and includes all signed data on each submission', async t => {
  const {novelaiRequest}=await import('../src/gateway/novelai-edit.ts');
  const {createHmac}=await import('node:crypto');
  const bytes=new Uint8Array(32).fill(123);
  const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  t.mock.method(crypto.subtle,'generateKey',async()=>key);
  const prepared={kind:'precise',images:['YQ==','YmM='],types:['character','character&style'],strengths:[5,3.5],information:[1,.5],fidelities:[.4,.1]};
  for(let i=0;i<2;i++){
    const {path,body:{parameters:p}}=await novelaiRequest({model:'nai-diffusion-5-full-medium',preparedReferences:prepared});
    assert.equal(path,'/ai/generate-image'); assert.equal(p.steps,14);
    assert.deepEqual(p.director_reference_images_cached,prepared.images.map(data=>({data,cache_secret_key:createHmac('sha256',bytes).update(data,'utf8').digest('hex')})));
    assert.equal('director_reference_images' in p,false); assert.equal('image_cache_secret_key' in p,false);
    assert.deepEqual(p.director_reference_descriptions.map(d=>d.caption.base_caption),prepared.types);
  }
});
