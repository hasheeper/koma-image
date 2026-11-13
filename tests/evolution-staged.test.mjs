import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/domain/drawing.ts';
import { recipeClusters, recipeOf } from '../src/ask/retrospect/recipe.ts';
import { createRecipeReader } from '../src/ask/retrospect/tools.ts';
import { createRetrospects } from '../src/ask/retrospect/store.ts';
import { readRetrospect, selectRetrospectBaseline, isStaged, versionCount, stagedCount } from '../src/ask/retrospect/model.ts';
import { createBranchTurn } from '../src/ask/retrospect/branch-turn.ts';
import { parseStagedInput, prepareStagedRecipe, stagedLoadPlan } from '../src/ask/retrospect/staged.ts';
import { createDraftWriter } from '../src/ask/draft/apply.ts';
import { createDraftStack } from '../src/ask/draft/stack.ts';
import { checkNaiInput } from '../src/ask/draft/nai-input.ts';

const picture = (n, prompt = `base ${n}`, extra = {}) => ({ id: `r${n}`, label: `#h${n}`, aliases: [`#h${n}`], createdAt: n,
  origins: [{ source: 'history', order: n, label: `#h${n}` }], size: { width: 832, height: 1216 },
  params: { ...structuredClone(DEFAULTS), boardId: 'board-1', basePrompt: prompt, baseNegative: 'lowres', localCharacters: [], ...extra } });
const refsOf = pictures => Object.fromEntries(pictures.map(p => [p.label, { tag: p.label, record_id: p.id, entity_key: '', scope: { kind: 'page', id: 'page' } }]));
const base = () => ({ workspace: 'image', boardId: 'board-1', boardName: 'board', nextCharacterId: 20, composer: '', conversationId: 'chat',
  form: { ...structuredClone(DEFAULTS), prompt: 'CURRENT FORM', seed: '456', batchCount: 3 },
  models: [{ id: DEFAULTS.model, name: 'NAI', profileId: 'koma-standard-v1' }], samplers: [DEFAULTS.sampler] });
const input = (label = '分支甲', text = 'next direction') => parseStagedInput({ base_image_id: '#h1', label, steps: [{ kind: 'prompt_patch', target: 'image.prompt', mode: 'rewrite', text }] });
const owner = { conversationId: 'ask', turnId: 1, boardId: 'board-1', boardName: 'board' };
function fixture(pictures = [picture(1), picture(2)], registered = true) {
  const store = createRetrospects(), refs = refsOf(pictures);
  const value = readRetrospect({ retrospect_title: 'tree', nodes: pictures.map((p, i) => ({ id: `v${i + 1}`, label: '阶段', image_ids: [p.label] })), edges: pictures.slice(1).map((_, i) => ({ from: `v${i+1}`, to: `v${i+2}`, summary: '修改' })) }, recipeClusters(pictures, new Set()));
  const r = registered ? store.register(value, refs, owner, 'active', pictures) : null;
  let turnId = 1;
  function turn(options = {}) {
    const reviews = structuredClone(store.records.value), reader = createRecipeReader(() => recipeClusters(pictures, new Set()), 'board-1', reviews);
    const controller = new AbortController();
    reader.read({});
    const branch = createBranchTurn({ store, reader, reviews, base: base(), owner: { ...owner, turnId: ++turnId }, library: pictures,
      refs: () => refs, signal: controller.signal, current: () => true, available: () => true, check: async () => null, ...options });
    return { reader, branch, controller };
  }
  return { store, r, value, turn, refs, pictures };
}

test('staged schema accepts one IMAGE branch only and evaluates from exact original role IDs', async () => {
  for (const bad of [{ ...input(), branches: [] }, { ...input(), steps: [{ kind: 'chat_handoff', text: 'x', images: [] }] }, { ...input(), steps: [{ kind: 'prompt_patch', target: 'chat.composer', mode: 'rewrite', text: 'x' }] }]) assert.throws(() => parseStagedInput(bad));
  const roles = [ { id: 'c3', on: false, prompt: 'dormant', negative: '', centers: [] }, { id: 'c8', on: true, prompt: '', negative: '', centers: [] }, { id: 'c12', on: true, prompt: 'black hair', negative: '', centers: [] } ];
  const source = picture(1, 'ORIGINAL', { localCharacters: roles }), state = base(), before = structuredClone(state);
  const plan = await prepareStagedRecipe({ ...input(), steps: [
    { kind: 'prompt_patch', target: 'image.prompt', mode: 'append', text: ', chair' },
    { kind: 'prompt_patch', target: 'image.char.c12.prompt', mode: 'replace', anchor: 'black', text: 'silver' },
    { kind: 'prompt_patch', target: 'image.char.c12.prompt', mode: 'after', anchor: 'silver', text: ' long' },
    { kind: 'character_edit', op: 'set_enabled', id: 'c3', on: true },
  ] }, source, state, [source], async () => null);
  assert.equal(plan.target.prompt, 'ORIGINAL, chair');
  assert.deepEqual(plan.target.characters.map(c => c.id), ['c3','c8','c12']);
  assert.equal(plan.target.characters[0].on, true); assert.equal(plan.target.characters[2].prompt, 'silver long hair');
  assert.deepEqual(state, before); assert.deepEqual(source.params.localCharacters, roles);
  const loaded = stagedLoadPlan({ ...plan, form: plan.target }, state, {}, 'load');
  assert.equal(loaded.changes.find(c => c.field === 'characters').after[2].id, 'c22');
  assert.equal(loaded.changes.find(c => c.field === 'seed').after, '456');
  assert.equal(loaded.changes.find(c => c.field === 'batchCount').after, 3);
  const explicit = await prepareStagedRecipe({ ...input(), steps: [{ kind: 'params_patch', params: { seed: '123', batchCount: 2 } }] }, source, state, [source], async () => null);
  const explicitLoad = stagedLoadPlan({ ...explicit, form: explicit.target }, state, {}, 'load');
  assert.equal(explicitLoad.changes.find(c => c.field === 'seed').after, '123');
  assert.equal(explicitLoad.changes.find(c => c.field === 'batchCount').after, 2);
});

test('invalid anchors, incomplete originals, non-NAI invalid input and NAI Text errors reject only that branch', async () => {
  const f = fixture(), t = f.turn();
  await t.branch.stage(input());
  await assert.rejects(t.branch.stage({ ...input('无效分支'), steps: [{ kind: 'prompt_patch', target: 'image.prompt', mode: 'replace', anchor: 'missing', text: 'x' }] }), /锚点/);
  assert.equal(stagedCount(f.store.get(f.r.id).value), 1);
  assert.equal(t.branch.count, 1);
  await t.branch.stage(input('修正分支', 'fixed')); assert.equal(t.branch.count, 2);
  const p = picture(1); delete p.params.localCharacters;
  await assert.rejects(prepareStagedRecipe(input(), p, base(), [p], async () => null), /不完整/);
  const nonNai = { ...base(), models: [{ id: 'gpt-image-1.5', name: 'GPT', profileId: 'openai-images-v1' }] };
  nonNai.form.model = 'gpt-image-1.5';
  const gp = picture(1, 'source', { model: 'gpt-image-1.5' });
  await assert.rejects(prepareStagedRecipe({ ...input(), steps: [{ kind: 'params_patch', params: { width: -1 } }] }, gp, nonNai, [gp], async () => null));
  await assert.rejects(prepareStagedRecipe(input('坏文字', 'Text: "hi", city'), picture(1), base(), [picture(1)], d => checkNaiInput(d, { image: async () => ({ input_budget: { status: 'ready' } }) })), /Text:/);
});

test('same turn show plus stage commits once, successful branches survive later cancellation and stale races', async () => {
  const f = fixture(undefined, false), { reader, branch, controller } = f.turn();
  reader.present({ retrospect_title: 'fresh', nodes: [{ id: 'v1', label: '起点', image_ids: ['#h1'] }], edges: [] });
  assert.equal(f.store.records.value.length, 0);
  const first = await branch.stage(input());
  assert.equal(f.store.records.value.length, 1); assert.equal(first.value.nodes.length, 2); assert.ok(branch.committed.has(first.value));
  assert.equal(reader.prepared, undefined);
  const duplicate = await branch.stage(input()); assert.ok(duplicate.reused); assert.equal(branch.count, 1);
  await branch.stage(input('第二方向', 'rain'));
  controller.abort(); await assert.rejects(branch.stage(input('第三方向', 'sun')), /abort/i);
  assert.equal(stagedCount(f.store.records.value[0].value), 2);
  const stale = f.turn({ check: async () => { f.store.detachBoard('board-1'); return null; } });
  await assert.rejects(stale.branch.stage(input('过期方向', 'late')), /已变化/);
  assert.equal(stagedCount(f.store.records.value[0].value), 2);
});

test('B05: four successful plans per turn, sixteen pending per tree and eighty nodes total', async () => {
  const f = fixture();
  for (let round = 0; round < 4; round++) {
    const { branch } = f.turn();
    for (let i = 0; i < 4; i++) await branch.stage(input(`方向${round}${i}`, `route ${round}${i}`));
    await assert.rejects(branch.stage(input(`多余${round}`, 'overflow')), /4 个|16 个/);
  }
  assert.equal(stagedCount(f.store.get(f.r.id).value), 16);
  await assert.rejects(f.turn().branch.stage(input('第十七个')), /16/);
  const full = fixture(Array.from({ length: 79 }, (_, i) => picture(i + 1)));
  await full.turn().branch.stage(input());
  await assert.rejects(full.turn().branch.stage(input('总八十一', 'next')), /80/);
  assert.equal(full.store.get(full.r.id).value.nodes.length, 80);
});

test('exact base Diff, regroup preservation and base deletion protection', async () => {
  const f = fixture(); const t = f.turn();
  t.reader.present({ retrospect_id: f.r.id, expected_revision: 0, retrospect_title: 'mixed', nodes: [{ id: 'v1', label: '同阶段', image_ids: ['#h1','#h2'], primary_id: '#h2' }], edges: [] });
  await t.branch.stage(input());
  let current = f.store.get(f.r.id), staged = current.value.nodes.find(isStaged);
  assert.equal(selectRetrospectBaseline(current.value, staged, 'v1').cover, '#h1');
  assert.equal(versionCount(current.value), 1);
  f.store.annotate(f.r.id, [`node:${staged.id}`], 'keep');
  const regroup = f.turn();
  const next = regroup.reader.present({ retrospect_title: 'regroup', nodes: [{ id: 'v1', label: '拆开', image_ids: ['#h1'] }, { id: 'v4', label: '另组', image_ids: ['#h2'] }], edges: [] });
  assert.ok(next.nodes.some(n => n.id === staged.id && isStaged(n)));
  f.store.update(f.r.id, f.store.get(f.r.id).revision, next, f.refs, { ...owner, turnId: 10 });
  current = f.store.get(f.r.id); assert.equal(current.notes[`node:${staged.id}`], 'keep');
  assert.equal(current.value.edges.find(e => e.to === staged.id).from, 'v1');
  assert.throws(() => f.turn().reader.present({ retrospect_title: 'bad', nodes: [{ id: 'v4', label: '另组', image_ids: ['#h2'] }], edges: [] }), /不能移除/);
});

test('first image consumes staged node despite tweaks, batch stays there, late A cannot steal B cursor', async () => {
  const f = fixture(), t = f.turn();
  const a = (await t.branch.stage(input())).receipt.node_id, b = (await t.branch.stage(input('分支乙','B'))).receipt.node_id;
  f.store.arrange(f.r.id, { [a]: { x: 600, cy: 220, z: 3 }, [b]: { x: 600, cy: 700, z: 2 } });
  f.store.annotate(f.r.id, [`node:${a}`], 'preserve note');
  f.store.commitMove(f.store.prepareStagedMove(f.r.id, a));
  const frozen = f.store.begin('board-1');
  assert.throws(() => f.store.removeStaged(f.r.id, a), /正在生成/);
  f.store.commitMove(f.store.prepareStagedMove(f.r.id, b));
  for (const p of [picture(3, 'user tweaked'), picture(4, 'user tweaked', { seed: 42 })]) assert.equal(f.store.land(frozen, p, refsOf([p])), null);
  f.store.finish(frozen);
  let r = f.store.get(f.r.id), realized = r.value.nodes.find(n => n.id === a);
  assert.equal(isStaged(realized), false); assert.equal(realized.recipe.prompt, 'user tweaked'); assert.deepEqual(realized.image_ids, ['#h3','#h4']);
  assert.deepEqual(r.nodeLayout[a], { x: 600, cy: 220, z: 3 }); assert.equal(r.notes[`node:${a}`], 'preserve note');
  assert.equal(r.cursor.nodeId, b); assert.equal(r.cursor.kind, 'staged');
  const same = picture(5, 'base 1'), batch = f.store.begin('board-1'); f.store.land(batch, same, refsOf([same])); f.store.finish(batch);
  r = f.store.get(f.r.id); assert.equal(r.cursor.nodeId, b); assert.equal(r.value.nodes.find(n => n.id === b).cover, '#h5');
  assert.equal(r.value.edges.find(e => e.to === b).from, 'v1');
  f.store.commitMove(f.store.prepareNext('board-1', 'ask'));
  const later = picture(6, 'changed again'); f.store.land(f.store.begin('board-1'), later, refsOf([later]));
  assert.equal(f.store.get(f.r.id).value.edges.at(-1).from, b);
});

test('pending deletion returns cursor to base without board write; failed generation releases deletion guard; old epochs cannot land', async () => {
  const f = fixture(), a = (await f.turn().branch.stage(input())).receipt.node_id;
  f.store.commitMove(f.store.prepareStagedMove(f.r.id, a)); const frozen = f.store.begin('board-1');
  assert.deepEqual([...f.store.generatingNodes(f.r.id)], [a]);
  f.store.finish(frozen);
  assert.equal(f.store.generatingNodes(f.r.id).size, 0);
  f.store.removeStaged(f.r.id, a);
  assert.equal(f.store.get(f.r.id).cursor.imageId, '#h1'); assert.equal(stagedCount(f.store.get(f.r.id).value), 0);
  const b = (await f.turn().branch.stage(input('再试方向'))).receipt.node_id;
  f.store.commitMove(f.store.prepareStagedMove(f.r.id,b)); const late = f.store.begin('board-1');
  f.store.detachBoard('board-1'); f.store.setStatus(f.r.id,'active');
  f.store.land(late, picture(3), refsOf([picture(3)])); f.store.finish(late);
  assert.equal(isStaged(f.store.get(f.r.id).value.nodes.find(n => n.id === b)), true);
  assert.throws(() => f.store.finalize(f.r.id,b,'',f.store.get(f.r.id).revision), /已变化/);
});

test('panel load shares atomic writer/50-step stack; undo/redo never resurrects a consumed preset', async () => {
  const f = fixture(), id = (await f.turn().branch.stage(input())).receipt.node_id;
  const staged = f.store.get(f.r.id).value.nodes.find(n => n.id === id).staged;
  let currentForm = structuredClone(base().form), fail = false, cursorFail = false;
  const drawing = { retainHistory() {}, snapshot: () => ({ form: currentForm, boards: [{ id: 'board-1', form: currentForm }] }), writeDraft: async changes => { if (fail) throw new Error('write failed'); currentForm = { ...currentForm, ...changes }; } };
  const writer = createDraftWriter(drawing, { snapshot: () => ({ current: { id: 'chat' }, conversations: [] }), retainHandoffDrafts() {} }, { route: { value: { workspace: 'image' } }, switchWorkspace() {} }, undefined, undefined, undefined,
    { moveIssue: f.store.moveIssue, commitMove: (...args) => { if (cursorFail) throw new Error('cursor failed'); f.store.commitMove(...args); }, stagedAvailable: () => true, available: () => true });
  const plan = stagedLoadPlan(staged, base(), f.store.prepareStagedMove(f.r.id,id), 'load');
  fail = true; await assert.rejects(writer.apply(plan), /write failed/); fail = false;
  assert.equal(f.store.get(f.r.id).cursor.nodeId, 'v2');
  cursorFail = true; await assert.rejects(writer.apply(plan), /cursor failed/); cursorFail = false;
  assert.equal(currentForm.prompt, 'CURRENT FORM'); assert.equal(f.store.get(f.r.id).cursor.nodeId, 'v2');
  const stack = createDraftStack(writer), draft = { title: 'load', base: base(), steps: [] }, entry = stack.create(draft, '', 0, { kind:'evolution', retrospectId:f.r.id, nodeId:id });
  await stack.apply(entry, plan); assert.equal(currentForm.prompt, 'next direction'); assert.equal(f.store.get(f.r.id).cursor.kind, 'staged');
  await stack.undo(entry.id); assert.equal(currentForm.prompt,'CURRENT FORM'); assert.equal(f.store.get(f.r.id).cursor.nodeId,'v2');
  await stack.restore(entry.id);
  const binding = f.store.begin('board-1'), p = picture(3, 'next direction'); f.store.land(binding,p,refsOf([p])); f.store.finish(binding);
  await stack.undo(entry.id); await stack.restore(entry.id);
  assert.equal(f.store.get(f.r.id).cursor.nodeId, id); assert.equal(f.store.get(f.r.id).cursor.kind, undefined); assert.equal(f.store.get(f.r.id).cursor.imageId,'#h3');
  currentForm.negative = 'manual change'; await assert.rejects(stack.undo(entry.id), /Negative/);
});


test('sequential staged loads undo in global order, preserve explicit runtime overrides and reject unavailable resources', async () => {
  const f = fixture(), t = f.turn(), a = (await t.branch.stage(input())).receipt.node_id, b = (await t.branch.stage(input('另一方向','B'))).receipt.node_id;
  let form = base().form, available = true;
  const drawing = { retainHistory() {}, snapshot: () => ({ form, boards: [{ id: 'board-1', form }] }), writeDraft: async fields => { form = {...form,...fields}; } };
  const writer = createDraftWriter(drawing, { snapshot: () => ({ current: { id: 'chat' }, conversations: [] }), retainHandoffDrafts() {} }, { route: { value: { workspace:'image' } }, switchWorkspace() {} }, undefined, undefined, undefined,
    { moveIssue:f.store.moveIssue, commitMove:f.store.commitMove, stagedAvailable:()=>available, available:()=>true });
  const stack = createDraftStack(writer), entries=[];
  for (const id of [a,b]) {
    const node=f.store.get(f.r.id).value.nodes.find(n=>n.id===id), state={...base(),form}, plan=stagedLoadPlan(node.staged,state,f.store.prepareStagedMove(f.r.id,id),id);
    const entry=stack.create({title:id,base:state,steps:[]},'',0,{kind:'evolution',retrospectId:f.r.id,nodeId:id});await stack.apply(entry,plan);entries.push(entry);
  }
  assert.equal(f.store.get(f.r.id).cursor.nodeId,b);
  assert.throws(()=>stack.preflight([entries[0].id]),/较新的/);
  assert.deepEqual(stack.preflight(entries.map(e=>e.id)),entries.map(e=>e.id).reverse());
  await stack.undo(entries[1].id);assert.equal(f.store.get(f.r.id).cursor.nodeId,a);assert.equal(form.prompt,'next direction');
  await stack.undo(entries[0].id);assert.equal(f.store.get(f.r.id).cursor.nodeId,'v2');assert.equal(form.prompt,'CURRENT FORM');
  available=false;await assert.rejects(stack.restore(entries[0].id),/来源已变化/);assert.equal(form.prompt,'CURRENT FORM');
});

test('staged NAI budget warnings retain complete text; readonly restored cards cannot mutate plans',async()=>{
 const f=fixture(), large='detail, '.repeat(400);
 const checked=await prepareStagedRecipe(input('长词方案',large),picture(1),base(),[picture(1)],d=>checkNaiInput(d,{image:async()=>({input_budget:{status:'ready',positive:{used:600,limit:512,overflow:88}},diagnostics:[{severity:'warning',code:'token_overflow',message:'超量提示'}]})}));
 assert.equal(checked.target.prompt,large);assert.equal(checked.checked.ok,true);assert.deepEqual(checked.checked.warnings,['超量提示']);
 await f.turn().branch.stage(input());
 const restored=createRetrospects(),r=restored.register(JSON.parse(JSON.stringify(f.store.get(f.r.id).value)),f.refs,{...owner,boardId:null},'ended');
 assert.throws(()=>restored.prepareStagedMove(r.id,'v3'),/失效/);
 assert.throws(()=>restored.removeStaged(r.id,'v3'),/仅供查看/);
});
