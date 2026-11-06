import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/domain/drawing.ts';
import { emptyDirectorSettings } from '../src/domain/director-tools.ts';
import { naiInputLimits, naiInputParts } from '../src/domain/nai-input.ts';
import { naiAwareness } from '../src/services/nai-awareness.ts';
import { editAwareness } from '../src/services/edit-awareness.ts';
import { checkNaiInput, textPlacementIssue } from '../src/ask/draft/nai-input.ts';
import { parseDraft, stateHash, validateDraft } from '../src/ask/draft/validate.ts';
import { createTools } from '../src/ask/tools.ts';
import { createSession } from '../src/ask/session.ts';
import { run } from '../src/ask/runner.ts';

const v45 = 'nai-diffusion-4-5-full', full = 'nai-diffusion-5-full', medium = 'nai-diffusion-5-full-medium';
const models = [v45, full, medium, 'custom-image'].map(id => ({ id, name: id, upstreamId: id, profileId: 'nai-official-v1', provider: 'novelai', maxPixels: 3145728, sourceMaxPixels: 3145728, operations: ['edit'], tools: ['img2img', 'inpaint', 'upscale', 'director'] }));
const base = (model = v45) => ({ workspace: 'image', boardId: 'board1', boardPresent: true, nextCharacterId: 3,
  form: { ...structuredClone(DEFAULTS), model, prompt: 'old caption' }, composer: '', conversationId: 'c1', models, samplers: ['k_euler_ancestral'] });
const editBase = (model = v45) => {
  const s = base(model); s.workspace = 'edit';
  s.edit = { id: 'e1', name: 'edit', boardSeq: 1, present: true, ready: true, baseId: 1, viewId: 1, maskRevision: 1, nextCharacterId: 3,
    source: { width: 512, height: 512, bytes: 1, recordId: 'src' }, models, samplers: s.samplers,
    mask: { has_mask: false, status: 'ready' }, blocked: '', photopeaUsed: false,
    config: { mode: 'img2img', chosen: { img2img: model, inpaint: model, upscale: model },
      strength: { img2img: .5, inpaint: 1 }, noise: { img2img: 0, inpaint: 0 }, focus: { on: false, rect: null },
      enhance: { on: false, scale: 1, magnitude: 3, strength: .5, noise: 0 },
      fields: { ...structuredClone(s.form), negative_prompt: '' }, characters: [], placement: 'auto', naiReferences: structuredClone(DEFAULTS.naiReferences),
      director: emptyDirectorSettings(), options: {}, upscaleOpen: false, directorOpen: false } };
  return s;
};
// Synthetic tokenizer isolates input projection/count aggregation from the real browser worker.
const counter = async payload => {
  const p = naiInputParts(payload);
  return { ...naiInputLimits(payload.model), ids: p.ids, prompt: p.prompt.map(s => [...s].length + 1), negative: p.negative.map(s => [...s].length + 1) };
};
const readers = (s, count = counter) => ({ image: form => naiAwareness({ form, models: s.models, samplers: s.samplers }, count).counted(), edit: state => editAwareness(state, count).counted() });
const patch = (text, target = 'image.prompt') => ({ kind: 'prompt_patch', target, mode: 'rewrite', text });
const input = (s, steps) => ({ base_hash: stateHash(s), draft_title: '候选修改', steps });
const proposal = (s, steps) => parseDraft(input(s, steps), s, []);
const checked = (s, steps, count) => checkNaiInput(proposal(s, steps), readers(s, count));

test('EDIT awareness excludes unrelated gateway models and duplicate sources from both initial and counted state', async () => {
  const s=editBase();
  const custom={id:'user-defined-visual-model',name:'Custom image',provider:'google',profileId:'gemini-native-v1',operations:['edit'],tools:['image-edit'],chat:true,maxImages:4};
  const upscaler={id:'dedicated-super-resolution',name:'Upscaler',provider:'fal',operations:['edit'],tools:['image-edit']};
  const unrelated=Array.from({length:500},(_,i)=>({id:`text-catalog-${i}`,name:`Text model ${i}`,provider:'openai',operations:['chat'],tools:[],chat:true,maxImages:0}));
  s.edit.models=[...models,{...models[0],connection:'duplicate'},custom,upscaler,...unrelated];
  const before=structuredClone(s.edit);
  const awareness=editAwareness(s.edit,counter);
  for(const state of [awareness.snapshot,await awareness.counted()]) {
    assert.deepEqual(state.capabilities.available_models.map(m=>m.id),[...models.map(m=>m.id),custom.id,upscaler.id]);
    assert.deepEqual(state.capabilities.modes,['img2img','inpaint','upscale']);
    assert.equal(state.capabilities.models,undefined);
    assert.equal(state.capabilities.emotions,undefined);
    assert.ok(state.capabilities.director_presets.includes('emotion'));
    assert.doesNotMatch(JSON.stringify(state),/text-catalog-|Text model/);
    assert.equal(state.capabilities.model_id,v45);
    assert.equal(state.form.prompt,'old caption');
  }
  assert.deepEqual(s.edit,before,'projection must not mutate the full catalog used by the editor');
});

test('automatic NAI check counts the complete proposed IMAGE input, remains read-only and returns a compact summary', async () => {
  const s = base(), before = structuredClone(s);
  const result = await checked(s, [patch('cat'), { kind: 'character_edit', op: 'add', prompt: 'dog', negative: 'bad' }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.input_budget.positive, { used: 8, limit: 512, remaining: 504, overflow: 0 });
  assert.equal(result.input_budget.negative.used, 5);
  assert.deepEqual(s, before);
  assert.doesNotMatch(JSON.stringify(result), /capabilities|old caption|available_models|cost|"characters"/);
});

test('automatic NAI check rejects Text overflow with exact character usage but allows ordinary Token warnings', async () => {
  const s = base();
  const hard = await checked(s, [patch('Text: ' + '猫'.repeat(119))]);
  assert.equal(hard.ok, false);
  assert.equal(hard.input_budget.text.used, 119);
  assert.equal(hard.input_budget.text.overflow, 1);
  assert.equal(hard.input_budget.positive.used, 126);
  assert.match(hard.errors.join(' '), /119.*118/);
  const warning = await checked(s, [patch('x'.repeat(600))]);
  assert.equal(warning.ok, true);
  assert.equal(warning.input_budget.positive.overflow, 89);
  assert.match(warning.warnings.join(' '), /Token.*截断/);
});

test('a known NAI model can prepare words without a configured source, while Text and Medium constraints still apply', async () => {
  const s = base(); s.models = [];
  const state = await readers(s).image(s.form);
  assert.equal(state.capabilities.ready, false);
  assert.equal(state.cost.status, 'unknown');
  assert.equal(state.input_budget.status, 'ready');
  const result = await checked(s, [patch('cat')]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.input_budget.positive, { used: 4, limit: 512, remaining: 508, overflow: 0 });
  assert.match(result.warnings.join(' '), /没有可用来源/);
  const hard = await checked(s, [patch('Text: ' + '猫'.repeat(119))]);
  assert.equal(hard.ok, false);
  assert.equal(hard.input_budget.text.used, 119);
  s.form.naiReferences = { active: 'precise', normalize: false, vibe: [], precise: [{ id: 'r1', assetId: 'a'.repeat(64), on: true, strength: 1, information: 1, fidelity: 1, type: 'style' }] };
  assert.equal((await checked(s, [patch('cat')])).ok, true, 'unknown source support is not a known incompatibility');
  assert.equal((await readers(s).image(s.form)).cost.lower_bound, undefined, 'no source means no assumed Anlas price');
  s.form.model = medium;
  const locked = await checked(s, [patch('new negative', 'image.negative')]);
  assert.equal(locked.ok, false);
  assert.match(locked.errors.join(' '), /Medium.*固定/);
});

test('Text placement only uses explicit structure, preserving unquoted dialogue, punctuation and line breaks', async () => {
  for (const text of ['Text: Hello, world!', 'Text: 你好\n世界', 'Text: "Hello" "World"', 'Text: "Hello".', 'Text: 「你好！」。', 'Text: She said "Hello".', 'a sign reading "Hello"']) assert.equal(textPlacementIssue(text), null);
  for (const text of ['Text: "Hello", blue eyes, best quality', 'Text: 你好\n<artist>artist_name</artist>', 'Text: Hi\nCharacter 1: red hair']) assert.match(textPlacementIssue(text), /末尾/);
  const result = await checked(base(), [patch('Text: "Hello", blue eyes')]);
  assert.equal(result.ok, false);
  assert.equal(result.input_budget.text.used, 18);
  assert.match(result.errors.join(' '), /Text:.*末尾/);
});

test('Medium locks reject writes while the error budget measures the proposed words, not rolled-back words', async () => {
  const s = base(medium);
  for (const step of [{ kind: 'params_patch', params: { steps: 25 } }, { kind: 'params_patch', params: { sampler: 'k_euler_ancestral' } }, patch('new negative', 'image.negative')]) {
    const result = await checked(s, [patch('cat'), step]);
    assert.equal(result.ok, false);
    assert.equal(result.input_budget.positive.used, 4);
    assert.match(result.errors.join(' '), /Medium.*固定/);
  }
  const unlocked = await checked(s, [patch('cat'), { kind: 'params_patch', params: { model: full, steps: 28 } }]);
  assert.equal(unlocked.ok, true);
  assert.equal(unlocked.model_id, full);
});

test('EDIT automatic preflight follows the candidate Effort/mode and cannot mutate the editor configuration', async () => {
  const s = editBase(full), before = structuredClone(s);
  const valid = await checked(s, [patch('dog', 'edit.prompt'), { kind: 'params_patch', params: { effort: 'medium' } }]);
  assert.equal(valid.ok, true);
  assert.equal(valid.target, 'edit');
  assert.equal(valid.model_id, medium);
  assert.equal(valid.input_budget.positive.used, 4);
  const invalid = await checked(s, [patch('fox', 'edit.prompt'), { kind: 'params_patch', params: { effort: 'medium', steps: 25 } }]);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.model_id, medium);
  assert.equal(invalid.input_budget.positive.used, 4);
  assert.match(invalid.errors.join(' '), /Medium.*固定/);
  assert.deepEqual(s, before);
  const draft = proposal(s, [patch('dog', 'edit.prompt')]);
  const beforePlan = validateDraft(draft, s, { off: new Set() });
  await checkNaiInput(draft, readers(s));
  assert.deepEqual(validateDraft(draft, s, { off: new Set() }), beforePlan, 'inspection does not change the apply plan');
});

test('non-NAI and CHAT bypass NAI checking; unavailable Token counts stay explicit and do not prevent word preparation', async () => {
  assert.equal(await checked(base('custom-image'), [patch('dog')]), null);
  const chat = base(); chat.workspace = 'chat';
  assert.equal(await checked(chat, [patch('new message', 'chat.composer')]), null);
  const result = await checked(base(), [patch('dog')], async () => null);
  assert.equal(result.ok, true);
  assert.equal(result.input_budget.status, 'unavailable');
  assert.equal(result.input_budget.positive.used, undefined);
  assert.match(result.warnings.join(' '), /Token.*未核验/);
  const hard = await checked(base(), [patch('Text: ' + '猫'.repeat(119))], async () => null);
  assert.equal(hard.ok, false);
  assert.equal(hard.input_budget.text.used, 119);
});

test('propose_draft rejects and accepts a corrected NAI candidate in the same turn without an extra checking tool', async () => {
  const s = base(), before = structuredClone(s), tools = createTools(), session = createSession();
  const turn = session.begin({ role: 'user', content: [{ type: 'text', text: '请改写' }] });
  const signal = new AbortController().signal, events = [];
  let requests = 0, checks = 0;
  const options = { turn, tools, signal, request: { model: 'mock', system: ['', ''], tools: [...tools.values()].map(e => e.tool), maxTokens: 1024 },
    context: { signal, draftBase: s, metadataOnly: false, state: () => ({ text: '', images: 0 }), checkNaiInput: draft => { checks++; return checkNaiInput(draft, readers(s)); } },
    async *stream(request) {
      const i = requests++;
      assert.ok(request.tools.every(t => t.name !== 'check_nai_input'));
      if (i === 1) {
        const result = request.messages.at(-1).content[0];
        assert.equal(result.error, true);
        const report = JSON.parse(result.content[1].text.slice(7, -8));
        assert.equal(report.input_budget.text.used, 119);
      }
      yield { type: 'call', call: { type: 'call', id: `draft${i}`, name: 'propose_draft', input: input(s, [patch(i ? 'cat, Text: Hello' : 'Text: ' + '猫'.repeat(119))]) } };
      yield { type: 'text', text: i ? '已缩短文字，草稿请确认。' : '正在准备草稿。' };
      yield { type: 'done', stop: 'tool', usage: null };
    } };
  for await (const event of run(options)) events.push(event);
  assert.equal(requests, 2); assert.equal(checks, 2); assert.equal(turn.budget.toolCalls, 2);
  assert.deepEqual(events.filter(e => e.type === 'tool-end').map(e => e.ok), [false, true]);
  assert.equal(events.filter(e => e.draft).length, 1);
  assert.equal(events.at(-1).reason, 'final');
  assert.deepEqual(s, before);
});
