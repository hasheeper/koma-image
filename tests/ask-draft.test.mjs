import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, rollbackDrawingEdit } from '../src/domain/drawing.ts';
import { matchAnchor, parseDraft, stateHash, validateDraft, artistProblem, keptParts } from '../src/ask/draft/validate.ts';
import { createDraftWriter } from '../src/ask/draft/apply.ts';
import { createTools } from '../src/ask/tools.ts';
import { createSession } from '../src/ask/session.ts';
import { run } from '../src/ask/runner.ts';
const model = (id, cap = 2200000) => ({ id, upstreamId: id, replaces: [], maxPixels: cap });
const state = (fields = {}) => ({ form: { ...DEFAULTS, model: 'm', prompt: 'adult woman, red eyes, large breasts, nude', ...fields }, composer: '原始输入', conversationId: 'c1', models: [model('m'), model('small', 1048576)], samplers: ['k_euler_ancestral', 'k_euler'] });
const patch = (mode, anchor, text, target = 'image.prompt') => ({ kind: 'prompt_patch', target, mode, anchor, text });
const draft = (base, steps, question = '调整眼睛', library = []) => parseDraft({ base_hash: stateHash(base), title: '修改提示词', steps }, base, question, library);
const plan = (d, now = d.base, off = [], category) => validateDraft(d, now, { off: new Set(off), category });
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
  assert.throws(() => parseDraft({ title: 'x', base_hash: 'wrong', steps: d.steps }, base, '', []), /base_hash/);
  assert.throws(() => draft(base, [patch('rewrite', '', 'x'), patch('rewrite', '', 'y', 'chat.composer')]), /一个工作区/);
  assert.throws(() => draft(base, [patch('replace', '', 'x')]), /anchor/);
  assert.throws(() => draft(base, [restore(['url'])], '', library({})), /字段/);
  assert.throws(() => draft(base, [{ kind: 'chat_distill_branch' }]), /分支草稿/);
  const reserved = plan(draft(base, [patch('rewrite', '', 'x', 'image.char.0.prompt')]));
  assert.equal(reserved.steps[0].issue, '目标不存在'); assert.deepEqual(reserved.changes, []);
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
test('draft artists: dictionary and explicit prefix protected, grouped weights detected; only explicitly named change permitted', () => {
  const category = t => ['artist_a','artist_b'].includes(t) ? 1 : 0;
  assert.match(artistProblem('artist_a, blue eyes', 'blue eyes', '优化一下', category), /保护/);
  assert.match(artistProblem('1.2::artist_a, artist_b::', '1.4::artist_a, artist_b::', '提高 artist_a 权重', category), /保护/);
  assert.match(artistProblem('artist_a, artist_b', 'artist_b, artist_a', '整理顺序', category), /保护/);
  assert.match(artistProblem('1::blue eyes, artist_a::', '1.001::blue eyes, artist_a::', '调整眼睛', category), /保护/);
  assert.equal(artistProblem('artist_a, blue eyes', 'artist_a, red eyes', '', category), '');
  assert.equal(artistProblem('artist_a, blue eyes', 'blue eyes', '删除 artist_a', category), '');
  assert.match(artistProblem('artist:unknown, blue eyes', 'blue eyes', '不要删除 artist:unknown'), /保护/);
  assert.match(artistProblem('artist_a', 'artist_b', '替换 artist_a', category), /保护/);
  assert.equal(artistProblem('artist_a', 'artist_b', '把 artist_a 替换为 artist_b', category), '');
  const d = draft(state({ prompt: '{artist_a}, red eyes' }), [patch('replace', '{artist_a}', 'artist_a')]);
  assert.equal(plan(d, d.base, [], category).changes.length, 0);
});
test('draft rewrite keep spans: local, case insensitive and whole words, never model markup', () => {
  const parts = keptParts('Blue eyes, nude, large_breasts', 'BLUE EYES, nude, large breasts, nudely <b>new</b>');
  assert.deepEqual(parts.filter(p => p.kept).map(p => p.text), ['BLUE EYES', 'nude', 'large breasts']);
  assert.equal(parts.map(p => p.text).join(''), 'BLUE EYES, nude, large breasts, nudely <b>new</b>');
});
test('draft restore: only snapshot metadata, shared clamps, zero seed and absent source fields; per-field conflicts/toggles', () => {
  const base = state(), source = library({ scale: 7.3, steps: 99, cfg: -1, seed: 0, width: 832 });
  const d = draft(base, [restore(['scale','steps','cfg','seed','prompt','negative_prompt','batchCount'])], '', source);
  source[0].params.scale = 20;
  const p = plan(d);
  assert.deepEqual(Object.fromEntries(p.changes.map(c => [c.field,c.after])), { steps: 50, scale: 7.5, cfg: 0, seed: '0' });
  assert.equal(p.steps.filter(s => s.issue === '来源没有此参数').length, 3);
  assert.equal(plan(d, state({ scale: 8 }), ['0:seed']).changes.some(c => ['scale','seed'].includes(c.field)), false);
  assert.match(plan(d, state({ scale: 8 })).steps[0].issue, /外部修改/);
});
test('draft restore: invalid sizes/seeds/counts and coupled model/sampler/size cannot cause hidden normalization', () => {
  const base = state();
  for (const [key,value] of [['width',833],['seed',4294967296],['batchCount',1.5],['sampler','unknown']]) assert.equal(plan(draft(base,[restore([key])],'',library({[key]:value}))).changes.length,0);
  base.samplersByModel = {m: ['k_euler_ancestral'], small: ['k_euler']};
  const d = draft(base, [restore(['model','sampler','width','height','scale'])], '', library({ model:'small',sampler:'k_euler',width:1472,height:1472,scale:8 }));
  assert.deepEqual(plan(d).changes.map(c => c.field), ['scale']);
  const valid = draft(base,[restore(['model','sampler','width','height'])],'',library({model:'small',sampler:'k_euler',width:512,height:512}));
  assert.equal(plan(valid).changes.length,4);
  assert.deepEqual(plan(valid,base,['0:sampler']).changes,[]);
});
test('draft writer: confirmation targets one workspace, atomically refuses stale edits, undo preserves unrelated changes', async () => {
  let current = state(), writes = 0;
  const router = { route: { value: { workspace:'chat',overlay:null } }, switchWorkspace(w) { this.route.value.workspace = w; } };
  const drawing = { snapshot:()=>current, async writeDraft(values,expected) { assert.equal(router.route.value.workspace,'image'); for(const [k,v] of Object.entries(expected)) assert.equal(current.form[k],v); current.form={...current.form,...values}; writes++; } };
  const chat = { snapshot:()=>({current:{id:current.conversationId,prompt:current.composer}}), async writeDraft(text,id,expected) {assert.equal(id,current.conversationId);assert.equal(expected,current.composer);current.composer=text;writes++;} };
  const writer = createDraftWriter(drawing,chat,router), p = plan(draft(current,[patch('replace','red eyes','blue eyes')]));
  assert.equal(writes,0); await writer.apply(p); assert.equal(writer.canUndo(p),true);
  current.form.negative='user';await writer.undo(p); assert.equal(current.form.negative,'user'); assert.match(current.form.prompt,/red eyes/);
  current.form.prompt='edited';await assert.rejects(writer.apply(p),/内容已变化/);assert.equal(writes,2);
  current=state();const c=plan(draft(current,[patch('rewrite','','new','chat.composer')]));
  current.conversationId='c2';await assert.rejects(writer.apply(c),/内容已变化/);
  current=state();router.route.value.overlay='settings';await assert.rejects(writer.apply(p),/关闭/);
  router.route.value.overlay=null;router.route.value.workspace='chat';router.switchWorkspace=()=>{};await assert.rejects(writer.apply(p),/未能切换/);
});
test('draft runner: real proposal is read-only and stops same-response tools and duplicate proposals; all IDs answered', async () => {
  const base=state(),tools=createTools(),session=createSession(),turn=session.begin({role:'user',content:[{type:'text',text:'修改眼睛'}]});
  const input={base_hash:stateHash(base),title:'眼睛',steps:[patch('replace','red eyes','blue eyes')]};
  const signal=new AbortController().signal;let reads=0,requests=0;
  const events=[];
  for await(const e of run({tools,turn,signal,context:{signal,draftBase:base,question:'修改眼睛',state:()=>{reads++;return {text:'',images:0};}},request:{model:'m',tools:[],system:['',''],maxTokens:1024},async *stream(){requests++;for(const [id,name,args] of [['a','propose_draft',input],['b','get_state',{}],['c','propose_draft',input]])yield {type:'call',call:{type:'call',id,name,input:args}};yield {type:'done',stop:'tool'};}}))events.push(e);
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
