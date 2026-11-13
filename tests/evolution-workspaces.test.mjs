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
  assert.deepEqual(diff.parameters,[]); assert.equal(diff.transition.before.input.mask.hash,a.hash); assert.equal(diff.transition.after.input.mask.hash,b.hash);
  assert.equal(await evolutionMask(null),null);
  assert.equal(await evolutionMask(undefined),undefined);
  assert.notEqual(effectiveSignature(recipeOf({evolutionInput:input()})),effectiveSignature(recipeOf({evolutionInput:input({mask:null})})));
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

test('workspace boundaries keep full originals without pretending tags, edit prompts and CHAT instructions are word replacements',async()=>{
 const {groupsOf}=await import('../src/ask/retrospect/groups.ts');
 const {recipeTarget}=await import('../src/ask/retrospect/recipe.ts');
 const image=recipeOf({model:'nai-v5',basePrompt:'1.35::artist::, 2girls, gothic window',baseNegative:'lowres',localCharacters:[]});
 const edit=recipeOf({evolutionInput:input({prompt:'refine eyes'})});
 const chat=recipeOf({evolutionInput:input({workspace:'chat',operation:'chat',prompt:'Add the gold logo, preserve both characters'})});
 for(const [a,b] of [[image,chat],[image,edit],[edit,chat],[chat,image]]){
  const d=recipeDiff(a,b);assert.deepEqual(d.texts,[]);assert.deepEqual(d.parameters,[]);
  assert.equal(d.transition.before.prompt,a.prompt);assert.equal(d.transition.after.prompt,b.prompt);
  const groups=groupsOf({recipe:a},{recipe:b});assert.ok(groups.every(g=>g.standalone));
  assert.ok(groups.some(g=>g.texts.some(t=>t.after===a.prompt)));assert.ok(groups.some(g=>g.texts.some(t=>t.after===b.prompt)));
 }
 assert.ok(recipeDiff(chat,{...chat,prompt:chat.prompt+', small'}).transition);
 assert.deepEqual(recipeDiff(chat,{...chat,prompt:chat.prompt+', small'}).texts,[]);
 const imported={...picture('p1'),params:{boardId:'image-board',basePrompt:'tag',baseNegative:'',localCharacters:[]},origins:[{source:'history',order:1},{source:'edit',boardId:'editing'}]};
 assert.equal(recipeTarget(imported),'image-board','visibility in EDIT does not change the source grammar or restore destination');
 const chatPic={...picture('p2',input({workspace:'chat',operation:'chat'})),scope:{kind:'chat',id:'conversation'}};
 assert.equal(recipeTarget(chatPic),'chat:conversation');
 assert.throws(()=>readRetrospect({retrospect_title:'mixed',nodes:[{id:'v1',label:'不可混语法',image_ids:[imported.label,chatPic.label]}],edges:[]},recipeClusters([imported,chatPic],new Set())),/工坊|跨工作区/);
});
