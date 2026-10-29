import test from 'node:test';
import assert from 'node:assert/strict';
import { naiAwareness,naiQuoteKey } from '../src/services/nai-awareness.ts';
import { DEFAULTS } from '../src/domain/drawing.ts';
import { naiInputParts,naiInputLimits } from '../src/domain/nai-input.ts';
const model={id:'nai-diffusion-4-5-full',name:'V4.5',profileId:'nai-official-v1',connection:'secret',upstreamId:'private',maxPixels:3145728,transparentBackground:false};
const make=(patch={},extra={})=>({form:{...structuredClone(DEFAULTS),model:model.id,...patch},models:[model],samplers:['k_euler_ancestral'],...extra});
const counter=async p=>{const parts=naiInputParts(p);return {...naiInputLimits(p.model),ids:parts.ids,prompt:parts.prompt.map(s=>s.length+1),negative:parts.negative.map(s=>s.length+1)};};
test('awareness preserves saved values, separates directions, excludes disabled roles and secrets',async()=>{
 const c=(id,on)=>({id,on,prompt:'cat',negative:'bad',centers:[{x:.5,y:.5}]});
 const state=await naiAwareness(make({prompt:'girl',characters:[c('c1',true),c('c2',false)],varietyPlus:true}),counter).counted();
 assert.equal(state.input_budget.positive.used,9);assert.equal(state.input_budget.negative.used,5);
 assert.deepEqual(Object.keys(state.input_budget.positive.characters),['c1']);
 assert.equal(state.capabilities.parameters.varietyPlus.supported,true);
 assert.equal(state.effective.varietyPlus,true);
 assert.ok(!JSON.stringify(state).includes('secret'));assert.ok(!JSON.stringify(state).includes('private'));
});
test('Medium effective values and Text blocking do not modify the saved form',async()=>{
 const m={...model,id:'nai-diffusion-5-full-medium'};
 const input=make({model:m.id,prompt:'Text: '+'x'.repeat(751),negative:'user negative',steps:25},{models:[m]});
 const state=await naiAwareness(input,counter).counted();
 assert.equal(state.effective.steps,14);assert.equal(input.form.steps,25);
 assert.equal(state.input_budget.text.overflow,1);assert.ok(state.diagnostics.some(d=>d.severity==='error'));
 assert.equal(state.effective.cfgRescale,null);
});
test('cost only uses matching read ports, stale account remains unknown, encoding charged once',()=>{
 assert.equal(naiAwareness(make()).snapshot.cost.status,'unknown');
 assert.equal(naiAwareness(make({}, {account:{active:true,tier:3},accountAt:1})).snapshot.cost.status,'unknown');
 const input=make({batchCount:3},{quote:{status:'ready',quote:{cost:7,encodingCost:2,estimated:true,unit:'Anlas'}},quoteAt:Date.now()});input.quoteKey=naiQuoteKey(input.form,model);
 const state=naiAwareness(input).snapshot;
 assert.equal(naiAwareness({...input,form:{...input.form,scale:8}}).snapshot.cost.status,'stale');
 assert.equal(state.cost.batch_total,17);assert.equal(state.cost.encoding_once,2);
});

test('connection revision invalidates price and input identity; saved account data is allowlisted',async()=>{
 const {naiSourceKey,naiAccountSnapshot}=await import('../src/services/nai-awareness.ts');
 const a={...model,sourceRevision:'r1'},b={...model,sourceRevision:'r2'},input=make({}, {models:[a],quote:{status:'ready',quote:{cost:4,unit:'credits'}},quoteAt:Date.now()});input.quoteKey=naiQuoteKey(input.form,a);
 const old=naiAwareness(input).snapshot,next=naiAwareness({...input,models:[b]}).snapshot;
 assert.equal(old.cost.status,'ready');assert.equal(next.cost.status,'stale');assert.notEqual(old.input_budget.input_hash,next.input_budget.input_hash);assert.notEqual(naiSourceKey(a),naiSourceKey(b));
 assert.deepEqual(naiAccountSnapshot({active:true,tier:3,email:'private',token:'private',usage:{isNegative:false,private:'private'}}),{active:true,tier:3,usage:{isNegative:false}});
});
