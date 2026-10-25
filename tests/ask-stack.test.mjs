import test from 'node:test';
import assert from 'node:assert/strict';
import { newConversation, chatDraftKey, chatSelection, isBlank } from '../src/domain/conversation.ts';
import { DEFAULTS } from '../src/domain/drawing.ts';
import { createDraftStack, UNDO_LIMIT } from '../src/ask/draft/stack.ts';
import { createDraftWriter } from '../src/ask/draft/apply.ts';

function fixture() {
  let form = { ...DEFAULTS }, current = newConversation(), conversations = [current], writes = 0, failure = '';
  const origins = new Map();
  const router = { route: { value: { workspace: 'image', overlay: null } }, switchWorkspace(w) { this.route.value.workspace = w; } };
  const guard = () => { if (failure) throw new Error(failure); writes++; };
  const writer = createDraftWriter({ snapshot: () => ({ form, history: [], favorites: [] }), async writeDraft(values) { guard(); Object.assign(form, values); } }, {
    snapshot: () => ({ current, conversations }),
    async writeDraft(text) { guard(); current.prompt = text; },
    async writeBranchDraft(next, expected) { assert.equal(chatDraftKey(current), expected); guard(); Object.assign(current, structuredClone(next)); current.selectionRevision++; return chatDraftKey(current); },
    // Mirrors chat.writeHandoffDraft: reuse the blank conversation or open one, then show it.
    async writeHandoffDraft(draft) {
      guard();
      const source = current, blank = conversations.find(isBlank), before = blank ? structuredClone(blank) : null, target = blank ?? newConversation();
      if (!blank) conversations.push(target);
      Object.assign(target, { prompt: draft.text, attachments: draft.images.map((i) => i.asset), settings: { model: draft.model, options: { ...draft.options } } });
      target.selectionRevision++; current = target; origins.set(target.id, { before, source: source.id });
      return chatDraftKey(target);
    },
    async undoHandoffDraft(receipt) {
      const id = JSON.parse(receipt)[0], target = conversations.find((c) => c.id === id), origin = origins.get(id);
      assert.equal(chatDraftKey(target), receipt); guard();
      if (origin.before) Object.assign(target, structuredClone(origin.before), { selectionRevision: target.selectionRevision + 1 });
      else conversations = conversations.filter((c) => c !== target);
      if (current === target) current = conversations.find((c) => c.id === origin.source) ?? conversations[0];
      return chatDraftKey(current);
    },
    handoffOrigin: (id) => origins.get(id) ?? null,
  }, router);
  const stack = createDraftStack(writer);
  const make = (changes, workspace = 'image', branch, handoff) => ({ title: '测试草稿', workspace, conversationId: current.id, steps: [], changes, branch, handoff, fingerprint: 'fixture', aligned: false });
  const image = (values) => make(Object.entries(values).map(([field, after]) => ({ field, before: form[field], after })));
  const composer = (text) => make([{ field: 'composer', before: current.prompt, after: text }], 'chat');
  const branch = (text) => make([], 'chat', { key: chatDraftKey(current), before: chatSelection(current), after: { ...chatSelection(current), prompt: text, baseFollows: !current.baseFollows } });
  const handoff = (text, images = []) => make([{ field: 'composer', before: '', after: text }], 'chat', undefined, { model: 'gpt-image', options: { size: '1536x1024' }, text, images });
  const apply = async (plan, owner = 'ask-a') => {
    const record = stack.create({ title: plan.title, steps: [], base: {}, question: '', baseHash: '' }, owner, 1);
    await stack.apply(record, plan);
    return record;
  };
  return { stack, writer, image, composer, branch, handoff, apply, form, get current() { return current; }, set current(c) { current = c; },
    get conversations() { return conversations; }, set conversations(list) { conversations = list; }, router, writes: () => writes, fail: (v) => failure = v };
}

test('W3 stack: shared LIFO, one redo, new applications clear redo and no old draft becomes pending', async () => {
  const f = fixture(), a = await f.apply(f.image({ prompt: 'a' })), b = await f.apply(f.image({ prompt: 'b' }), 'ask-b');
  await assert.rejects(f.stack.undo(a.id), /先回退较新的草稿/);
  assert.equal(f.form.prompt, 'b'); assert.equal(f.stack.top, b);
  await f.stack.undo(b.id); assert.equal(f.form.prompt, 'a'); assert.equal(f.stack.top, a); assert.equal(f.stack.redo, b);
  await f.stack.undo(a.id); assert.equal(f.form.prompt, ''); assert.equal(f.stack.redo, a); assert.equal(b.status, 'reverted');
  await assert.rejects(f.stack.restore(b.id), /已不能恢复/);
  await f.stack.restore(a.id); assert.equal(f.form.prompt, 'a'); assert.equal(f.stack.redo, null); assert.equal(f.stack.top, a);
  await f.stack.undo(a.id);
  await f.apply(f.image({ negative: 'new' })); assert.equal(f.stack.redo, null);
  await assert.rejects(f.stack.restore(a.id), /已不能恢复/);
});

test('W3 stack: stale fields have precise names, failed undo/redo do not change form or history', async () => {
  const f = fixture(), a = await f.apply(f.image({ prompt: 'new', seed: '42', width: 512, height: 512 }));
  Object.assign(f.form, { prompt: 'manual', seed: '9', width: 640, height: 640 });
  await assert.rejects(f.stack.undo(a.id), /Prompt、Seed、尺寸 已变化/);
  assert.equal(f.stack.top, a); assert.equal(a.status, 'applied'); assert.equal(f.writes(), 1);
  Object.assign(f.form, { prompt: 'new', seed: '42', width: 512, height: 512, negative: 'unrelated' });
  await f.stack.undo(a.id); assert.equal(f.form.negative, 'unrelated');
  f.form.prompt = 'manual';
  await assert.rejects(f.stack.restore(a.id), /Prompt 已变化/);
  assert.equal(f.stack.redo, a); assert.equal(a.status, 'reverted'); assert.equal(f.writes(), 2);
});

test('W3 stack: persistence failure retains the exact top, redo and pending records', async () => {
  const f = fixture(), a = await f.apply(f.image({ prompt: 'new' }));
  f.fail('save failed'); await assert.rejects(f.stack.undo(a.id), /save failed/);
  assert.equal(f.stack.top, a); assert.equal(f.form.prompt, 'new');
  f.fail(''); await f.stack.undo(a.id);
  f.fail('save failed'); await assert.rejects(f.stack.restore(a.id), /save failed/);
  assert.equal(f.stack.redo, a); assert.equal(f.stack.top, null); assert.equal(f.form.prompt, '');
  const record = f.stack.create(a.draft, 'ask-a', 2);
  await assert.rejects(f.stack.apply(record, f.image({ prompt: 'b' })), /save failed/);
  assert.equal(record.status, 'pending'); assert.equal(record.plan, null); assert.equal(f.stack.redo, a);
});

test('W3 stack: two CHAT branches with composer in between undo through revision changes and redo repeatedly', async () => {
  const f = fixture(), initial = chatSelection(f.current);
  const a = await f.apply(f.branch('branch A'));
  const b = await f.apply(f.composer('composer B'));
  const c = await f.apply(f.branch('branch C'));
  await f.stack.undo(c.id); assert.equal(f.current.prompt, 'composer B');
  await f.stack.restore(c.id); assert.equal(f.current.prompt, 'branch C');
  await f.stack.undo(c.id);
  await f.stack.undo(b.id); assert.equal(f.current.prompt, 'branch A');
  assert.equal(f.writer.canUndo(a.plan, a.receipt), true);
  await f.stack.undo(a.id); assert.deepEqual(chatSelection(f.current), initial);
  await f.stack.restore(a.id); assert.equal(f.current.prompt, 'branch A');
  await f.stack.undo(a.id); assert.deepEqual(chatSelection(f.current), initial);
});

test('W3 stack: CHAT identity, context, attachments and external revision changes are never forgiven', async () => {
  for (const change of [c => c.keepIds.push('manual'), c => c.selectionRevision++, c => c.attachments.push('manual')]) {
    const f = fixture(), a = await f.apply(f.branch('branch A'));
    change(f.current);
    // A later valid branch write/undo must not refresh A's invalid receipt.
    const b = await f.apply(f.branch('branch B'));
    await f.stack.undo(b.id);
    await assert.rejects(f.stack.undo(a.id), /对话分支已变化/);
    assert.equal(f.stack.top, a);
  }
  const f = fixture(), a = await f.apply(f.composer('hello'));
  f.current.id = 'other'; await assert.rejects(f.stack.undo(a.id), /对话已切换/);
  f.current.id = a.plan.conversationId;
  f.current.prompt = 'manual'; await assert.rejects(f.stack.undo(a.id), /对话输入框 已变化/);
});

test('W3 stack: composer undo preserves unrelated CHAT edits and cannot validate an earlier branch', async () => {
  const f = fixture(), a = await f.apply(f.branch('A')), b = await f.apply(f.composer('B'));
  f.current.keepIds.push('external');
  await f.stack.undo(b.id); assert.equal(f.current.prompt, 'A'); assert.deepEqual(f.current.keepIds, ['external']);
  await assert.rejects(f.stack.undo(a.id), /对话分支已变化/);
});

test('W3 stack: deleting conversations removes undo/redo only, leaves writes intact and checks gaps', async () => {
  const f = fixture(), a = await f.apply(f.image({ prompt: 'a' })), b = await f.apply(f.image({ prompt: 'b' }), 'ask-b');
  f.stack.removeConversation('ask-b'); assert.equal(f.stack.top, a); assert.equal(f.form.prompt, 'b');
  await assert.rejects(f.stack.undo(a.id), /Prompt 已变化/);
  assert.equal(b.status, 'applied'); assert.equal(f.writes(), 2);
  f.form.prompt = 'a'; await f.stack.undo(a.id);
  f.stack.removeConversation('ask-a'); assert.equal(f.stack.redo, null); assert.equal(f.stack.top, null);
});

test('W3 stack: retains only the latest 50 writes and cannot revert beyond the retained boundary', async () => {
  const f = fixture();
  for (let i = 1; i <= UNDO_LIMIT + 2; i++) await f.apply(f.image({ prompt: String(i) }));
  assert.equal(f.stack.records.length, UNDO_LIMIT); assert.equal(f.stack.records[0].id, 3);
  for (let i = 0; i < UNDO_LIMIT; i++) await f.stack.undo(f.stack.top.id);
  assert.equal(f.stack.top, null); assert.equal(f.form.prompt, '2');
});

test('W4 preflight: deeper mismatch prevents all writes even when the top can undo', async () => {
  const f = fixture(), a = await f.apply(f.image({ prompt: 'a' })), b = await f.apply(f.image({ negative: 'b' }));
  f.form.prompt = 'manual';
  const before = structuredClone(f.stack.records);
  assert.throws(() => f.stack.preflight([a.id, b.id]), /Prompt 已变化/);
  assert.deepEqual(f.stack.records, before); assert.equal(f.writes(), 2); assert.equal(f.form.negative, 'b');
});

test('W4 preflight: requires the global suffix, including interleaved conversations and evicted checkpoints', async () => {
  const f = fixture(), a = await f.apply(f.image({ prompt: 'a' })), b = await f.apply(f.image({ negative: 'b' }), 'ask-b'), c = await f.apply(f.image({ seed: '42' }));
  assert.throws(() => f.stack.preflight([a.id, c.id]), /先回退较新的草稿/);
  assert.deepEqual(f.stack.preflight([]), []);
  assert.deepEqual(f.stack.preflight([c.id]), [c.id]);
  assert.deepEqual(f.stack.preflight([a.id, b.id, c.id]), [c.id, b.id, a.id]);
  for (let i = 0; i < UNDO_LIMIT; i++) await f.apply(f.image({ prompt: String(i) }));
  assert.throws(() => f.stack.preflight([a.id, ...f.stack.records.map(r => r.id)]), /超出撤销保留范围/);
});

test('W4 preflight: mixed IMAGE, CHAT composer and branch simulation matches real rollback without mutating snapshots', async () => {
  const f = fixture(), beforeChat = chatSelection(f.current), beforeForm = { ...f.form };
  const records = [await f.apply(f.branch('A')), await f.apply(f.image({ prompt: 'image A' })), await f.apply(f.composer('B')), await f.apply(f.branch('C')), await f.apply(f.image({ negative: 'image B' }))];
  const snapshot = { form: { ...f.form }, current: structuredClone(f.current), records: structuredClone(f.stack.records) };
  const order = f.stack.preflight(records.map(r => r.id));
  assert.deepEqual({ form: f.form, current: f.current, records: f.stack.records }, snapshot); assert.equal(f.writes(), 5);
  for (const id of order) await f.stack.undo(id);
  assert.deepEqual(f.form, beforeForm); assert.deepEqual(chatSelection(f.current), beforeChat); assert.equal(f.writes(), 10);
});

test('W4 preflight: checks CHAT identity and exact external branch state before any rollback', async () => {
  for (const change of [c => c.id = 'other', c => c.selectionRevision++, c => c.keepIds.push('manual')]) {
    const f = fixture(), a = await f.apply(f.branch('A')), b = await f.apply(f.image({ prompt: 'b' }));
    change(f.current);
    assert.throws(() => f.stack.preflight([a.id, b.id]), /对话已切换|对话分支已变化/);
    assert.equal(f.writes(), 2); assert.equal(f.form.prompt, 'b');
  }
});

test('W4 removal: clears removed turns and their redo, preserves unrelated history with no writes', async () => {
  const f = fixture(), a = await f.apply(f.image({ prompt: 'a' }), 'ask-a'), b = await f.apply(f.image({ prompt: 'b' }), 'ask-b');
  await f.stack.undo(b.id);
  f.stack.removeTurns('ask-a', new Set([99])); assert.equal(f.stack.top, a); assert.equal(f.stack.redo, b);
  f.stack.removeTurns('ask-b', new Set([1])); assert.equal(f.stack.top, a); assert.equal(f.stack.redo, null);
  assert.equal(f.writes(), 3); assert.equal(f.form.prompt, 'a');
});

test('H3 stack: a handoff opens its own conversation, undo returns to the source, and simulation matches', async () => {
  const f = fixture(), source = f.current;
  const a = await f.apply(f.composer('source text'));
  const h = await f.apply(f.handoff('new text', [{ label: '#c1.1', source: 'chat', ref: 'asset-1' }]));
  assert.notEqual(f.current, source); assert.equal(f.current.prompt, 'new text'); assert.equal(f.conversations.length, 2);
  assert.equal(h.beforeReceipt, chatDraftKey(source)); assert.equal(JSON.parse(h.receipt)[0], f.current.id);
  const snapshot = structuredClone({ conversations: f.conversations, current: f.current });
  assert.deepEqual(f.stack.preflight([a.id, h.id]), [h.id, a.id]);
  assert.deepEqual({ conversations: f.conversations, current: f.current }, snapshot);
  await f.stack.undo(h.id); assert.equal(f.current, source); assert.equal(f.conversations.length, 1);
  await f.stack.restore(h.id); assert.equal(f.current.prompt, 'new text'); assert.equal(f.conversations.length, 2);
  await f.stack.undo(h.id); await f.stack.undo(a.id); assert.equal(source.prompt, '');
});

test('H3 stack: an edited or deleted handoff conversation cannot be undone; a reused blank one is emptied', async () => {
  const f = fixture(), h = await f.apply(f.handoff('new text'));
  assert.equal(f.conversations.length, 1, 'the blank conversation is reused');
  f.current.settings = { model: 'gpt-image', options: { size: '1024x1024' } };
  await assert.rejects(f.stack.undo(h.id), /新对话已继续编辑/);
  assert.throws(() => f.stack.preflight([h.id]), /新对话已继续编辑/);
  f.current.settings = { model: 'gpt-image', options: { size: '1536x1024' } };
  await f.stack.undo(h.id); assert.equal(isBlank(f.current), true); assert.deepEqual(f.current.settings, {});
  await f.stack.restore(h.id);
  const opened = f.current;
  f.conversations = [newConversation()]; f.current = f.conversations[0];
  await assert.rejects(f.stack.undo(h.id), /新对话已删除/);
  f.conversations = [opened]; f.current = opened;
  assert.equal(f.writer.canUndo(h.plan, h.receipt), true);
});
