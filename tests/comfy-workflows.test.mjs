import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateComfyWorkflows, connectionWorkflows, resolveComfyRoute } from '../src/domain/comfy-workflows.ts';
import { validateComfyWorkflow, injectWorkflow, comfyRecipeModelId } from '../src/domain/comfy-workflow.ts';
import { comfyCatalog, executeComfy } from '../src/gateway/comfyui.ts';
import { validateRouting } from '../src/config/connections.ts';
import { createConnections } from '../src/services/connections.ts';
import { createComfyOptions } from '../src/services/comfy-options.ts';
import { imageParameters } from '../src/domain/image-parameters.ts';
import { prepareDrawingFields } from '../src/domain/drawing.ts';
import { connection, complete } from './helpers/comfy-fixture.mjs';
const bundle = JSON.parse(readFileSync(new URL('../examples/comfyui/three-workflows.json', import.meta.url)));
const workflows = validateComfyWorkflows(bundle.workflows);
const supplier = { ...connection, comfyWorkflow: undefined, comfyWorkflows: workflows };
const routing = { version: 1, connections: { gpu: supplier }, links: {} };
async function connections() {
  const storage = new Map();
  const c = createConnections({ getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) }, work => work());
  await c.save(routing); return c;
}

test('Comfy workflows: three architectures, four explicit model routes and stable identity', () => {
  const c = validateRouting(routing).connections.gpu, before = structuredClone(c);
  const models = comfyCatalog(c).models;
  assert.equal(models.length, 4);
  assert.deepEqual(models.map(m => m.comfyWorkflowName), ['FLUX','SDXL','SDXL','Anima']);
  assert.equal(connectionWorkflows(connection)[0].id, 'default');
  assert.equal(comfyCatalog(connection).models[0].id, 'comfyui:gpu');
  for (const m of models) {
    const route = resolveComfyRoute(c,m.id), b = route.config.bindings.model;
    assert.equal(route.config.workflow[b.nodeId].inputs[b.field], route.model.file);
    assert.deepEqual(m.comfyModelFiles,[route.model.file]);
    const changed = injectWorkflow(route.config,'positive','negative',0,{width:768,height:1024});
    assert.equal(changed['4'].inputs.text,'positive');
    if (route.entry.id === 'flux') {
      assert.equal(changed['13'].inputs.width,768); assert.equal(changed['6'].inputs.width,768);
      assert.equal(changed['2'].inputs.clip_name,'qwen_3_4b.safetensors');
    } else if (route.entry.id === 'sdxl') assert.equal(changed['5'].inputs.text,'negative');
    else assert.equal(changed['2'].inputs.clip_name,'qwen_3_06b_base.safetensors');
    const renamed = structuredClone(c); renamed.name='new supplier';
    for(const e of renamed.comfyWorkflows) {e.name='new workflow';for(const model of e.models) model.name='new model';}
    assert.equal(resolveComfyRoute(renamed,m.id).model.file,route.model.file);
  }
  assert.deepEqual(c,before);
  assert.throws(()=>resolveComfyRoute(c,'comfyui:gpu:sdxl:arbitrary-file'),/已移除/);
});

test('Comfy workflow configuration rejects duplicate identities, model collisions and inconsistent synchronized defaults', () => {
  const change = f => {const entries=structuredClone(workflows);f(entries);return ()=>validateComfyWorkflows(entries);};
  assert.throws(change(e=>e[1].id=e[0].id),/身份重复/);
  assert.throws(change(e=>e[1].models[1].id=e[1].models[0].id),/身份重复/);
  assert.throws(change(e=>e[1].models[1].file=e[1].models[0].file),/文件名/);
  assert.throws(change(e=>e[0].models=[]),/至少添加/);
  assert.throws(change(e=>delete e[0].bindings.model),/先绑定/);
  assert.throws(change(e=>e[0].bindings.model=e[0].bindings.prompt[0]),/字段绑定重复/);
  assert.throws(change(e=>e[0].workflow['13'].inputs.width=512),/默认值须一致/);
  assert.throws(()=>validateComfyWorkflow({...workflows[0],bindings:{...workflows[0].bindings,parameters:{width:[]}}}),/不能为空/);
});

test('Comfy routed execution freezes the allowed checkpoint and preserves recipe identity through restoration', async () => {
  const c=await connections(), context=c.context('gpu'), selected=comfyCatalog(context.connection).models[2];
  const next=structuredClone(c.configuration);next.connections.gpu.comfyWorkflows[1].models[1].file='replacement.safetensors';
  await c.save(next);assert.notEqual(c.context('gpu').connection.revision,context.connection.revision);
  const requests=[];
  await executeComfy(context,{model:selected.id,prompt:'p',negative_prompt:'n',seed:3},r=>r.blob(),new AbortController().signal,async(url,init)=>{
    requests.push({url,body:init.body ? JSON.parse(init.body):null});
    if(url.endsWith('/prompt'))return Response.json({prompt_id:'job'});
    if(url.includes('/history/'))return Response.json(complete());
    return new Response(new Uint8Array([1]),{headers:{'Content-Type':'image/png'}});
  });
  assert.equal(requests[0].body.prompt['1'].inputs.ckpt_name,'NoobAI-XL-v1.1.safetensors');
  assert.equal(requests.filter(r=>r.url.endsWith('/prompt')).length,1);
  const route=resolveComfyRoute(supplier,selected.id);
  const recipe={...route.config,connectionId:'gpu',name:route.entry.name,revision:'r',workflowId:route.entry.id,modelId:route.model.id,modelName:route.model.name,modelFile:route.model.file};
  const params=imageParameters({model:selected.id,comfyWorkflow:recipe,comfyControls:selected.comfyControls.defaults});
  assert.equal(comfyRecipeModelId(params.comfyWorkflow),selected.id);
  assert.ok(prepareDrawingFields(params,[selected],[],selected).applied.includes('comfyControls'));
  const other=comfyCatalog(supplier).models[1];
  assert.ok(!prepareDrawingFields(params,[other],[],other).applied.includes('comfyControls'));
});

test('Comfy option cache separates workflows sharing a supplier, including stale completions', async () => {
  const c=await connections(),[flux,sdxl]=comfyCatalog(supplier).models,calls=[];
  let release;const gate=new Promise(r=>release=r);
  const cache=createComfyOptions(c,()=>{},async url=>{
    const type=url.split('/').at(-1);calls.push(type);
    if(type==='KSamplerSelect')await gate;
    return Response.json({[type]:{input:{required:{sampler_name:[['euler','euler_ancestral']],scheduler:[['normal']]}}}});
  });
  const first=cache.load(flux);await cache.load(sdxl);release();await first;
  assert.ok(cache.snapshot(sdxl).info.KSampler);
  assert.deepEqual(cache.snapshot(flux).info,{});
  await cache.load(flux);assert.ok(cache.snapshot(flux).info.KSamplerSelect);
  assert.deepEqual(calls,['KSamplerSelect','KSampler','KSamplerSelect']);cache.dispose();
});
