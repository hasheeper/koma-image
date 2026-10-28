import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, boardForm } from '../src/domain/drawing.ts';
import { parseSlateEdit, recipeForm } from '../src/slate/edit.ts';
import { contentKey, summary, assetPath } from '../src/slate/model.ts';
import { stripSyntax, captionText } from '../src/slate/captions.ts';
import { parseDraft, validateDraft, stateHash } from '../src/ask/draft/validate.ts';
import { draftView } from '../src/ask/draft/view.ts';
import { receiveDraft } from '../src/bridge/protocol.ts';
import { externalEdit, slateFile, combineSlateDocument } from '../src/slate/documents.ts';
import { createTools } from '../src/ask/tools.ts';
import { imageParameters } from '../src/domain/image-parameters.ts';
const form = {...structuredClone(DEFAULTS),prompt:'sky'};
const base = () => ({form:structuredClone(form),composer:'',conversationId:'chat',workspace:'image',boardId:'b',boardName:'one',boardPresent:true,models:[],samplers:[]});
const create = () => parseSlateEdit({kind:'slate_edit',op:'create',slate_title:'系列',todos:[{op:'add',todo_title:'首图',image_required:false}]},null,form,[]).change.after;
const update = slate => ({kind:'slate_edit',op:'update',slate_id:slate.id,expected_version:slate.version});
const picture={id:'record',label:'#h1',aliases:['#h1'],origins:[{source:'history',label:'#h1',order:1}],params:{prompt:'sent',basePrompt:'base',seed:0},size:{width:128,height:192},blob:new Blob(['synthetic'],{type:'image/png'})};

test('PE1 manual delivery retains a filtered source recipe, explicit lineage and source captions',()=>{
  const params=imageParameters({tool:'manual-edit',modelName:'手动编辑',editSource:'photopea',editId:'edit-1',editParent:'history:source',editedAt:'2026-10-27T00:00:00Z',width:256,height:384,
    sourceRecipe:{prompt:'sent',basePrompt:'raw',seed:0,model:'nai-diffusion-4-5-full',localCharacters:[{id:'c1',on:true,prompt:'character',negative:'',centers:[{x:.5,y:.5}]}],apiKey:'do-not-copy',sourceRecipe:{secret:'nested'}},apiKey:'do-not-copy'});
  assert.equal(params.tool,'manual-edit');assert.equal(params.seed,undefined);assert.equal(params.sourceRecipe.seed,0);
  assert.equal(params.editParent,'history:source');assert.equal(params.apiKey,undefined);assert.equal(params.sourceRecipe.apiKey,undefined);assert.equal(params.sourceRecipe.sourceRecipe,undefined);
  assert.equal(captionText({params},{source:'base',mode:'full'}),'raw');
  assert.equal(captionText({params},{source:'sent',mode:'full'}),'sent');
  assert.equal(captionText({params},{source:'character',characterId:'c1',mode:'full'}),'character');
});

test('B3 local IDs, task operations, image completion guard and version gate',()=>{
  const slate=create();assert.ok(slate.id);assert.ok(slate.todos[0].id);assert.notEqual(slate.id,slate.todos[0].id);
  const change=parseSlateEdit({...update(slate),todos:[{op:'update',id:slate.todos[0].id,status:'done',mutation:'crop accepted'},{op:'add',todo_title:'Bonus',bonus:true}]},slate,form,[]).change;
  assert.equal(change.after.todos[0].status,'done');assert.equal(change.after.todos[1].bonus,true);assert.equal(change.after.version,2);
  assert.throws(()=>parseSlateEdit({...update(slate),expected_version:99},slate,form,[]),/版本/);
  assert.throws(()=>parseSlateEdit({...update(slate),todos:[{op:'update',id:slate.todos[0].id,status:'done',image_required:true}]},slate,form,[]),/绑图/);
  assert.throws(()=>parseSlateEdit({kind:'slate_edit',op:'create',slate_title:'x',slate_id:'foreign'},null,form,[]),/省略 slate_id/);
});
test('B3 new Todo IDs are generated even when agents supply repeated or existing IDs',()=>{
  const slate=create(),existing=slate.todos[0].id;
  const raw={...update(slate),todos:[
    {op:'add',id:existing,todo_title:'新增一',image_required:false},
    {op:'add',id:existing,todo_title:'新增二',image_required:false},
    {op:'update',id:existing,mutation:'保留已有任务身份'},
  ]};
  const before=structuredClone(raw),after=parseSlateEdit(raw,slate,form,[]).change.after;
  assert.deepEqual(raw,before,'parsing does not rewrite the agent input');
  assert.equal(after.todos.length,3);assert.equal(new Set(after.todos.map(t=>t.id)).size,3);
  assert.equal(after.todos[0].id,existing);assert.equal(after.todos[0].mutation,'保留已有任务身份');
  for(const todo of after.todos.slice(1))assert.match(todo.id,/^[0-9a-f-]{36}$/);
  assert.equal(slate.todos.length,1,'proposal does not write the active Slate');
  const state={...base(),slate},received=receiveDraft({schema:'koma.bridge.draft.v1',draft_id:'new-ids',draft_title:'追加清单',steps:[raw]},{base:state,library:[],pictureScope:'scope'});
  assert.ok(received);
  assert.throws(()=>parseSlateEdit({...update(slate),todos:[{op:'add',id:'CG01',todo_title:'新增'},{op:'update',id:'CG01',mutation:'不是稳定身份'}]},slate,form,[]),/不存在/,'a discarded add ID cannot address another task');
  assert.throws(()=>parseSlateEdit({...update(slate),todos:[{op:'update',id:existing},{op:'remove',id:existing}]},slate,form,[]),/合并/,'existing-task duplicate protection remains');
});
test('B3 composite IMAGE + Slate validates the full group, previews detail and captures the final recipe',()=>{
  const state={...base(),slate:create()};
  const draft=parseDraft({draft_title:'推进',base_hash:stateHash(state),steps:[{...update(state.slate),golden_recipe:{capture_current:true},todos:[{op:'update',id:state.slate.todos[0].id,status:'done',mutation:'wider'}]},{kind:'prompt_patch',target:'image.prompt',mode:'append',text:', sunset'}]},state,[]);
  const plan=validateDraft(draft,state,{off:new Set()});assert.equal(plan.slate.after.golden_recipe.form.prompt,'sky, sunset');assert.equal(plan.changes[0].after,'sky, sunset');assert.ok(plan.steps.every(s=>s.locked));assert.equal(draftView(plan).fields[0].key,'slate');assert.match(plan.steps[0].after,/wider/);
  for(const now of [{...state,slate:{...state.slate,version:2}},{...state,form:{...state.form,prompt:'other'}}]) {
    const conflict=validateDraft(draft,now,{off:new Set()});assert.ok(conflict.steps.some(s=>s.issue));assert.equal(conflict.slate,undefined);assert.equal(conflict.changes.length,0);
  }
  const partial=validateDraft(draft,state,{off:new Set(['1'])});assert.equal(partial.slate,undefined);assert.equal(partial.changes.length,0);
});
test('B3 binding resolves frozen image identity, exact metadata, explicit captions, vanished image blocks whole draft',()=>{
  const state={...base(),slate:create()},step={...update(state.slate),todos:[{op:'update',id:state.slate.todos[0].id,status:'done',image_required:true,bind:{source:'#h1',caption_source:'base',caption_mode:'full'}}]};
  const draft=parseDraft({draft_title:'交付',base_hash:stateHash(state),steps:[step]},state,[picture]);
  const plan=validateDraft(draft,state,{off:new Set()});assert.equal(plan.slate.bindings[0].ref,'record');assert.match(plan.slate.bindings[0].metadata,/"seed":0/);assert.match(plan.slate.after.todos[0].binding.target_path,/^assets\/.*\.png$/);assert.equal(plan.boardId,undefined);
  const missing=validateDraft(draft,state,{off:new Set(),has:()=>false});assert.equal(missing.slate,undefined);assert.match(missing.steps[0].issue,/移除/);
  assert.throws(()=>receiveDraft({schema:'koma.bridge.draft.v1',draft_id:'bind',draft_title:'交付',steps:[step]},{base:state,library:[picture],pictureScope:'scope'}),/作用域/);
});
test('B3 golden recipe needs explicit unlock; all real board fields preserved and sensitive/unknown fields rejected',()=>{
  const slate=create();slate.golden_recipe={form:boardForm(form),locked:true};
  assert.throws(()=>parseSlateEdit({...update(slate),golden_recipe:{capture_current:true}},slate,form,[]),/锁定/);
  const after=parseSlateEdit({...update(slate),golden_recipe:{capture_current:true,unlock:true,locked:true}},slate,{...form,cfgRescale:.3,naiMode:'furry',transparentBg:true},[]).change.after;
  assert.equal(after.golden_recipe.form.cfgRescale,.3);assert.equal(after.golden_recipe.form.naiMode,'furry');assert.equal(after.golden_recipe.locked,true);
  assert.throws(()=>recipeForm({...boardForm(form),apiKey:'never'}),/不支持/);
  assert.throws(()=>recipeForm({...boardForm(form),width:'oops'}),/无效/);
  assert.deepEqual(recipeForm(boardForm(form)),boardForm(form));
});
test('B3 draft summaries count task changes and keep recipe content in details with unlock and delivery requirements visible',()=>{
  const state={...base(),slate:create()};state.slate.golden_recipe={form:boardForm({...form,prompt:'long_marker '.repeat(1000)}),locked:true};
  const proposed=parseDraft({draft_title:'紧凑预览',base_hash:stateHash(state),steps:[{...update(state.slate),slate_title:'新名称',directory_required:true,golden_recipe:{capture_current:true,unlock:true,locked:true},todos:[{op:'remove',id:state.slate.todos[0].id},{op:'add',todo_title:'新任务',description:'full_description '.repeat(200),image_required:false}]}]},state,[]);
  const checked=validateDraft(proposed,state,{off:new Set()}),row=draftView(checked).fields[0].steps[0];
  assert.equal(row.kind,'slate');assert.equal(row.heading,'重命名 · 新名称');assert.equal(row.summary,'新增 1 项 · 删除 1 项');assert.match(row.recipe,/更新配方/);assert.equal(row.caution,'本次解锁配方 · 要求目录交付');
  assert.doesNotMatch(row.summary+row.recipe,/long_marker|full_description/);assert.match(row.step.before,/long_marker/);assert.match(row.step.after,/full_description/);
  const conflict=draftView(validateDraft(proposed,{...state,slate:{...state.slate,version:99}},{off:new Set()})).fields[0].steps[0];
  assert.equal(conflict.heading,'任务板有冲突');assert.match(conflict.step.issue,/版本/);assert.match(conflict.step.after,/full_description/);
});
test('B3 captions preserve chosen source exactly, strip only defined balanced wrappers and retain malformed/escaped syntax',()=>{
  const cases=[['{{a}}, [b], 1.2::c::','a, b, c'],['<scene>明亮 😀 <body>one</body></scene>','明亮 😀 one'],['{a [b]}','a b'],['1::a 2::b:: c::','a b c'],['\\{literal\\}, \\[x\\]','\\{literal\\}, \\[x\\]'],['{unclosed [x]','{unclosed [x]'],['{mismatch]','{mismatch]'],['1::2::x::','1::2::x::'],['<a><b>x</a>','<a><b>x</a>'],['(artist:1.2), artist_name','(artist:1.2), artist_name'],['\\<tag>literal</tag>','\\<tag>literal</tag>']];
  for(const [input,expected] of cases)assert.equal(stripSyntax(input),expected,input);
  const asset={params:{basePrompt:' {base} ',prompt:'sent, preset',localCharacters:[{id:'c2',prompt:'hero'}]}};
  assert.equal(captionText(asset,{source:'base',mode:'full'}),' {base} ');assert.equal(captionText(asset,{source:'sent',mode:'full'}),'sent, preset');assert.equal(captionText(asset,{source:'character',characterId:'c2',mode:'full'}),'hero');assert.throws(()=>captionText({params:{}},{source:'base',mode:'full'}),/没有/);
});
test('B3 safe target paths, external files become review steps; delivery claims cannot import images',()=>{
  for(const path of ['../secret.png','assets/../x.png','assets/a\\b.png','assets/x.json','/assets/x.png'])assert.throws(()=>assetPath(path));
  const slate=create(),doc=slateFile(slate);doc.slate=structuredClone(slate);doc.slate.todos[0].mutation='external';
  const edit=externalEdit(doc,slate);assert.equal(edit.expected_version,slate.version);assert.equal(edit.todos[0].mutation,'external');
  doc.slate.todos[0].binding={assetId:'forged'};assert.throws(()=>externalEdit(doc,slate),/不能声明/);
  assert.equal(contentKey(slate),contentKey({...slate,version:10}));
  assert.equal(summary(slate).todos[0].id,slate.todos[0].id);assert.ok(!('description' in summary(slate).todos[0]));
});
test('B3 existing task files cannot rebase stale or missing versions onto the latest local task',()=>{
  const original=create(), current={...structuredClone(original),version:original.version+1};
  current.todos[0].mutation='new local change';
  const stale=slateFile(structuredClone(original));
  stale.slate.todos[0].title='outdated task';
  assert.throws(()=>externalEdit(stale,current),/版本/);
  delete stale.slate.version;
  assert.throws(()=>externalEdit(stale,current),/版本/);
  const fresh=slateFile(structuredClone(current));
  fresh.slate.todos[0].description='review this change';
  const step=externalEdit(fresh,current);
  assert.equal(step.expected_version,current.version);
  assert.equal(step.todos[0].mutation,'new local change');
  assert.equal(step.todos[0].description,'review this change');
  assert.equal(current.todos[0].description,'','conversion never mutates local state');
});
test('B3 full state is read only on demand; selected Slate exports remain explicitly scoped',()=>{
  const slate=create(),get=createTools().get('get_state'),ctx={state:()=>({text:'summary',images:0}),readSlate:()=>slate};
  assert.equal(get.run({},ctx).content.length,1);assert.match(get.run({include_slate:true},ctx).content[1].text,new RegExp(slate.id));
  const doc={title:'memo',stem:'memo',formats:{md:'chosen text'}};
  assert.equal(combineSlateDocument(doc,null),doc);const combined=combineSlateDocument(doc,slate);assert.match(combined.formats.md,/chosen text/);assert.match(combined.formats.md,/系列/);
});
