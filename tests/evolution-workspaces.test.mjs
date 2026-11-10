import test from 'node:test';
import assert from 'node:assert/strict';
import { evolutionMask, readEvolutionInput } from '../src/domain/evolution-input.ts';
import { recipeClusters, recipeOf, effectiveSignature, recipeSignature } from '../src/ask/retrospect/recipe.ts';
import { recipeDiff } from '../src/ask/retrospect/diff.ts';
import { readRetrospect } from '../src/ask/retrospect/model.ts';
import { createRecipeReader } from '../src/ask/retrospect/tools.ts';
import { createRetrospects } from '../src/ask/retrospect/store.ts';
import { chatEvolutionInput } from '../src/domain/chat-evolution.ts';

const input = (overrides={}) => ({workspace:'edit',operation:'inpaint',prompt:'softer light',negative:'',characters:[],params:{model:'image-model',strength:.5},base:{id:'source',label:'#e1.1'},...overrides});
const picture = (id, value=input()) => ({id,createdAt:Number(id.replace(/\D/g,''))||1,label:`#e1.${id.replace(/\D/g,'')||1}`,aliases:[`#e1.${id.replace(/\D/g,'')||1}`],params:{editBoardId:'board',evolutionInput:value},origins:[{source:'edit',boardId:'board',order:1}],size:{width:4,height:4},blob:new Blob()});
const refs = pictures => Object.fromEntries(pictures.map(p=>[p.label,{record_id:p.id,tag:p.label,scope:{kind:'page',id:'page'}}]));
const graph = pictures => readRetrospect({retrospect_title:'测试演进',nodes:pictures.map((p,i)=>({id:`v${i+1}`,label:`阶段 ${i+1}`,image_ids:[p.label]})),edges:[]},recipeClusters(pictures,new Set(),'edit:board'));

test('mask identity distinguishes edits with equal bounds/area and preserves unknown versus empty',async()=>{
  const a=await evolutionMask({width:4,height:4,bits:new Uint8Array([9,144])});
  const b=await evolutionMask({width:4,height:4,bits:new Uint8Array([17,136])});
  assert.deepEqual(a.summary.pixel_bbox,b.summary.pixel_bbox);
  assert.equal(a.summary.coverage_ratio,b.summary.coverage_ratio);
  assert.notEqual(a.hash,b.hash);
  const diff=recipeDiff(recipeOf({evolutionInput:input({mask:a})}),recipeOf({evolutionInput:input({mask:b})}));
  assert.equal(diff.parameters.find(p=>p.key==='input:mask').after,'蒙版已修改');
  assert.equal(await evolutionMask(null),null);
  assert.equal(await evolutionMask(undefined),undefined);
  assert.notEqual(effectiveSignature(recipeOf({evolutionInput:input()})),effectiveSignature(recipeOf({evolutionInput:input({mask:null})})));
});

test('EDIT candidates distinguish actual base/mask/options while ASK can still group a semantic stage',()=>{
  const a=picture('p1'),b=picture('p2'),c=picture('p3',input({base:{id:'another',label:'#e1.8'}}));
  const groups=recipeClusters([a,b,c],new Set(),'edit:board');assert.deepEqual(groups.map(g=>g.images.length),[2,1]);
  const result=readRetrospect({retrospect_title:'微调阶段',nodes:[{id:'v1',label:'微调',image_ids:[a.label,c.label],primary_id:c.label}],edges:[]},groups);
  assert.equal(result.nodes[0].recipe.input.base.id,'another');
  assert.equal(result.nodes[0].recipes[a.label].input.base.id,'source');
  const reader=createRecipeReader(()=>groups,'edit:board');const evidence=reader.read({});
  assert.equal(evidence.evolution.length,3);assert.equal(evidence.evolution[2].input.base.id,'another');
});

test('EDIT live results branch from the actual source and repeat the same input without another node',()=>{
  const origin=picture('source',input({operation:'source',base:null}));
  const registry=createRetrospects();const r=registry.register(graph([origin]),refs([origin]),{conversationId:'ask',turnId:1,boardId:'edit:board',boardName:'编辑'});
  const first=picture('p2');registry.land(registry.begin('edit:board',origin.id),first,refs([first]));
  const second=picture('p3');registry.land(registry.begin('edit:board',origin.id),second,refs([second]));
  assert.equal(registry.get(r.id).value.nodes.length,2);assert.equal(registry.get(r.id).value.nodes[1].image_ids.length,2);
  const branch=picture('p4',input({prompt:'new direction'}));registry.land(registry.begin('edit:board',origin.id),branch,refs([branch]));
  assert.deepEqual(registry.get(r.id).value.edges.map(e=>[e.from,e.to]),[['v1','v2'],['v1','v3']]);
  const pending=registry.begin('edit:board',origin.id);registry.detachBoard('edit:board');
  registry.land(pending,picture('p5'),refs([picture('p5')]));assert.equal(registry.get(r.id).value.nodes.length,3);
});

test('CHAT branch renumbering preserves record bindings and an in-flight parent',()=>{
  const a=picture('p1'),b=picture('p2',input({base:{id:a.id,label:a.label}}));
  const registry=createRetrospects();const r=registry.register(graph([a,b]),refs([a,b]),{conversationId:'ask',turnId:1,boardId:'chat:conversation',boardName:'CHAT'});
  const pending=registry.begin('chat:conversation',a.id);
  const renamed=[{...a,label:'#c2.1'},{...b,label:'#c1.1'}];registry.relabel(renamed);
  assert.equal(registry.get(r.id).pictureRefs['#c2.1'].record_id,a.id);
  assert.equal(registry.get(r.id).value.nodes[0].cover,'#c2.1');
  const c={...picture('p3',input({workspace:'chat',operation:'chat',base:{id:a.id,label:'#c2.1'}})),label:'#c3.1',scope:{kind:'chat',id:'conversation'}};
  delete c.params.editBoardId;registry.land(pending,c,refs([c]));
  assert.equal(registry.get(r.id).value.sampleBases['#c3.1'],'#c2.1');
});

test('CHAT input includes selected text context and references; the message parent is not the image parent',()=>{
  const v={id:'v1',status:'done',blocks:[{type:'image',assetId:'asset'}]};
  const t={id:'t1',prompt:'original',selectedVersion:0,versions:[v],snapshot:{turnIds:[],refs:[],base:null},settings:{model:'m',options:{quality:'auto'}}};
  const next={...t,id:'t2',versions:[],prompt:'lighter',parentId:'unrelated',snapshot:{turnIds:['t1'],refs:['reference'],base:'asset'}};
  const c={id:'c1',headId:'t1',turns:[t,next]};const recipe=chatEvolutionInput(c,next,{...v,id:'v2'});
  assert.equal(recipe.context[0].text,'original');assert.match(recipe.base.id,/t1/);assert.equal(recipe.references[0].id,'asset:reference');
  assert.equal(recipe.mask,undefined,'old snapshots cannot invent a known-empty mask');
  next.versions=[v];
  assert.equal(chatEvolutionInput(c,next,{...v,id:'v2'}).base.id,'asset:asset','legacy identical bytes in multiple versions do not invent a unique source record');
});

test('cosmetic image renumbering preserves restoration identity and malformed role slots cannot break Diff',()=>{
  const a=recipeOf({evolutionInput:input({base:{id:'same',label:'#c1.1'}})});
  const b=recipeOf({evolutionInput:input({base:{id:'same',label:'#c5.1'}})});
  assert.equal(recipeSignature(a),recipeSignature(b));
  assert.notEqual(recipeSignature(a),recipeSignature(recipeOf({evolutionInput:input({base:{id:'different',label:'#c1.1'}})})));
  const parsed=readEvolutionInput(input({characters:[null,{on:false,prompt:'inactive'},{}]}));
  assert.doesNotThrow(()=>recipeDiff(a,recipeOf({evolutionInput:parsed})));
  assert.equal(readEvolutionInput(input({mask:{hash:'bad',summary:{has_mask:true,status:'ready',coverage_ratio:'unknown'}}})),null);
  assert.equal(effectiveSignature(recipeOf({evolutionInput:input({params:{cfg_rescale:.4}})})),effectiveSignature(recipeOf({evolutionInput:input({params:{cfgRescale:.4}})})));
});

test('explicit source handoff retains graph identity/layout and invalidates old in-flight work',()=>{
  const origin=picture('p1'), registry=createRetrospects();
  const r=registry.register(graph([origin]),refs([origin]),{conversationId:'ask',turnId:1,boardId:'image-board',boardName:'绘图'});
  registry.arrange(r.id,{v1:{x:400,cy:200,z:2}});
  const old=registry.begin('image-board');
  assert.equal(registry.transfer('edit:board',origin.id,'编辑'),true);
  const next=picture('p2',input({prompt:'new edit'}));registry.land(old,next,refs([next]));
  assert.equal(registry.get(r.id).value.nodes.length,1);
  registry.land(registry.begin('edit:board',origin.id),next,refs([next]));
  assert.equal(registry.get(r.id).value.nodes.length,2);
  assert.deepEqual(registry.get(r.id).nodeLayout.v1,{x:400,cy:200,z:2});
  assert.equal(registry.activeForBoard('image-board'),null);
});
