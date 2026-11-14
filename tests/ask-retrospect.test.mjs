import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/domain/drawing.ts';
import { recipeClusters, recipeOf } from '../src/ask/retrospect/recipe.ts';
import { readRetrospect, selectRetrospectSample, selectRetrospectBaseline, remapSampleBases } from '../src/ask/retrospect/model.ts';
import { createRecipeReader } from '../src/ask/retrospect/tools.ts';
import { recipeDiff, textDiff } from '../src/ask/retrospect/diff.ts';
import { textHunks } from '../src/ask/retrospect/text-diff.ts';
import { prepareRecipe } from '../src/ask/retrospect/restore.ts';
import { groupsOf } from '../src/ask/retrospect/groups.ts';

const params = (prompt = 'ocean', extra = {}) => ({ ...structuredClone(DEFAULTS), basePrompt: prompt, baseNegative: 'lowres', prompt: `${prompt}, compiled quality`, negative_prompt: 'lowres, compiled negative', localCharacters: [], boardId: 'board-1', ...extra });
const picture = (n, prompt = 'ocean', extra = {}, source = 'history') => ({ id: `r${n}`, createdAt: n, label: `#${source === 'history' ? 'h' : 'f'}${n}`, aliases: [`#${source === 'history' ? 'h' : 'f'}${n}`], origins: [{ source, order: n }], params: params(prompt, extra), blob: new Blob(), size: { width: 832, height: 1216 } });
const node = (id, ...image_ids) => ({ id, label: id, image_ids });

test('retrospect groups only consecutive raw recipes, ignores allocation/roll IDs, excludes composites and unrelated favorites', () => {
  const role = id => ({ id, on: true, prompt: 'red hair', negative: '', centers: [{ x: .3, y: .4 }] });
  const a = picture(1, 'A', { localCharacters: [role('c1')], seed: 0 });
  a.aliases.push('#f1'); a.origins.push({ source: 'favorites', order: 1 });
  const b = picture(2, 'A', { localCharacters: [role('c77')], seed: 99, batchCount: 20, batchIndex: 2 });
  const list = [picture(8, 'ignored', {}, 'favorites'), picture(7, 'edit', { tool: 'inpaint' }), picture(6, 'collage', { isComparison: true }), picture(5, 'known', {}, 'favorites'), picture(4, 'A', { localCharacters: [role('c4')] }), picture(3, 'B'), b, a, a];
  const before = structuredClone(list.map(p => p.params));
  const groups = recipeClusters(list, new Set(['r5']));
  assert.deepEqual(groups.map(g => g.images.map(p => p.id)), [['r1', 'r2'], ['r3'], ['r4'], ['r5']]);
  assert.equal(groups[0].cover, '#h1');
  assert.equal(groups[0].recipe.prompt, 'A');
  assert.equal(groups[0].recipe.characters[0].id, undefined);
  assert.deepEqual(list.map(p => p.params), before, 'read view cannot mutate source metadata');
  const changed = recipeClusters([a, picture(2, 'A', { localCharacters: [role('c2')], width: 1024 })], new Set());
  assert.equal(changed.length, 2);
});

test('retrospect unknown originals remain unknown and do not collapse into a fabricated recipe', () => {
  const items = [picture(1), picture(2)];
  for (const p of items) { delete p.params.basePrompt; delete p.params.localCharacters; }
  const groups = recipeClusters(items, new Set());
  assert.equal(groups.length, 2);
  assert.equal(groups[0].recipe.prompt, null);
  assert.equal(groups[0].recipe.characters, null);
  assert.equal(JSON.stringify(groups[0].recipe).includes('compiled quality'), false);
});

test('retrospect reader returns all related evidence once, stays lazy and respects board scope', () => {
  let reads = 0;
  const reader = createRecipeReader(() => { reads++; return recipeClusters(Array.from({ length: 25 }, (_, i) => picture(i + 1, `p${i}`, { boardId: i > 20 ? 'board-2' : 'board-1' })), new Set()); }, 'board-1');
  assert.equal(reads, 0);
  const first = reader.read({});
  assert.equal(first.total, 21); assert.equal(first.clusters.length, 21);
  assert.deepEqual(first.evolution.map(r => r.id), Array.from({ length: 21 }, (_, i) => `#h${i + 1}`));
  assert.equal(first.evolution[0].previous_id, null);
  assert.equal(first.evolution[1].previous_id, '#h1');
  assert.throws(() => reader.present({ retrospect_title: 'x', nodes: [node('v1', '#h25')], edges: [] }), /已读取/);
  const detail = reader.read({ cluster_id: 'g1' });
  assert.equal(detail.clusters[0].recipe.prompt, 'p0'); assert.equal(detail.evolution[0].seed, '');
  assert.equal(reader.present({ retrospect_title: 'x', nodes: [node('v1', '#h1')], edges: [] }).nodes.length, 1);
  const all = reader.read({ scope: 'all' });
  assert.equal(all.total, 25); assert.equal(reads, 1);
  assert.equal(all.evolution[21].previous_id, null, 'chronology must not imply a cross-board parent');
});

test('retrospect graph accepts mixed-recipe stages with exact per-sample facts, rejects forged identities and cycles', () => {
  const one = picture(1, 'A'); one.aliases.push('#f1');
  const groups = recipeClusters([one, picture(2, 'B'), picture(3, 'C'), picture(4, 'A')], new Set());
  const graph = { retrospect_title: '试错', nodes: [node('v1', '#h1', '#h4'), { ...node('v2', '#h2'), label: '画板定型', description: '高低景深错位对峙，以 #h2 为代表。' }, node('v3', '#h3')], edges: [{ from: 'v1', to: 'v2', summary: '换灯光' }, { from: 'v1', to: 'v3', summary: '换机位' }] };
  const result = readRetrospect(graph, groups);
  assert.deepEqual(result.edges.map(e => [e.from, e.to]), [['v1', 'v2'], ['v1', 'v3']]);
  assert.equal(result.nodes[0].image_ids.length, 2);
  assert.equal(result.nodes[1].label, '画板定型');
  assert.equal(selectRetrospectSample(result.nodes[1], '#h2').description, graph.nodes[1].description);
  assert.equal(result.nodes[0].description, undefined, 'a short title does not require filler description');
  const stage = readRetrospect({ retrospect_title: 'stage', nodes: [node('v1', '#h1', '#h2')], edges: [] }, groups).nodes[0];
  assert.equal(stage.cover, '#h2'); assert.equal(stage.recipe.prompt, 'B');
  assert.equal(selectRetrospectSample(stage, '#h1').recipe.prompt, 'A');
  assert.equal(selectRetrospectSample(stage, '#h2').recipe.prompt, 'B');
  assert.throws(() => selectRetrospectSample(stage, '#h3'), /不属于/);
  const { recipes, ...legacy } = result.nodes[0];
  assert.equal(selectRetrospectSample(legacy, '#h1').recipe.prompt, 'A', 'older equal-recipe cards remain readable');
  for (const invalid of [
    { ...graph, nodes: [node('v1', '#h1', '#f1')] },
    { ...graph, nodes: [node('v1', '#h99')] },
    { ...graph, edges: [...graph.edges, { from: 'v2', to: 'v1', summary: 'cycle' }] },
    { ...graph, edges: [...graph.edges, { from: 'v2', to: 'v3', summary: 'two parents' }] },
    { ...graph, nodes: [{ ...graph.nodes[0], recipe: {} }] },
  ]) assert.throws(() => readRetrospect(invalid, groups));
});

test('retrospect context includes every sample and complete adjacent text, role and effective parameter changes', () => {
  const long = 'full original '.repeat(100), role = (prompt, extra = {}) => ({ id: 'c1', on: true, prompt, negative: '', centers: [], ...extra });
  const images = Array.from({ length: 24 }, (_, i) => picture(i + 1, long, { seed: i }));
  images.push(picture(25, `${long}rim light`, { steps: 30, cfg: true, noiseSchedule: 'auto', noise_schedule: 'exponential',
    localCharacters: [role('   '), role('ignored', { on: false }), role('silver hair', { negative: 'hat' })] }));
  const read = createRecipeReader(() => recipeClusters(images, new Set()), 'board-1').read({});
  assert.equal(read.clusters[0].image_ids.length, 24, 'no 20-sample truncation');
  assert.equal(read.clusters[0].recipe.prompt, long, 'no short prompt truncation');
  assert.equal(read.evolution.length, 25);
  assert.deepEqual(read.evolution[1].diff.parameters, []); assert.deepEqual(read.evolution[1].diff.texts, []);
  const last = read.evolution.at(-1), prompt = last.diff.texts.find(t => t.key === 'prompt');
  assert.equal(last.previous_id, '#h24');
  assert.equal(prompt.parts.filter(p => p.kind !== 'ins').map(p => p.text).join(''), long);
  assert.equal(prompt.parts.filter(p => p.kind !== 'del').map(p => p.text).join(''), `${long}rim light`);
  assert.deepEqual(last.diff.parameters.map(p => p.key).sort(), ['c0:centers', 'c0:on', 'noiseSchedule', 'steps']);
  assert.equal(last.effective_params.noiseSchedule, 'exponential');
  assert.equal(last.diff.texts.find(t => t.key === 'c0:prompt').parts[0].text, 'silver hair');
  assert.doesNotMatch(JSON.stringify(last), /ignored|compiled|sent_prompt/);
});

test('Diff ignores disabled and whitespace-only role slots without altering raw snapshots', () => {
  const role = (prompt, extra = {}) => ({ id: 'c1', on: true, prompt, negative: '', centers: [], ...extra });
  const raw = recipeOf(params('base', { localCharacters: [role('ignored', { on: false }), role(' \n', { negative: '\t' }), role('black hair'), role('', { negative: 'hat' })] }));
  const compact = recipeOf(params('base', { localCharacters: [role('black hair'), role('', { negative: 'hat' })] }));
  const snapshot = structuredClone(raw), diff = recipeDiff(raw, compact);
  assert.equal(diff.texts.some(t => t.changed), false); assert.deepEqual(diff.parameters, []);
  const groups = groupsOf({ recipe: raw }, { recipe: compact });
  assert.deepEqual(groups.map(g => g.id), ['base', 'c0', 'c1', 'params']);
  assert.equal(groups.some(g => g.changed), false);
  assert.equal(diff.texts.find(t => t.key === 'c1:negative').after, 'hat', 'negative-only roles remain effective');
  assert.deepEqual(raw, snapshot, 'comparison cannot delete the original role slots');
  assert.deepEqual(groupsOf({ recipe: recipeOf(params('base', { localCharacters: [role('')] })) }, { recipe: recipeOf(params('base')) }).map(g => g.id), ['base', 'params']);
});

test('role review distinguishes known additions from unknown recipes and keeps exact position values', () => {
  const role = (y, prompt = 'sitting') => ({ id: 'c1', on: true, prompt, negative: '', centers: [{ x: .7, y }] });
  const a = { recipe: recipeOf(params('base', { localCharacters: [role(.6)] })) };
  const b = { recipe: recipeOf(params('base', { localCharacters: [role(.65001, 'sitting, leaning back')] })) };
  const changed = groupsOf(a, b).find(g => g.id === 'c0');
  assert.deepEqual(changed.position, { before: [{ x: .7, y: .6 }], after: [{ x: .7, y: .65001 }], changed: true });
  assert.deepEqual(changed.parameters, [], 'enabled role flags and raw centers are not repeated as generic parameters');
  const absent = { recipe: recipeOf(params('base')) };
  const added = groupsOf(absent, b).find(g => g.id === 'c0');
  assert.equal(added.state, '新增'); assert.equal(added.texts[0].before, '');
  assert.equal(added.texts[1].changed, false, 'empty negatives are not invented changes');
  assert.deepEqual(added.position.before, []);
  const removed = groupsOf(b, absent).find(g => g.id === 'c0');
  assert.equal(removed.state, '删除'); assert.equal(removed.texts[0].after, '');
  assert.deepEqual(removed.position.after, []);
  const unknown = groupsOf({ recipe: { ...absent.recipe, characters: null } }, b).find(g => g.id === 'c0');
  assert.equal(unknown.state, ''); assert.equal(unknown.texts[0].before, null); assert.equal(unknown.position.before, null);
});

test('retrospect exact Diff preserves weights, case, whitespace, duplicates and order without sent fields', () => {
  for (const [a, b] of [['A, A, {cat}, rain', 'rain, A, 1.5::cat::'], ['Cat_ears,  a\nB', 'cat ears,a\n B'], ['x '.repeat(900), 'y '.repeat(900)], ['', 'x']]) {
    const diff = textDiff(a, b);
    assert.equal(diff.filter(p => p.kind !== 'ins').map(p => p.text).join(''), a);
    assert.equal(diff.filter(p => p.kind !== 'del').map(p => p.text).join(''), b);
  }
  const a = recipeOf(params('A', { width: 832, steps: 25 })), b = recipeOf(params('B', { width: 1024, steps: 28 }));
  const d = recipeDiff(a, b);
  assert.deepEqual(d.parameters.map(p => [p.key, p.before, p.after]).sort(), [['size', '832×1216', '1024×1216'], ['steps', '25', '28']]);
  assert.doesNotMatch(JSON.stringify(d), /compiled|sent_prompt/);
});

test('long Diff budgets only the changed middle and keeps shared text in UI and ASK evidence', () => {
  const prefix = '<artist> 1.35::artist:example::, </artist>, '.repeat(150), suffix = ', unchanged poster title';
  const before = `${prefix}standing, warm light${suffix}`, after = `${prefix}sitting, cool light${suffix}`;
  const parts = textDiff(before, after);
  assert.equal(parts.filter(p => p.kind === 'del').map(p => p.text).join(''), 'standingwarm');
  assert.equal(parts.filter(p => p.kind === 'ins').map(p => p.text).join(''), 'sittingcool');
  assert.equal(parts.filter(p => p.kind !== 'ins').map(p => p.text).join(''), before);
  assert.equal(parts.filter(p => p.kind !== 'del').map(p => p.text).join(''), after);
  assert.doesNotMatch(JSON.stringify(textHunks(before, after)), /artist|poster title/);
  const reader = createRecipeReader(() => recipeClusters([picture(1, before), picture(2, after)], new Set()), 'board-1');
  assert.deepEqual(reader.read({}).evolution[1].diff.texts.find(t => t.key === 'prompt').parts, parts);
  const bounded = textDiff(prefix + 'x '.repeat(900) + suffix, prefix + 'y '.repeat(900) + suffix);
  assert.equal(bounded[0].kind, 'same'); assert.equal(bounded.at(-1).kind, 'same');
  assert.doesNotMatch(bounded.filter(p => p.kind !== 'same').map(p => p.text).join(''), /artist|poster title/, 'fallback is limited to the unmatched middle');
});

test('compact hunks keep complete weighted context, exact local highlights, insertions and Unicode', () => {
  for (const [before, after] of [
    ['1.3::blue eyes::', '1.5::blue eyes::'],
    ['1.3::blue eyes, 0.8::silver hair::::', '1.5::blue eyes, 0.8::silver hair::::'],
    ['{blue eyes, silver hair}', '{green eyes, silver hair}'],
  ]) {
    const hunks = textHunks(`unchanged, ${before}, red dress`, `unchanged, ${after}, red dress`);
    assert.equal(hunks.length, 1); assert.equal(hunks[0].before, before); assert.equal(hunks[0].after, after);
    assert.doesNotMatch(JSON.stringify(hunks), /red dress|unchanged/);
  }
  assert.deepEqual(textHunks('soft light', 'soft light, low angle').map(h => [h.before, h.after]), [['', ', low angle']]);
  const before = '柔和的月光从左侧窗户照向站立的女孩。𠮷\u{E0100} 👩🏽‍🎨', after = before.replace('左', '右');
  for (const parts of [textDiff(before, after), textHunks(before, after)[0].parts]) {
    assert.deepEqual(parts.filter(p => p.kind !== 'same'), [{ kind: 'del', text: '左' }, { kind: 'ins', text: '右' }]);
  }
  assert.deepEqual(textHunks('1.3::blue eyes::', '1.5::blue eyes::')[0].parts.filter(p => p.kind !== 'same'), [{ kind: 'del', text: '1.3' }, { kind: 'ins', text: '1.5' }]);
});

test('parameter comparisons retain raw differences when formatted values look identical', () => {
  const before = recipeOf(params('base', { scale: 5, width: 832 })), after = { ...before, params: { ...before.params, scale: '5', width: '832' } };
  const diff = recipeDiff(before, after), groups = groupsOf({ recipe: before }, { recipe: after });
  assert.deepEqual(diff.parameters.map(p => p.key).sort(), ['scale', 'size']);
  for (const p of diff.parameters) {
    assert.equal(p.changed, true); assert.notEqual(p.before, p.after);
    assert.deepEqual(groups.find(g => g.id === 'params').parameters.find(item => item.key === p.key), p);
  }
  assert.equal(diff.parameters.find(p => p.key === 'scale').after, '"5"');
  assert.equal(groups.find(g => g.id === 'params').parameters.find(p => p.key === 'steps').changed, false);
  const missing = recipeDiff({ ...before, params: {} }, { ...before, params: { scale: null } }).parameters[0];
  assert.deepEqual([missing.before, missing.after, missing.changed], ['未记录', 'null', true]);
});

test('recipe preparation keeps seed/batch and validates complete supported fields', () => {
  const form = { ...structuredClone(DEFAULTS), prompt: 'current', seed: '123', batchCount: 8 };
  const state = { form, nextCharacterId: 10, models: [{ id: DEFAULTS.model, name: 'NAI V5', profileId: 'koma-standard-v1' }], samplersFor: () => [DEFAULTS.sampler] };
  const recipe = recipeOf(params('restore', { localCharacters: [{ id: 'c1', on: true, prompt: 'hair', negative: '', centers: [] }] }));
  const prepared = prepareRecipe(recipe, state).form;
  assert.equal(prepared.prompt, 'restore'); assert.equal(prepared.seed, '123'); assert.equal(prepared.batchCount, 8); assert.equal(prepared.characters[0].id, 'c10');
  assert.equal(form.prompt, 'current');
  assert.throws(() => prepareRecipe({ ...recipe, prompt: null }, state), /不完整/);
  assert.throws(() => prepareRecipe({ ...recipe, params: { ...recipe.params, sampler: 'invalid' } }, state), /不支持/);
});

test('review notes preserve unrelated comments, validate targets, and append mixed selections atomically', async () => {
  const { editNotes } = await import('../src/ask/retrospect/annotations.ts');
  const graph = { title: 'review', nodes: [{ id: 'v1' }, { id: 'v2' }], edges: [{ from: 'v1', to: 'v2' }] };
  const original = { 'node:v1': 'keep light', 'node:v2': 'change pose', 'edge:v1:v2': 'too dark' };
  const next = editNotes(graph, original, ['node:v1', 'node:v2'], 'preserve detail');
  assert.equal(next['node:v1'], 'keep light\npreserve detail');
  assert.equal(next['node:v2'], 'change pose\npreserve detail');
  assert.equal(next['edge:v1:v2'], 'too dark');
  assert.throws(() => editNotes(graph, original, ['node:v1', 'node:v2'], null), /单独选择/);
  assert.throws(() => editNotes(graph, original, ['edge:v2:v1'], 'bad'), /失效/);
  assert.throws(() => editNotes(graph, { ...original, 'node:v2': 'x'.repeat(1999) }, ['node:v1', 'node:v2'], 'more'), /超过/);
  assert.deepEqual(editNotes(graph, original, ['node:v1'], null), { 'node:v2': 'change pose', 'edge:v1:v2': 'too dark' });
  assert.equal(original['node:v1'], 'keep light');
});

test('review lifecycle keeps provenance and comments across reopen, and rejects stale status changes', async () => {
  const { createRetrospects } = await import('../src/ask/retrospect/store.ts');
  const store = createRetrospects();
  const graph = { title: 'review', nodes: [{ id: 'v1', image_ids: ['#h1'], cover: '#h1', recipe: recipeOf(params()) }], edges: [] };
  const owner = { conversationId: 'ask-1', turnId: 3, boardId: 'board-1', boardName: 'first' };
  const r = store.register(graph, refsOf([picture(1)]), owner);
  store.commitMove(store.prepareNext('board-1', 'ask'));
  store.annotate(r.id, ['node:v1'], 'keep light');
  const beforeLayout = store.get(r.id);
  store.arrange(r.id, { v1: { x: -80, cy: 200, z: 1 }, v2: { x: 400, cy: 200, z: 0 } });
  assert.equal(store.get(r.id).revision, beforeLayout.revision, 'view arrangement never invalidates an ASK draft');
  assert.deepEqual(store.get(r.id).cursor, beforeLayout.cursor);
  assert.equal(store.get(r.id).value, beforeLayout.value);
  store.arrangeContinuation(r.id, { nodeId: 'v1', x: 450, cy: 300, z: 2 });
  const camera = { x: -120, y: 90, scale: .8, fitted: .6, overview: false };
  store.rememberCamera(r.id, camera);
  assert.equal(store.get(r.id).revision, beforeLayout.revision, 'moving the empty frame is also view-only');
  assert.deepEqual(store.get(r.id).nodeLayout, { v1: { x: -80, cy: 200, z: 1 } });
  store.open(r.id, 'v1'); store.close(); store.open(r.id);
  assert.deepEqual(store.get(r.id).nodeLayout, { v1: { x: -80, cy: 200, z: 1 } }, 'only real nodes retain page-owned positions across reopen');
  assert.deepEqual(store.get(r.id).continuationAnchor, { nodeId: 'v1', x: 450, cy: 300, z: 2 });
  assert.deepEqual(store.get(r.id).graphCamera, camera, 'the same page retains its canvas pan and zoom');
  assert.equal(store.get(r.id).notes['node:v1'], 'keep light');
  store.setStatus(r.id, 'ended');
  assert.equal(store.activeForBoard('board-1'), null);
  assert.equal(store.register(graph, {}, { ...owner, boardId: 'board-2' }).boardId, 'board-1');
  assert.equal(store.setStatus(r.id, 'active', r.revision), false, 'a stale ASK result cannot undo a later manual action');
  assert.throws(() => store.annotate(r.id, ['node:v1'], 'changed'), /继续演进/);
  store.setStatus(r.id, 'active');
  assert.equal(store.get(r.id).notes['node:v1'], 'keep light');
  store.dispose(); assert.equal(store.records.value.length, 0);
});

test('effective fingerprint filters dormant roles while explicit primary selects exact mixed-stage recipe', () => {
  const role = (prompt, on = true) => ({ id: 'c1', on, prompt, negative: '', centers: [] });
  const items = [picture(1, 'A'), picture(2, 'A', { cfg: true, localCharacters: [role(' '), role('hidden', false)] }), picture(3, 'B')];
  const groups = recipeClusters(items, new Set());
  assert.deepEqual(groups.map(g => g.images.length), [2, 1]);
  const result = readRetrospect({ retrospect_title: 'stage', nodes: [{ ...node('v1', '#h1', '#h3'), primary_id: '#h1' }], edges: [] }, groups);
  assert.equal(result.nodes[0].cover, '#h1');
  assert.equal(selectRetrospectSample(result.nodes[0], '#h3').recipe.prompt, 'B');
  assert.throws(() => readRetrospect({ retrospect_title: 'stage', nodes: [{ ...node('v1', '#h1'), primary_id: '#h3' }], edges: [] }, groups), /代表图/);
});

const refsOf = pictures => Object.fromEntries(pictures.map(p => [p.label, { tag: p.label, record_id: p.id, entity_key: '', scope: { kind: 'page', id: 'page' } }]));
async function activeTree(pictures = [picture(1, 'A'), picture(2, 'B')]) {
  const { createRetrospects } = await import('../src/ask/retrospect/store.ts');
  const store = createRetrospects();
  const graph = readRetrospect({ retrospect_title: 'tree', nodes: pictures.map((p, i) => node(`v${i + 1}`, p.label)), edges: pictures.slice(1).map((_, i) => ({ from: `v${i + 1}`, to: `v${i + 2}`, summary: 'change' })) }, recipeClusters(pictures, new Set()));
  const r = store.register(graph, refsOf(pictures), { conversationId: 'ask', turnId: 1, boardId: 'board-1', boardName: 'board' }, 'active', pictures);
  return { store, r };
}

test('live tree folds rolls, creates one stage per batch, and branches from a restored concrete sample', async () => {
  const { store, r } = await activeTree();
  const layout = { v1: { x: -80, cy: 200, z: 1 }, v2: { x: 350, cy: 250, z: 2 } };
  const slot = { nodeId: 'v2', x: 780, cy: 410, z: 3 };
  store.arrange(r.id, layout);
  const roll = store.begin('board-1'), p3 = picture(3, 'B');
  store.land(roll, p3, refsOf([p3]));
  assert.deepEqual(store.get(r.id).value.nodes[1].image_ids, ['#h2', '#h3']);
  assert.equal(store.pending(r.id), null, 'manual changes do not reserve a new node');
  store.commitMove(store.prepareNext('board-1', 'ask')); store.arrangeContinuation(r.id, slot);
  const next = store.begin('board-1');
  for (const p of [picture(4, 'C'), picture(5, 'C')]) store.land(next, p, refsOf([p]));
  assert.equal(store.get(r.id).value.nodes.length, 3);
  assert.deepEqual(store.get(r.id).value.nodes[2].image_ids, ['#h4', '#h5']);
  assert.deepEqual(store.get(r.id).nodeLayout, { ...layout, v3: { x: slot.x, cy: slot.cy, z: slot.z } }, 'the whole new batch occupies the reserved node without resetting the old scene');
  const move = store.prepareNext('board-1', 'ask', store.prepareMove('board-1', 'r1')); store.commitMove(move);
  const branch = store.begin('board-1'), p6 = picture(6, 'D'); store.land(branch, p6, refsOf([p6]));
  assert.deepEqual(store.get(r.id).value.edges.map(e => [e.from, e.to]), [['v1','v2'], ['v2','v3'], ['v1','v4']]);
  assert.equal(store.get(r.id).cursor.nodeId, 'v4');
  store.commitMove(move, true);
  assert.equal(store.get(r.id).cursor.nodeId, 'v3');
  assert.equal(store.get(r.id).value.nodes.length, 4, 'undoing a draft never erases generated attempts');
});

test('in-flight batches preserve submit origin without stealing an explicit rollback or reattaching after detach', async () => {
  const { store, r } = await activeTree(); store.commitMove(store.prepareNext('board-1', 'ask')); const old = store.begin('board-1');
  store.commitMove(store.prepareMove('board-1', 'r1'));
  const late = picture(3, 'C'); store.land(old, late, refsOf([late]));
  assert.equal(store.get(r.id).cursor.nodeId, 'v1');
  assert.equal(store.get(r.id).value.edges.at(-1).from, 'v2');
  const stopped = store.begin('board-1'); store.detachBoard('board-1'); store.setStatus(r.id, 'active');
  const p4 = picture(4, 'D'); store.land(stopped, p4, refsOf([p4]));
  assert.equal(store.get(r.id).value.nodes.length, 3);
  store.removeSource('ask'); assert.equal(store.get(r.id).status, 'active', 'message deletion cannot delete the live tree');
});

test('branch comparison retains the real base sample across rolls, reorganization, aliases and saved cards', async () => {
  const { createRetrospects } = await import('../src/ask/retrospect/store.ts');
  const store = createRetrospects(), pics = [picture(1, 'blue dress'), picture(2, 'red dress')];
  const graph = readRetrospect({ retrospect_title: 'mixed', nodes: [node('v1', '#h1', '#h2')], edges: [] }, recipeClusters(pics, new Set()));
  const owner = { conversationId: 'ask', turnId: 1, boardId: 'board-1', boardName: 'board' };
  const r = store.register(graph, refsOf(pics), owner);
  assert.equal(r.value.nodes[0].cover, '#h2');
  store.commitMove(store.prepareNext('board-1', 'ask', store.prepareMove('board-1', 'r1')));
  const p3 = picture(3, 'blue dress, rim light'); store.land(store.begin('board-1'), p3, refsOf([p3]));
  const p4 = picture(4, 'blue dress, rim light', { seed: 42 }); store.land(store.begin('board-1'), p4, refsOf([p4]));
  store.open(r.id); store.close(); store.open(r.id);
  let current = store.get(r.id), child = selectRetrospectSample(current.value.nodes[1], '#h4');
  assert.deepEqual(current.value.sampleBases, { '#h3': '#h1', '#h4': '#h3' });
  assert.equal(selectRetrospectBaseline(current.value, child, 'v1').cover, '#h1');
  assert.equal(selectRetrospectBaseline(current.value, child, 'v1', '#h2').recipe.prompt, 'red dress', 'explicit sample browsing wins');
  const reader = createRecipeReader(() => [], 'board-1', [structuredClone(current)]);
  reader.read({ retrospect_id: r.id });
  const payload = { retrospect_title: 'renamed', nodes: current.value.nodes.map(n => node(n.id, ...n.image_ids)), edges: current.value.edges };
  const revised = reader.present(payload);
  assert.deepEqual(revised.sampleBases, current.value.sampleBases, 'ASK cannot accidentally erase facts by only returning its schema');
  assert.throws(() => reader.present({ ...payload, sampleBases: { '#h3': '#h2' } }), /sampleBases/);
  store.update(r.id, current.revision, revised, {}, { ...owner, turnId: 2 });
  const saved = JSON.parse(JSON.stringify(revised));
  assert.equal(selectRetrospectBaseline(saved, selectRetrospectSample(saved.nodes[1], '#h4'), 'v1').cover, '#h1');
  const regroup = createRecipeReader(() => [], 'board-1', [structuredClone(store.get(r.id))]);
  regroup.read({ retrospect_id: r.id });
  const regrouped = regroup.present({ retrospect_title: 'regrouped', nodes: [node('v1', '#h1', '#h2', '#h3'), node('v2', '#h4')], edges: revised.edges });
  assert.equal(selectRetrospectBaseline(regrouped, regrouped.nodes[1], 'v1').cover, '#h3', 'regrouping resolves the real source inside the newly assigned parent stage');
  // Renaming a historical alias and merging a generated stage preserve facts by stable record ID.
  current = store.get(r.id);
  const aliased = [ { ...current.value.nodes[0], image_ids: ['#f1', '#h2'] }, current.value.nodes[1] ];
  const refs = { ...current.pictureRefs, '#f1': current.pictureRefs['#h1'] };
  assert.deepEqual(remapSampleBases(current, aliased, id => refs[id]?.record_id), { '#h3': '#f1', '#h4': '#h3' });
  const withoutBase = [{ ...current.value.nodes[0], image_ids: ['#h2'] }, current.value.nodes[1]];
  const retained = remapSampleBases(current, withoutBase, id => refs[id]?.record_id);
  assert.deepEqual(retained, { '#h4': '#h3' });
  assert.equal(selectRetrospectBaseline({ ...current.value, nodes: withoutBase, sampleBases: retained }, child, 'v1').cover, '#h2', 'absent provenance falls back only to the inferred parent cover');
  assert.equal(selectRetrospectBaseline({ ...current.value, sampleBases: undefined }, child, 'v1').cover, '#h2', 'older cards remain readable');
});

test('capacity preserves all existing stages and history; explicit final keeps the root path', async () => {
  const { store, r } = await activeTree(Array.from({ length: 80 }, (_, i) => picture(i+1, `p${i}`)));
  const overflow = picture(81, 'new');
  assert.throws(() => store.prepareNext('board-1', 'ask'), /80.*ASK/);
  assert.equal(store.land(store.begin('board-1'), overflow, refsOf([overflow])), null, 'same stage samples remain available at capacity');
  assert.equal(store.get(r.id).value.nodes.length, 80);
  const { finalPath } = await import('../src/ask/retrospect/store.ts');
  const live = store.get(r.id); store.finalize(r.id, 'v5', '#h5', live.revision);
  assert.equal(store.activeForBoard('board-1'), null);
  assert.deepEqual([...finalPath(store.get(r.id))], ['v5','v4','v3','v2','v1']);
});

test('built-in rollback restores the real base before patches, maps source roles, and commits cursor with undo', async () => {
  const { parseDraft, validateDraft, stateHash } = await import('../src/ask/draft/validate.ts');
  const { createDraftWriter } = await import('../src/ask/draft/apply.ts');
  const { createDraftStack } = await import('../src/ask/draft/stack.ts');
  const { internalDraftSchema, draftSchema } = await import('../src/ask/draft/schema.ts');
  assert.ok(internalDraftSchema.properties.base_image_id); assert.equal(draftSchema.properties.base_image_id, undefined);
  const role = { id: 'c3', on: true, prompt: 'black hair', negative: '', centers: [] };
  const pictures = [picture(1, 'BASE', { localCharacters: [role] }), picture(2, 'WALKED TOO FAR')].map(p => ({ ...p, bindings: refsOf([p]), origins: [{ source: 'history', label: p.label, order: p.createdAt }] }));
  const { store, r } = await activeTree(pictures);
  let currentForm = { ...structuredClone(DEFAULTS), prompt: 'CURRENT', seed: '456', batchCount: 3, characters: [] }, fail = false;
  const base = { workspace: 'image', form: structuredClone(currentForm), boardId: 'board-1', boardName: 'board', nextCharacterId: 20, composer: '', conversationId: 'chat', models: [{ id: DEFAULTS.model, name: 'NAI', profileId: 'koma-standard-v1' }], samplers: [DEFAULTS.sampler] };
  const input = { base_hash: stateHash(base), draft_title: '回退再改', base_image_id: '#h1', steps: [
    { kind: 'prompt_patch', target: 'image.prompt', mode: 'append', text: ', low angle' },
    { kind: 'prompt_patch', target: 'image.char.c3.prompt', mode: 'append', text: ', blue eyes' },
    { kind: 'params_patch', params: { steps: 30 } },
  ] };
  assert.throws(() => parseDraft(input, base, pictures), /仅用于内置/);
  assert.throws(() => parseDraft({ ...input, new_board_name: 'new' }, base, pictures, '', id => store.prepareMove('board-1', id)), /仅用于内置/);
  const draft = parseDraft(input, base, pictures, '', id => store.prepareMove('board-1', id));
  const { proposeDraft } = await import('../src/ask/draft/tool.ts');
  const emptyInsert = await proposeDraft.run({ ...input, steps: [{ kind: 'prompt_patch', target: 'image.prompt', mode: 'after', anchor: 'missing', text: '' }] }, {
    draftBase: base, library: pictures, evolutionBase: id => store.prepareMove('board-1', id), checkNaiInput: async () => null,
  });
  assert.equal(emptyInsert.error, undefined);
  assert.equal(emptyInsert.draft.steps.length, 0);
  const rollbackOnly = validateDraft(emptyInsert.draft, base, { off: new Set() });
  assert.equal(rollbackOnly.rollbackBase.evolution.after.cursor.nodeId, 'v1');
  assert.equal(rollbackOnly.changes.find(c => c.field === 'prompt').after, 'BASE');
  const checked = validateDraft(draft, base, { off: new Set(), has: () => true });
  const plan = { ...checked, rollbackBase: { ...checked.rollbackBase, evolution: store.prepareNext('board-1', 'ask', checked.rollbackBase.evolution) } };
  assert.deepEqual(plan.steps.filter(s => s.issue), []);
  assert.equal(plan.changes.find(c => c.field === 'prompt').after, 'BASE, low angle');
  assert.equal(plan.changes.find(c => c.field === 'characters').after[0].prompt, 'black hair, blue eyes');
  assert.equal(plan.changes.find(c => c.field === 'characters').after[0].id, 'c20');
  assert.ok(plan.steps.every(s => s.locked));
  assert.ok(validateDraft(draft, { ...base, form: { ...base.form, prompt: 'ask' } }, { off: new Set() }).steps.every(s => s.issue));
  const drawing = { retainHistory() {}, snapshot: () => ({ form: currentForm, boards: [{ id: 'board-1', form: currentForm }] }), writeDraft: async changes => { if (fail) throw new Error('save failed'); currentForm = { ...currentForm, ...changes }; } };
  const writer = createDraftWriter(drawing, { snapshot: () => ({ current: { id: 'chat' }, conversations: [] }), retainHandoffDrafts() {} }, { route: { value: {} }, switchWorkspace(workspace) { this.route.value.workspace = workspace; } }, undefined, undefined, undefined, { moveIssue: store.moveIssue, commitMove: store.commitMove, available: () => true });
  const fileWriter = createDraftWriter(drawing, { snapshot: () => ({ current: { id: 'chat' }, conversations: [] }) }, { route: { value: {} }, switchWorkspace(workspace) { this.route.value.workspace = workspace; } }, undefined,
    () => ({ context: () => ({ id: null, available: true }), apply: async (_files, _undo, commit) => { await commit(); throw new Error('file failed after local commit'); } }), undefined,
    { moveIssue: store.moveIssue, commitMove: store.commitMove, available: () => true });
  await assert.rejects(fileWriter.apply({ ...plan, files: [{ context: { id: null } }] }), /file failed/);
  assert.equal(currentForm.prompt, 'CURRENT'); assert.equal(store.get(r.id).cursor.nodeId, 'v2');
  const stack = createDraftStack(writer), entry = stack.create(draft, 'ask', 1);
  fail = true; await assert.rejects(stack.apply(entry, plan), /save failed/);
  assert.equal(store.get(r.id).cursor.nodeId, 'v2'); assert.equal(currentForm.prompt, 'CURRENT');
  fail = false; await stack.apply(entry, plan);
  assert.equal(store.get(r.id).cursor.nodeId, 'v1'); assert.equal(currentForm.prompt, 'BASE, low angle');
  assert.equal(currentForm.seed, '456'); assert.equal(currentForm.batchCount, 3);
  const generated = picture(3, 'BASE, low angle'); store.land(store.begin('board-1'), generated, refsOf([generated]));
  assert.equal(store.get(r.id).value.edges.at(-1).from, 'v1');
  await stack.undo(entry.id); assert.equal(currentForm.prompt, 'CURRENT'); assert.equal(store.get(r.id).cursor.nodeId, 'v2');
  assert.equal(store.get(r.id).value.nodes.length, 3);
  await stack.restore(entry.id); assert.equal(store.get(r.id).cursor.nodeId, 'v1');
  store.detachBoard('board-1'); await assert.rejects(stack.undo(entry.id), /演进基底/);
});

test('ASK updates the same living tree with expired evidence, preserves notes and rejects stale overwrites', async () => {
  const pictures = [picture(1, 'A'), picture(2, 'B')], { store, r } = await activeTree(pictures);
  store.annotate(r.id, ['node:v1'], 'keep light');
  const frozen = structuredClone(store.get(r.id)), reader = createRecipeReader(() => recipeClusters([pictures[1]], new Set()), 'board-1', [frozen]);
  const data = reader.read({ retrospect_id: r.id });
  assert.equal(data.retrospects[0].nodes[0].recipes['#h1'].prompt, 'A');
  const revised = reader.present({ retrospect_title: 'renamed', nodes: [node('v1', '#h1', '#h2')], edges: [] });
  assert.equal(revised.target.id, r.id);
  store.update(r.id, revised.target.revision, revised, refsOf(pictures), { conversationId: 'ask', turnId: 2, boardId: 'board-1', boardName: 'board' });
  assert.equal(store.records.value.length, 1); assert.equal(store.source('ask', 2).id, r.id);
  assert.equal(store.get(r.id).notes['node:v1'], 'keep light'); assert.equal(store.get(r.id).cursor.imageId, '#h2');
  assert.throws(() => store.update(r.id, revised.target.revision, revised, refsOf(pictures), r), /已变化/);
  store.commitMove(store.prepareNext('board-1', 'ask'));
  const next = picture(3, 'C'); store.land(store.begin('board-1'), next, refsOf([next]));
  assert.equal(store.get(r.id).value.edges.at(-1).from, 'v1');
  assert.equal(store.get(r.id).value.nodes.at(-1).id, 'v3', 'merged historical version numbers are never reused');
  const current = store.get(r.id);
  assert.throws(() => store.update(r.id, current.revision, { ...current.value, nodes: current.value.nodes.map(n => n.id === 'v1' ? { ...n, image_ids: ['#h3'] } : n) }, refsOf([next]), r), /节点身份/);
});

test('NEW lasts for the first panel visit, including stages added while open, without invalidating drafts', async () => {
  const { store, r } = await activeTree();
  assert.deepEqual(store.get(r.id).newNodes, ['v1', 'v2']);
  store.open(r.id); const revision = store.get(r.id).revision;
  assert.deepEqual(store.get(r.id).newNodes, ['v1', 'v2']);
  store.close(); store.open(r.id);
  assert.deepEqual(store.get(r.id).newNodes, []);
  assert.equal(store.get(r.id).revision, revision, 'viewing does not stale an ASK update or rollback draft');
  const roll = picture(3, 'B'); store.land(store.begin('board-1'), roll, refsOf([roll]));
  assert.deepEqual(store.get(r.id).newNodes, [], 'new samples inside an existing stage are not new versions');
  store.commitMove(store.prepareNext('board-1', 'ask'));
  const changed = picture(4, 'C'); store.land(store.begin('board-1'), changed, refsOf([changed]));
  assert.deepEqual(store.get(r.id).newNodes, ['v3']);
  store.close(); store.open(r.id);
  assert.deepEqual(store.get(r.id).newNodes, []);
  store.close();
  store.commitMove(store.prepareNext('board-1', 'ask'));
  const later = picture(5, 'D'); store.land(store.begin('board-1'), later, refsOf([later]));
  store.open(r.id); assert.deepEqual(store.get(r.id).newNodes, ['v4']);
});
