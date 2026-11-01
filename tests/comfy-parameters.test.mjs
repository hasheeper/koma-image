import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, connection, adjustableConfig as adjustable } from './helpers/comfy-fixture.mjs';
import { comfyCatalog } from '../src/gateway/comfyui.ts';
import { injectWorkflow, validateComfyWorkflow, scanWorkflow, comfyParameterSpec } from '../src/domain/comfy-workflow.ts';
import { syncComfyParameters } from '../src/domain/comfy-parameters.ts';
import { DEFAULTS, collect, drawingPayload, batchParams, reuseFields, prepareDrawingFields, readBoards } from '../src/domain/drawing.ts';
import { imageParameters } from '../src/domain/image-parameters.ts';
import { parseParameters } from '../src/ask/draft/parameters.ts';
import { parseDraft, validateDraft, stateHash } from '../src/ask/draft/validate.ts';
import { naiAwareness } from '../src/services/nai-awareness.ts';


const model = comfyCatalog({ ...connection, comfyWorkflow: adjustable }).models[0];
const normal = { ...model, id: DEFAULTS.model, name: 'NAI', profileId: 'nai-official-v1', maxPixels: 4194304, comfyParameters: undefined };
const start = () => syncComfyParameters({ ...structuredClone(DEFAULTS), model: model.id }, model);
function plan(base, steps, library = [], now = base, off = new Set()) {
  return validateDraft(parseDraft({ title: 'Basic parameters', base_hash: stateHash(base), steps }, base, library), now, { off });
}

test('Comfy parameters: finite decimal scan, optional bindings, duplicates and invalid defaults', () => {
  assert.ok(scanWorkflow(adjustable.workflow).numbers.some(b => b.field === 'cfg'));
  assert.deepEqual(validateComfyWorkflow(config), config);
  assert.deepEqual(comfyParameterSpec(adjustable).defaults, { width: 1000, height: 750, steps: 20, cfg: 6.5 });
  for (const [key, binding] of [['width', {nodeId:'3',field:'cfg'}], ['steps',{nodeId:'3',field:'seed'}], ['cfg',{nodeId:'3',field:'positive'}]]) {
    const bad = structuredClone(adjustable); bad.bindings.parameters[key] = binding;
    assert.throws(() => validateComfyWorkflow(bad));
  }
  for (const value of [0, -1, 1.5]) {
    const bad = structuredClone(adjustable); bad.workflow['5'].inputs.width = value;
    assert.throws(() => validateComfyWorkflow(bad));
  }
});

test('Comfy parameters: injection preserves other stages and rejects invalid/unbound overrides', () => {
  const graph = injectWorkflow(adjustable, 'p', '', 0, { width: 3001, steps: 75, cfg: 4.25 });
  assert.deepEqual(graph['5'].inputs, { width: 3001, height: 750, batch_size: 1 });
  assert.equal(graph['3'].inputs.steps, 75); assert.equal(graph['3'].inputs.cfg, 4.25);
  for (const node of ['4', '11']) assert.deepEqual(graph[node], adjustable.workflow[node]);
  for (const values of [{ width: 0 }, { height: 1.5 }, { steps: -1 }, { cfg: Infinity }, { guidance: 5 }, { width: '1024' }]) assert.throws(() => injectWorkflow(adjustable, '', '', 0, values));
  assert.throws(() => injectWorkflow(config, '', '', 0, { width: 1024 }), /固定/);
});

test('Comfy parameter memory: workflow defaults, per-workflow values, ordinary values and persisted boards', () => {
  let f = start(); assert.deepEqual([f.width,f.height,f.steps,f.scale], [1000,750,20,6.5]);
  f = { ...f, width: 1501, steps: 75, scale: 4.25 };
  let ordinary = syncComfyParameters({ ...f, model: normal.id }, normal);
  assert.deepEqual([ordinary.width,ordinary.height,ordinary.steps,ordinary.scale], [832,1216,25,5]);
  ordinary.width = 1024;
  f = syncComfyParameters({ ...ordinary, model: model.id }, model);
  assert.equal(f.width,1501); assert.equal(f.steps,75);
  const other = { ...model, id:'comfyui:other' };
  let second = syncComfyParameters({...f,model:other.id},other); assert.equal(second.width,1000);
  second.width = 888;
  f = syncComfyParameters({...second,model:model.id},model); assert.equal(f.width,1501);
  const restored = readBoards({boards:{activeId:'b',items:[{id:'b',form:f}]}}).items[0].form;
  assert.equal(syncComfyParameters({...DEFAULTS,...restored},model).width,1501);
  assert.equal(syncComfyParameters({...f,model:normal.id},normal).width,1024);
  assert.equal(syncComfyParameters(f,{...model,name:'rename',sourceRevision:'rename'}).width,1501);
  const changed = structuredClone(adjustable); changed.workflow['5'].inputs.width=1200;
  assert.equal(syncComfyParameters(f,{...model,comfyParameters:comfyParameterSpec(changed)}).width,1200);
});

test('Comfy recipes: batch freezes only bound inputs, requested dimensions survive without using output dimensions', () => {
  const f = { ...start(), width: 3001, steps: 75, scale: 4.25, seed:'0' };
  const base = collect(f,model,2); f.width=500; f.scale=1;
  const a = drawingPayload(batchParams(base,0)), b = drawingPayload(batchParams(base,1));
  assert.deepEqual(a.comfyParameters,{width:3001,height:750,steps:75,cfg:4.25}); assert.deepEqual(a.comfyParameters,b.comfyParameters);
  const p = { model:model.id,width:320,height:192,comfyParameters:a.comfyParameters,comfyWorkflow:{...adjustable,connectionId:'gpu',name:'test',revision:'r'} };
  assert.deepEqual(imageParameters(p).comfyParameters,a.comfyParameters);
  const reused = reuseFields({params:p}); assert.equal(reused.width,3001); assert.equal(reused.scale,4.25);
  assert.equal(prepareDrawingFields(reused,[model],[]).changes.steps,75);
  assert.equal(reuseFields({params:{model:model.id,width:320,height:192}}).width,undefined);
});

test('Comfy ASK: bounds follow final model; CFG, restore, field toggles, revisions and ordinary limits remain explicit', async () => {
  const base = { boardId:'b',boardPresent:true,form:start(),models:[model,normal],samplers:[DEFAULTS.sampler],composer:'',conversationId:'c' };
  const awareness = await naiAwareness(base).counted();
  assert.equal(awareness.form.width,1000); assert.equal(awareness.capabilities.parameters.scale.label,'CFG');
  assert.equal(awareness.capabilities.dimensions.alignment,undefined);
  const steps = [{kind:'params_patch',params:{width:3001,height:777,steps:75,scale:4.25}}];
  const good = plan(base,steps); assert.ok(good.steps.every(s=>!s.issue)); assert.equal(good.steps.at(-1).label,'CFG');
  assert.throws(()=>parseParameters({width:3001})); assert.throws(()=>parseParameters({steps:75})); assert.throws(()=>parseParameters({scale:-1}));
  assert.throws(()=>plan(base,[{kind:'params_patch',params:{width:0}}]));
  const stale = {...base,models:[{...model,sourceRevision:'new'},normal]}; assert.ok(plan(base,steps,[],stale).steps.every(s=>s.issue));
  const library=[{id:'pic',aliases:['#h1'],params:{model:model.id,width:320,height:192,comfyParameters:{width:3001,steps:75,cfg:4.25}}}];
  const restored = plan(base,[{kind:'restore_partial',source:'#h1',fields:['width','steps','scale']}],library);
  assert.deepEqual(restored.changes.map(c=>c.after),[3001,75,4.25]);
  const ordinaryBase={...base,form:{...structuredClone(DEFAULTS)},models:[normal,model]};
  const switched=plan(ordinaryBase,[{kind:'params_patch',params:{width:3001}},{kind:'params_patch',params:{model:model.id}}]);
  assert.ok(switched.steps.every(s=>!s.issue));
  const toggled=plan(ordinaryBase,[{kind:'params_patch',params:{width:3001}},{kind:'params_patch',params:{model:model.id}}],[],ordinaryBase,new Set(['1:model']));
  assert.ok(toggled.steps.some(s=>s.issue));
  const back = plan(base,[{kind:'params_patch',params:{model:normal.id}}]); assert.ok(back.steps.every(s=>!s.issue));
});
