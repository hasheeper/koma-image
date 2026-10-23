import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, rollbackDrawingEdit } from '../src/domain/drawing.ts';
import { matchAnchor, parseDraft, stateHash, validateDraft } from '../src/ask/draft/validate.ts';
import { diffTags, draftView, hunksOf, tagsOf } from '../src/ask/draft/view.ts';
import { newConversation } from '../src/domain/conversation.ts';
import { createDraftWriter } from '../src/ask/draft/apply.ts';
import { createTools } from '../src/ask/tools.ts';
import { createSession } from '../src/ask/session.ts';
import { run } from '../src/ask/runner.ts';
const model = (id, cap = 2200000) => ({ id, upstreamId: id, replaces: [], maxPixels: cap });
const state = (fields = {}) => ({ form: { ...DEFAULTS, model: 'm', prompt: 'adult woman, red eyes, large breasts, nude', ...fields }, composer: '原始输入', conversationId: 'c1', models: [model('m'), model('small', 1048576)], samplers: ['k_euler_ancestral', 'k_euler'] });
const patch = (mode, anchor, text, target = 'image.prompt') => ({ kind: 'prompt_patch', target, mode, anchor, text });
const draft = (base, steps, library = []) => parseDraft({ base_hash: stateHash(base), title: '修改提示词', steps }, base, library);
const plan = (d, now = d.base, off = []) => validateDraft(d, now, { off: new Set(off) });
const restore = (fields) => ({ kind: 'restore_partial', source: '#h1', fields });
const library = (params) => [{ aliases: ['#h1', '#f1'], params }];

test('draft anchors: exact first, normalized punctuation/whitespace with source offsets, ambiguity and overlaps rejected', () => {
  assert.deepEqual(matchAnchor('a red eyes b', 'red eyes'), { start: 2, end: 10, aligned: false });
  const source = 'prefix blue  eyes ，\n red hair suffix';
  const found = matchAnchor(source, 'blue eyes,red hair');
  assert.equal(source.slice(found.start, found.end), 'blue  eyes ，\n red hair');
  assert.equal(found.aligned, true);
  for (const [text, anchor] of [['a a', 'a'], ['aaaa', 'aa'], ['blue  eyes, blue\teyes', 'blue eyes'], ['a', ' ']]) assert.equal(matchAnchor(text, anchor), null);
});
test('draft parser: hash locks send snapshot, copies state and source; no mixed workspaces or reserved writes', () => {
  const base = state(), d = draft(base, [patch('replace', 'red eyes', 'blue eyes')]);
  base.form.prompt = 'later'; assert.match(d.base.form.prompt, /red eyes/);
  assert.throws(() => parseDraft({ title: 'x', base_hash: 'wrong', steps: d.steps }, base, []), /base_hash/);
  assert.throws(() => draft(base, [patch('rewrite', '', 'x'), patch('rewrite', '', 'y', 'chat.composer')]), /一个工作区/);
  assert.throws(() => draft(base, [patch('replace', '', 'x')]), /anchor/);
  assert.throws(() => draft(base, [restore(['url'])], library({})), /字段/);
  assert.throws(() => draft(base, [{ kind: 'chat_distill_branch' }]), /分支草稿/);
  assert.throws(() => draft(base, [patch('rewrite', '', 'x', 'image.char.0.prompt')]), /目标无效/);
  const missing = plan(draft(base, [patch('rewrite', '', 'x', 'image.char.c9.prompt')]));
  assert.equal(missing.steps[0].issue, '目标角色已不存在'); assert.deepEqual(missing.changes, []);
});
test('draft title: declared draft_title maps to the card title and earlier title responses still parse', () => {
  const base = state(), input = { base_hash: stateHash(base), steps: [patch('replace', 'red eyes', 'blue eyes')] };
  const current = parseDraft({ ...input, draft_title: '  调整眼睛  ' }, base, []);
  assert.equal(current.title, '调整眼睛');
  assert.equal(plan(current).title, '调整眼睛');
  assert.equal(parseDraft({ ...input, title: '旧格式标题' }, base, []).title, '旧格式标题');
  for (const draft_title of ['', ' ', 42, 'x'.repeat(121)])
    assert.throws(() => parseDraft({ ...input, draft_title }, base, []));
});
test('draft new board: explicit name is image-only, stays separate from summary and participates in confirmation', () => {
  const base = { ...state(), boardId: 'source', boardName: '原画板' };
  const input = { base_hash: stateHash(base), draft_title: '改写夜景', steps: [patch('rewrite', '', 'night station')] };
  const proposed = parseDraft({ ...input, new_board_name: '  雨夜车站  ' }, base, []);
  const checked = plan(proposed);
  assert.equal(proposed.title, '改写夜景');
  assert.equal(checked.newBoardName, '雨夜车站');
  assert.equal(checked.boardId, 'source');
  assert.equal(checked.boardName, '原画板');
  assert.equal(checked.createdBoard, undefined, 'proposal does not allocate or create a board');
  const ordinary = plan(parseDraft(input, base, []));
  assert.equal(ordinary.newBoardName, undefined);
  assert.notEqual(ordinary.fingerprint, checked.fingerprint);
  assert.notEqual(plan(parseDraft({ ...input, new_board_name: '清晨车站' }, base, [])).fingerprint, checked.fingerprint);
  for (const new_board_name of ['', ' ', null, 42, '长'.repeat(81)])
    assert.throws(() => parseDraft({ ...input, new_board_name }, base, []));
  assert.throws(() => parseDraft({ ...input, new_board_name: '新画板', steps: [patch('rewrite', '', 'text', 'chat.composer')] }, base, []), /IMAGE/);
  const missing = state();
  assert.throws(() => parseDraft({ ...input, base_hash: stateHash(missing), new_board_name: '新画板' }, missing, []), /来源画板/);
});
test('draft sequential patch, insertion/deletion and toggles recalculate anchors without overwriting unrelated tags', () => {
  const base = state(), d = draft(base, [patch('replace', 'red eyes', 'blue eyes'), patch('after', 'blue eyes', ', soft lighting'), patch('replace', ', nude', '')]);
  assert.equal(plan(d).changes[0].after, 'adult woman, blue eyes, soft lighting, large breasts');
  const off = plan(d, base, ['0', '2']);
  assert.equal(off.steps[1].issue, '锚点不唯一或已不存在'); assert.deepEqual(off.changes, []);
  const inserted = plan(draft(base, [patch('before', 'red eyes', 'bright ')]));
  assert.match(inserted.changes[0].after, /bright red eyes/);
});
test('draft concurrency: unique anchors realign, stale rewrites and append disabled, independent fields remain valid', () => {
  const base = state(), d = draft(base, [patch('replace', 'red eyes', 'blue eyes'), patch('rewrite', '', 'bad quality', 'image.negative')]);
  const now = state({ prompt: base.form.prompt + ', user addition' }), p = plan(d, now);
  assert.equal(p.aligned, true); assert.equal(p.changes.length, 2); assert.match(p.changes[0].after, /user addition$/);
  for (const mode of ['rewrite', 'append']) assert.match(plan(draft(base, [patch(mode, '', 'new')]), now).steps[0].issue, /原文已变化/);
  assert.deepEqual(plan(d, state({ prompt: 'no matching anchor' })).changes.map(c => c.field), ['negative']);
  assert.notEqual(p.fingerprint, plan(d).fingerprint);
});
test('draft text edits are content-neutral and stay pending for confirmation', () => {
  const base = state({prompt:'1.2::artist:a, artist:b::, red eyes'});
  for (const steps of [
    [patch('replace', 'artist:a', 'artist:c')],
    [patch('before', '1.2::', '{')],
    [patch('after', 'red eyes', ', artist:c')],
    [patch('append', '', ', artist:c')],
    [patch('rewrite', '', 'artist:b, artist:a')],
  ]) {
    const p = plan(draft(base, steps));
    assert.equal(p.steps[0].issue, '');
    assert.equal(p.changes.length, 1);
    assert.equal(base.form.prompt, '1.2::artist:a, artist:b::, red eyes');
  }
  const restored = plan(draft(base, [restore(['prompt'])], library({prompt:'artist:c'})));
  assert.equal(restored.changes[0].after, 'artist:c');
});
test('draft view: tag-level diff ignores case, underscores and spacing; hunks pair removals with additions', () => {
  const pieces = diffTags(tagsOf('Blue eyes, nude, large_breasts, smile'), tagsOf('BLUE EYES, nude, large breasts, frown\n<b>new</b>'));
  assert.deepEqual(pieces.map(p => p.op), ['keep', 'keep', 'keep', 'del', 'ins', 'ins']);
  assert.deepEqual(pieces.filter(p => p.op === 'keep').map(p => p.text), ['BLUE EYES', 'nude', 'large breasts']);
  assert.deepEqual(hunksOf(pieces), [[{ sign: 'del', text: 'smile' }, { sign: 'ins', text: 'frown, <b>new</b>' }]]);
  const long = Array.from({ length: 600 }, (_, i) => `t${i}`);
  const wide = diffTags(long, [...long.slice(0, 10), ...long.slice(10).reverse()]);
  assert.equal(wide.filter(p => p.op === 'keep').length >= 10, true);
  assert.equal(wide.filter(p => p.op !== 'del').map(p => p.text).join(), [...long.slice(0, 10), ...long.slice(10).reverse()].join());
});
test('draft view: fields in order, parameters last, stat counts enabled valid steps; full view follows enabled steps', () => {
  const base = state(), d = draft(base, [patch('replace', 'red eyes', 'blue eyes'), patch('rewrite', '', 'bad, ugly', 'image.negative'), restore(['seed'])], library({ seed: 42 }));
  const view = draftView(plan(d));
  assert.deepEqual(view.fields.map(f => f.key), ['prompt', 'negative', 'params']);
  assert.deepEqual(view.fields[0].steps[0].hunks, [[{ sign: 'del', text: 'red eyes' }, { sign: 'ins', text: 'blue eyes' }]]);
  assert.deepEqual(view.fields[2].steps[0].kind === 'param' && [view.fields[2].steps[0].name, view.fields[2].steps[0].icon, view.fields[2].steps[0].after], ['Seed', 'i-dice', '42']);
  assert.deepEqual([view.added, view.removed], [1 + 2 + 1, 1 + 0 + 1]);
  assert.deepEqual(view.fields[0].full.filter(p => p.op !== 'keep'), [{ op: 'del', text: 'red eyes' }, { op: 'ins', text: 'blue eyes' }]);
  const off = draftView(plan(d, base, ['0']));
  assert.deepEqual([off.added, off.removed], [3, 1]);
  assert.equal(off.fields[0].full, null);
});
test('draft restore: only snapshot metadata, shared clamps, zero seed and absent source fields; per-field conflicts/toggles', () => {
  const base = state(), source = library({ scale: 7.3, steps: 99, cfg: -1, seed: 0, width: 832 });
  const d = draft(base, [restore(['scale','steps','cfg','seed','prompt','negative_prompt','batchCount'])], source);
  source[0].params.scale = 20;
  const p = plan(d);
  assert.deepEqual(Object.fromEntries(p.changes.map(c => [c.field,c.after])), { steps: 50, scale: 7.5, cfg: 0, seed: '0' });
  assert.equal(p.steps.filter(s => s.issue === '来源没有此参数').length, 3);
  assert.equal(plan(d, state({ scale: 8 }), ['0:seed']).changes.some(c => ['scale','seed'].includes(c.field)), false);
  assert.match(plan(d, state({ scale: 8 })).steps[0].issue, /外部修改/);
  const repeated = draft(base, [restore(['seed', 'seed'])], library({ seed: 0 }));
  assert.deepEqual(repeated.steps[0].fields, ['seed']);
  assert.equal(plan(repeated).changes.length, 1);
});
test('draft restore: invalid sizes/seeds/counts and coupled model/sampler/size cannot cause hidden normalization', () => {
  const base = state();
  for (const [key,value] of [['width',833],['seed',4294967296],['batchCount',1.5],['sampler','unknown']]) assert.equal(plan(draft(base,[restore([key])],library({[key]:value}))).changes.length,0);
  base.samplersByModel = {m: ['k_euler_ancestral'], small: ['k_euler']};
  const d = draft(base, [restore(['model','sampler','width','height','scale'])], library({ model:'small',sampler:'k_euler',width:1472,height:1472,scale:8 }));
  assert.deepEqual(plan(d).changes.map(c => c.field), ['scale']);
  const valid = draft(base,[restore(['model','sampler','width','height'])],library({model:'small',sampler:'k_euler',width:512,height:512}));
  assert.equal(plan(valid).changes.length,4);
  assert.deepEqual(plan(valid,base,['0:sampler']).changes,[]);
});
test('draft writer: confirmation targets one workspace, atomically refuses stale edits, undo preserves unrelated changes', async () => {
  let current = state(), writes = 0;
  const router = { route: { value: { workspace:'chat',overlay:null } }, switchWorkspace(w) { this.route.value.workspace = w; } };
  const drawing = { snapshot:()=>current, async writeDraft(values,expected) { assert.equal(router.route.value.workspace,'image'); for(const [k,v] of Object.entries(expected)) assert.equal(current.form[k],v); current.form={...current.form,...values}; writes++; } };
  const chat = { snapshot:()=>({current:{...newConversation(),id:current.conversationId,prompt:current.composer}}), async writeDraft(text,id,expected) {assert.equal(id,current.conversationId);assert.equal(expected,current.composer);current.composer=text;writes++;} };
  const writer = createDraftWriter(drawing,chat,router), p = plan(draft(current,[patch('replace','red eyes','blue eyes')]));
  assert.equal(writes,0); await writer.apply(p); assert.equal(writer.canUndo(p),true);
  current.form.negative='user';await writer.undo(p); assert.equal(current.form.negative,'user'); assert.match(current.form.prompt,/red eyes/);
  current.form.prompt='edited';await assert.rejects(writer.apply(p),/Prompt 已变化/);assert.equal(writes,2);
  current=state();const c=plan(draft(current,[patch('rewrite','','new','chat.composer')]));
  current.conversationId='c2';await assert.rejects(writer.apply(c),/对话已切换/);
  current=state();router.route.value.overlay='settings';await assert.rejects(writer.apply(p),/关闭/);
  router.route.value.overlay=null;router.route.value.workspace='chat';router.switchWorkspace=()=>{};await assert.rejects(writer.apply(p),/未能切换/);
});
test('draft runner: real proposal is read-only and stops same-response tools and duplicate proposals; all IDs answered', async () => {
  const base=state(),tools=createTools(),session=createSession(),turn=session.begin({role:'user',content:[{type:'text',text:'修改眼睛'}]});
  const input={base_hash:stateHash(base),draft_title:'眼睛',steps:[patch('replace','red eyes','blue eyes')]};
  const signal=new AbortController().signal;let reads=0,requests=0;
  const events=[];
  for await(const e of run({tools,turn,signal,context:{signal,draftBase:base,state:()=>{reads++;return {text:'',images:0};}},request:{model:'m',tools:[],system:['',''],maxTokens:1024},async *stream(){requests++;yield {type:'text',text:'已调整眼睛。'};for(const [id,name,args] of [['a','propose_draft',input],['b','get_state',{}],['c','propose_draft',input]])yield {type:'call',call:{type:'call',id,name,input:args}};yield {type:'done',stop:'tool'};}}))events.push(e);
  assert.equal(requests,1);assert.equal(reads,0);assert.equal(events.filter(e=>e.draft).length,1);assert.match(base.form.prompt,/red eyes/);
  const results=turn.messages().at(-1).content;assert.deepEqual(results.map(r=>r.id),['a','b','c']);assert.deepEqual(results.map(r=>!!r.error),[false,true,true]);
});

test('draft failed save: retain a manually edited parameter group so model rollback cannot replace the new sampler', () => {
  const before = state({ model: 'A', sampler: 'sampler_A', seed: '10', prompt: 'old' }).form;
  const written = { ...before, model: 'B', sampler: 'sampler_B', seed: '20', prompt: 'new' };
  const touched = ['model', 'sampler', 'seed', 'prompt'];
  assert.deepEqual(rollbackDrawingEdit(before, written, written, touched), before);
  const manual = { ...written, sampler: 'sampler_C', negative: 'user addition' };
  assert.deepEqual(rollbackDrawingEdit(before, written, manual, touched), { ...before, model: 'B', sampler: 'sampler_C', negative: 'user addition' });
  const resized = { ...written, width: 2048 };
  const rolled = rollbackDrawingEdit(before, written, resized, touched);
  assert.equal(rolled.model, 'B'); assert.equal(rolled.width, 2048); assert.equal(rolled.seed, '10');
});
