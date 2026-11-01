import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connection, routing, controlledConfig as config, nodeInfo} from './helpers/comfy-fixture.mjs';
import {validateComfyWorkflow, injectWorkflow} from '../src/domain/comfy-workflow.ts';
import {comfyControlSpec, validateComfyControls, currentComfyControls, parseComfyNodeInfo, checkComfyControlOptions} from '../src/domain/comfy-controls.ts';
import {comfyCatalog, readComfyNodeInfo} from '../src/gateway/comfyui.ts';
import {createComfyOptions} from '../src/services/comfy-options.ts';
import {createConnections} from '../src/services/connections.ts';
import {DEFAULTS,collect,drawingPayload,batchParams,reuseFields,prepareDrawingFields,readBoards} from '../src/domain/drawing.ts';
import {imageParameters} from '../src/domain/image-parameters.ts';
import {naiAwareness} from '../src/services/nai-awareness.ts';
const spec=comfyControlSpec(config), model=comfyCatalog({...connection,comfyWorkflow:config}).models[0];
async function connections(auth='none') {
 const map=new Map(),c=createConnections({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)},fn=>fn());
 await c.save({...routing,connections:{gpu:{...connection,authMode:auth,comfyWorkflow:config}}});
 if(auth==='bearer')c.supplyKey('gpu-key','synthetic-key');return c;
}
test('Comfy controls: split sampler/scheduler and complete LoRA bindings, shared conflict detection',()=>{
 assert.deepEqual(validateComfyWorkflow(config),config);
 for(const alter of [c=>c.bindings.controls.sampler={nodeId:'3',field:'positive'},c=>c.bindings.controls.scheduler=c.bindings.controls.sampler,c=>delete c.bindings.controls.loras[0].clipField,c=>c.bindings.controls.loras.push(c.bindings.controls.loras[0]),c=>c.bindings.controls.loras[0].modelField='lora_name',c=>c.bindings.controls.loras[0].zeroDisables=false]) {
  const bad=structuredClone(config);alter(bad);assert.throws(()=>validateComfyWorkflow(bad));
 }
 const custom=structuredClone(config);custom.workflow['4'].class_type='CustomLora';assert.doesNotThrow(()=>validateComfyWorkflow(custom));
 delete custom.bindings.controls.loras[0].zeroDisables;assert.throws(()=>validateComfyWorkflow(custom));
});
test('Comfy controls: exact injection, model-only negative strength, disabled dual strengths and immutable topology',()=>{
 const values=structuredClone(spec.defaults);values.sampler='dpmpp_2m';values.scheduler='karras';values.loras[0]={...values.loras[0],name:'style/new.safetensors',enabled:false};
 const expected=structuredClone(config.workflow);expected['6'].inputs.prompt_text='words';expected['3'].inputs.seed=0;expected['3'].inputs.noise_seed=0;
 expected['12'].inputs.sampler_name='dpmpp_2m';expected['13'].inputs.scheduler='karras';expected['4'].inputs.lora_name='style/new.safetensors';expected['4'].inputs.strength_model=0;expected['4'].inputs.strength_clip=0;
 assert.deepEqual(injectWorkflow(config,'words','',0,{},values),expected);
 assert.equal(values.loras[0].strengthModel,0.75);assert.equal(config.workflow['4'].inputs.strength_clip,0.5);
 assert.equal(expected['14'].inputs.strength_model,-0.2);
 for(const patch of [{sampler:''},{loras:[]},{loras:[{...values.loras[0],strengthModel:Infinity},values.loras[1]]},{loras:[values.loras[0],{...values.loras[1],strengthClip:1}]}])assert.throws(()=>validateComfyControls({...values,...patch},spec));
});
test('Comfy controls: board/model memory, signature changes, frozen payload and recipe restoration',()=>{
 const values={...structuredClone(spec.defaults),sampler:'dpmpp_2m'};
 const memory={[model.id]:{signature:spec.signature,values}};
 assert.equal(currentComfyControls(memory,model).sampler,'dpmpp_2m');
 assert.equal(currentComfyControls(memory,{...model,id:'comfyui:other'}).sampler,'euler');
 const changed=structuredClone(config);changed.workflow['12'].inputs.sampler_name='new';
 assert.equal(currentComfyControls(memory,{...model,comfyControls:comfyControlSpec(changed)}).sampler,'new');
 const form={...structuredClone(DEFAULTS),model:model.id,comfyControlMemory:memory,seed:'0'};
 const base=collect(form,model,2);values.sampler='euler';
 assert.equal(drawingPayload(batchParams(base,1)).comfyControls.sampler,'dpmpp_2m');
 const params={model:model.id,comfyControls:base.comfyControls,comfyWorkflow:{...config,connectionId:'gpu',name:'workflow',revision:'r'}};
 assert.deepEqual(imageParameters(params).comfyControls,base.comfyControls);
 const restored=prepareDrawingFields(reuseFields({params}),[model],[]).changes;
 assert.equal(restored.comfyControlMemory[model.id].values.sampler,'dpmpp_2m');
 assert.equal(prepareDrawingFields(reuseFields({params}),[{...model,comfyControls:comfyControlSpec(changed)}],[]).changes.comfyControlMemory,undefined);
 assert.deepEqual(readBoards({boards:{items:[{id:'b',form}]}}).items[0].form.comfyControlMemory,memory);
});
test('Comfy node options: declared enums, schema limits, unavailable choices and missing classes',async()=>{
 const c=await connections('bearer'),calls=[];
 const info=await readComfyNodeInfo(c.context('gpu'),['KSamplerSelect','LoraLoader','LoraLoader'],new AbortController().signal,async(url,init)=>{calls.push({url,init});return Response.json(nodeInfo(decodeURIComponent(url.split('/').at(-1))));});
 assert.equal(calls.length,2);assert.equal(calls[0].init.headers.Authorization,'Bearer synthetic-key');assert.equal(calls[0].init.credentials,'omit');
 assert.deepEqual(info.KSamplerSelect.sampler_name.choices,['euler','dpmpp_2m']);
 assert.throws(()=>checkComfyControlOptions({...spec.defaults,sampler:'missing'},spec,info),/不可用/);
 const bad=structuredClone(spec.defaults);bad.loras[0].strengthModel=11;assert.throws(()=>checkComfyControlOptions(bad,spec,info),/范围/);
 assert.throws(()=>parseComfyNodeInfo({},'Missing'));
 assert.deepEqual(parseComfyNodeInfo({Custom:{input:{required:{name:['COMBO',{options:['x','y']}]}}}},'Custom').Custom.name.choices,['x','y']);
});
test('Comfy option cache: no duplicate reads, credential changes, stale completion and explicit refresh',async()=>{
 const c=await connections('bearer');let requests=0,release;const gate=new Promise(resolve=>{release=resolve;});
 const cache=createComfyOptions(c,()=>{},async url=>{requests++;if(requests===1)await gate;return Response.json(nodeInfo(decodeURIComponent(url.split('/').at(-1))));});
 const old=cache.load(model);await cache.load(model);assert.equal(requests,1);
 c.supplyKey('gpu-key','changed-key');const current=cache.load(model);await current;release();await old;
 assert.equal(cache.snapshot(model).loading,false);assert.ok(cache.snapshot(model).info.LoraLoader);
 const before=requests;await cache.load(model);assert.equal(requests,before);await cache.load(model,true);assert.ok(requests>before);
 cache.dispose();
});
test('Comfy ASK: controls and LoRA are readable without granting additional write fields',async()=>{
 const form={...structuredClone(DEFAULTS),model:model.id};const snapshot=await naiAwareness({form,models:[model],samplers:[]}).counted();
 assert.equal(snapshot.form.comfyControls.sampler,'euler');assert.equal(snapshot.effective.comfyControls.loras.length,2);
 assert.ok(snapshot.capabilities.read_only_controls);assert.ok(!snapshot.capabilities.writable_fields.includes('sampler'));
});
