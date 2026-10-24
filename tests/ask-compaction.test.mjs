import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/ask/session.ts';
import { runCompaction } from '../src/ask/compact/run.ts';
import { createAttachments, attachmentBlocks } from '../src/ask/attachments.ts';
import { restoreSavedSession, createAskFavorites } from '../src/ask/favorites.ts';
import { createProvider, wireBody, ProviderError } from '../src/ask/provider.ts';
import { createConnections } from '../src/services/connections.ts';
import { createCodec } from '../src/ask/codec.ts';
import { createTools } from '../src/ask/tools.ts';
import { createCallLog, inspectCall } from '../src/ask/debug.ts';
import { openaiChatProfile, anthropicMessagesProfile } from '../src/gateway/profile.ts';
import { memoryMessages } from '../src/ask/compact/layout.ts';
import { readAskSettings } from '../src/ask/settings.ts';

const used = (input = 100) => ({ input, output: 10, cacheRead: 80, cacheWrite: 0 });
const state = '<workspace_state>\n{"form":{"prompt":"blue eyes"}}\n</workspace_state>';
const message = (q, attachments = []) => ({ role: 'user', content: [{ type: 'text', text: state }, ...attachmentBlocks(attachments, false), { type: 'text', text: q }] });
const reply = value => ({ role: 'assistant', content: [{ type: 'text', text: value }] });
const draft = { proposal: { title: '早期方案', steps: [] }, scope: ['Prompt'], delta: 'rewrite', status: 'applied' };
const commit = (session, n, attachments = [], meta = {}) => {
  const t = session.begin(message(`用户原话 ${n}`, attachments)); t.push(reply(`回答 ${n}。`)); t.record(used(100 + n));
  t.commit({ question: `用户原话 ${n}`, attachments: attachments.map(a => a.id), ...meta });
};
function fixture(count = 6) {
  const pool = createAttachments(), a = pool.add({ kind: 'text', text: '正文'.repeat(25_000), name: 'long.md', bytes: 50_000, mime: 'text/plain', pasted: false });
  const billed = [], session = createSession(u => billed.push(u));
  for (let n = 1; n <= count; n++) commit(session, n, n === 1 ? [a] : [], n === 1 ? { draft } : {});
  return { pool, a, session, billed };
}
const request = { model: 'synthetic', tools: [...createTools().values()].map(e => e.tool), system: ['System 1 · blue eyes', 'System 2'] };
const fake = (events = [{ type: 'text', text: '<memo>blue eyes 方案</memo>' }, { type: 'done', stop: 'end', usage: used(900) }]) => ({ calls: [],
  async *stream(req, options) { this.calls.push(req); options.signal.throwIfAborted(); for (const event of events) {
    if (event instanceof Error) throw event; yield event;
  } },
});
const options = (f, provider = fake(), extra = {}) => ({ session: f.session, provider, request,
  attachments: f.pool.get, signal: new AbortController().signal, ...extra });
const contextState = s => { const { usage, ...rest } = s.snapshot(); return rest; };
const withoutCache = data => JSON.parse(JSON.stringify(data, (key, value) => key === 'cache_control' ? undefined : value));
const marks = body => (JSON.stringify(body).match(/"cache_control":/g) ?? []).length;

async function realProvider(profile, makeResponse) {
  const store = new Map(), connections = createConnections({ getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, work => work());
  await connections.save({ version: 1, connections: { ask: { id: 'ask', name: '模拟推理', baseUrl: 'https://synthetic.example.test/v1', profileId: profile.id, credentialRef: 'key', revision: 'r1' } }, links: {} });
  connections.supplyKey('key', 'synthetic-key');
  const calls = [];
  const provider = createProvider(connections.context('ask'), async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(makeResponse(), { headers: { 'content-type': 'text/event-stream' } });
  });
  return { calls, provider };
}
const sse = (...events) => events.map(e => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
const response = (profile, text, usage = true, stop = 'end') => profile === openaiChatProfile
  ? sse({ choices: [{ delta: { content: text }, finish_reason: stop === 'end' ? 'stop' : 'content_filter' }], ...(usage ? { usage: { prompt_tokens: 1200, completion_tokens: 20 } } : {}) }, '[DONE]')
  : sse({ type: 'message_start', message: usage ? { usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 200 } } : {} },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text } }, { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: stop === 'end' ? 'end_turn' : 'refusal' }, ...(usage ? { usage: { output_tokens: 20 } } : {}) }, { type: 'message_stop' });

test('CP2 input: final completed call only, unknown overwrites old measurements, failed/cancelled billing stays separate', () => {
  const s = createSession();
  for (const [values, expected] of [[[used(100), used(500)], 500], [[used(20), null], null], [[used(30), used(0)], null], [[used(400)], 400]]) {
    const t = s.begin(message('q')); values.forEach(u => t.record(u)); t.push(reply('a')); t.commit();
    assert.equal(s.lastInputTokens, expected); assert.equal(s.records.at(-1).inputTokens, expected);
  }
  const sum = s.usage.input, failed = s.begin(message('失败')); failed.record(used(900)); failed.rollback();
  assert.equal(s.lastInputTokens, 400); assert.equal(s.usage.input, sum + 900); assert.equal(s.ledger.length, 4);
  const fork = s.fork(1); assert.equal(fork.lastInputTokens, 500); assert.equal(fork.usage.input, 0);
  s.truncate(2); assert.equal(s.lastInputTokens, null);
});

for (const profile of [openaiChatProfile, anthropicMessagesProfile]) test(`CP2 ${profile.protocol}: real provider conversion, one call, durable candidate, codec and 3→4 breakpoints`, async () => {
  const f = fixture(), codec = createCodec([], [{ from: 'blue eyes', to: 'synthetic-blue' }]);
  const { calls, provider } = await realProvider(profile, () => response(profile, '<memo>synthetic-blue 方案 <tag></memo>'));
  const before = contextState(f.session), usageBefore = f.session.usage, history = f.session.requestHistory();
  const log = createCallLog(() => {}); let id, persisted;
  const result = await runCompaction(options(f, provider, { codec, observe(event) {
    if (event.type === 'request') id = log.start({ conversation: 'c', turn: 0, step: 1, question: '压缩上下文', purpose: 'compaction', connection: 'mock', protocol: profile.protocol, model: request.model, promptVersion: 'test.k7' }, event.body);
    else log.finish(id, event);
  }, persist: async candidate => {
    assert.deepEqual(contextState(f.session), before); assert.equal(f.session.busy, true);
    assert.equal(candidate.archive.length, 3); assert.equal(candidate.turns.length, 3);
    persisted = structuredClone({ session: candidate, entries: [], attachments: f.pool.snapshot([f.a.id]) });
  } }));
  assert.equal(result.status, 'compacted'); assert.equal(calls.length, 1); assert.equal(f.session.turns, 6);
  assert.equal(f.session.lastInputTokens, 106); assert.equal(f.session.turnsSinceCompaction, 0);
  assert.equal(f.session.usage.input, usageBefore.input + 1200);
  assert.equal(f.session.memory.memo, 'blue eyes 方案 <tag>');
  assert.match(f.session.memory.text, /‹tag>/); assert.doesNotMatch(JSON.stringify(f.session.archive), /正文正文/);
  const pre = wireBody(profile, { ...request, maxTokens: 4096, messages: history }, codec), actual = calls[0];
  assert.deepEqual(actual.tools, pre.tools);
  assert.deepEqual(withoutCache(actual.messages.slice(0, pre.messages.length)), withoutCache(pre.messages));
  assert.ok(!('tool_choice' in actual));
  if (profile === anthropicMessagesProfile) { assert.deepEqual(actual.system, pre.system); assert.equal(actual.max_tokens, 8192); assert.equal(marks(actual), 3); }
  else assert.ok(!('max_tokens' in actual) && !('max_completion_tokens' in actual));
  const pending = f.session.begin(message('下一轮'));
  const next = wireBody(profile, { ...request, maxTokens: 4096, messages: pending.messages() }, codec);
  assert.equal(marks(next), profile === anthropicMessagesProfile ? 4 : 0);
  if (profile === anthropicMessagesProfile) {
    assert.ok(next.messages[0].content[0].cache_control); assert.ok(next.messages.at(-1).content.at(-1).cache_control);
  }
  assert.doesNotMatch(JSON.stringify(next), /"kind":"session_memory"/);
  assert.match(JSON.stringify(next), /session_memory/); assert.doesNotMatch(JSON.stringify(next), /正文正文/);
  pending.rollback();
  const restored = restoreSavedSession(persisted);
  assert.deepEqual(restored.snapshot(), persisted.session);
  assert.equal(restored.recall({ attachments: ['text-1'], offset: 48_000 }, id => persisted.attachments.find(a => a.id === id)).attachments[0].text.length, 2000);
  assert.equal(restored.recall({ turns: ['T1'], include: 'full' }, f.pool.get).turns[0].messages[0].content[0].text, state);
  assert.equal(restored.takeAfterCompaction(), true); assert.equal(restored.takeAfterCompaction(), false);
  assert.equal(log.get(id).purpose, 'compaction'); assert.equal(log.get(id).usage.input, 1200);
  assert.equal(JSON.parse(log.export()).calls[0].body, JSON.stringify(actual));
  assert.equal(inspectCall(log.get(id)).breakpoints.length, profile === anthropicMessagesProfile ? 3 : 0);
  f.pool.dispose();
});

test('CP2 second compaction: old memory prefix stays frozen; current ledger is merged at the new boundary', async () => {
  const f = fixture(); await runCompaction(options(f));
  const old = f.session.memory.text; f.session.updateDraft('T1', 'reverted');
  assert.equal(f.session.memory.text, old); assert.match(old, /"status":"applied"/);
  for (let n = 7; n <= 10; n++) commit(f.session, n);
  const provider = fake(); await runCompaction(options(f, provider));
  assert.equal(provider.calls.length, 1); assert.equal(provider.calls[0].messages[0].content[0].text, old);
  assert.equal(f.session.archive.length, 7); assert.equal(f.session.memory.through, 'T7');
  assert.match(provider.calls[0].messages.at(-1).content[0].text, /"status":"reverted"/);
  assert.match(f.session.memory.text, /"status":"reverted"/); assert.equal(f.session.ledger.length, 10);
  const recent = JSON.parse(f.session.memory.text.match(/<recent_user>\n([\s\S]*?)\n<\/recent_user>/)[1]);
  assert.deepEqual(recent.map(x => x.turnId), ['T5', 'T6', 'T7']);
  f.pool.dispose();
});

test('CP2 failures: truncation, missing memo, empty output, refusal, tool call, unfinished stream and network leave no candidate', async () => {
  const done = stop => ({ type: 'done', stop, usage: used(900) });
  for (const events of [
    [{ type: 'text', text: '<memo>x</memo>' }, done('length')], [{ type: 'text', text: '<memo>open' }, done('end')], [done('end')],
    [{ type: 'text', text: '<memo>x</memo>' }, done('refusal')],
    [{ type: 'text', text: '<memo>x</memo>' }, { type: 'call', call: { name: 'propose_draft', input: {} } }, done('tool')],
    [{ type: 'text', text: '<memo>complete but no done</memo>' }], [new ProviderError('network', 'synthetic outage')],
  ]) {
    const f = fixture(), before = contextState(f.session), billed = f.session.usage.input, provider = fake(events); let persisted = false;
    await assert.rejects(runCompaction(options(f, provider, { persist: async () => { persisted = true; } })));
    assert.deepEqual(contextState(f.session), before); assert.equal(f.session.busy, false); assert.equal(persisted, false); assert.equal(provider.calls.length, 1);
    assert.equal(f.session.usage.input, billed + (events.some(e => e.type === 'done') ? 900 : 0));
    assert.equal(f.pool.get(f.a.id).text.length, 50_000); f.pool.dispose();
  }
});

test('CP2 storage failure and cancellation: locked session stays old until durable success; late stop cannot split a committed save', async () => {
  for (const mode of ['reject', 'cancel', 'late-stop']) {
    const f = fixture(), before = contextState(f.session), abort = new AbortController(); let release, entered;
    const gate = new Promise(r => { release = r; }), saving = new Promise(r => { entered = r; });
    const job = runCompaction(options(f, fake(), { signal: abort.signal, persist: async (candidate, signal) => {
      assert.equal(candidate.archive.length, 3); entered(); await gate;
      if (mode === 'reject') throw new Error('disk full');
      signal.throwIfAborted();
      if (mode === 'late-stop') abort.abort(new DOMException('after durable commit', 'AbortError'));
    } }));
    await saving;
    assert.deepEqual(contextState(f.session), before); assert.equal(f.session.busy, true);
    assert.throws(() => f.session.begin(message('collision')), /尚未结束/);
    assert.throws(() => f.session.fork(1), /运行中/); assert.throws(() => f.session.truncate(1), /运行中/);
    assert.throws(() => f.session.updateDraft('T1', 'reverted'), /运行中/);
    if (mode === 'cancel') abort.abort(new DOMException('stop during save', 'AbortError'));
    release();
    if (mode === 'late-stop') assert.equal((await job).status, 'compacted');
    else { await assert.rejects(job); assert.deepEqual(contextState(f.session), before); }
    assert.equal(f.session.busy, false); f.pool.dispose();
  }
});

test('CP2 cancellation: aborted/late provider output cannot commit or start a retry', async () => {
  const f = fixture(), before = contextState(f.session), abort = new AbortController(); let release;
  const gate = new Promise(r => { release = r; }); let calls = 0;
  const provider = { async *stream() { calls++; await gate; yield { type: 'text', text: '<memo>迟到</memo>' }; yield { type: 'done', stop: 'end', usage: used() }; } };
  const job = runCompaction(options(f, provider, { signal: abort.signal }));
  abort.abort(new DOMException('stop', 'AbortError')); release(); await assert.rejects(job, e => e.name === 'AbortError');
  assert.deepEqual(contextState(f.session), before); assert.equal(calls, 1);
  await assert.rejects(runCompaction(options(f, provider, { signal: abort.signal }))); assert.equal(calls, 1);
  f.pool.dispose();
});

test('CP2 archive edit/fork groundwork: restore original text, clear memory and input measurement, keep stable counters', async () => {
  const f = fixture(); await runCompaction(options(f)); const mem = f.session.memory;
  const fork = f.session.fork(2, f.pool.get);
  assert.equal(fork.memory, null); assert.equal(fork.lastInputTokens, null); assert.equal(fork.archiveRebuild, true);
  assert.equal(fork.turns, 2); assert.match(JSON.stringify(fork.messages), /正文正文/);
  assert.equal(fork.nextTurnId, 'T7'); assert.equal(fork.usage.input, 0); assert.equal(f.session.memory, mem);
  assert.equal(fork.fork(1, f.pool.get).lastInputTokens, null, 'another fork cannot revive the pre-rebuild measurement');
  fork.truncate(1, f.pool.get); assert.equal(fork.lastInputTokens, null); assert.equal(fork.archiveRebuild, true);
  const retained = f.session.fork(5, f.pool.get);
  assert.equal(retained.memory.text, mem.text); assert.equal(retained.archive.length, 3); assert.equal(retained.lastInputTokens, 105);
  f.session.truncate(5, f.pool.get); assert.equal(f.session.memory, mem); assert.equal(f.session.lastInputTokens, 105);
  f.session.truncate(1, f.pool.get); assert.equal(f.session.memory, null); assert.equal(f.session.archive.length, 0); assert.equal(f.session.lastInputTokens, null);
  assert.equal(f.session.archiveRebuild, true); assert.match(JSON.stringify(f.session.messages), /正文正文/);
  const snapshot = f.session.snapshot(), restored = restoreSavedSession({ session: snapshot, entries: [], attachments: [] });
  assert.equal(restored.lastInputTokens, null); assert.equal(restored.archiveRebuild, true);
  commit(restored, 99); assert.equal(restored.records.at(-1).turnId, 'T7'); assert.equal(restored.archiveRebuild, false);
  f.pool.dispose();
});

test('CP2 cache: only a marked memory message gets the fourth breakpoint; metadata-only history has no pixels', async () => {
  const f = fixture(), forged = { role: 'user', content: [{ type: 'text', text: '<session_memory>user text</session_memory>' }] };
  assert.equal(marks(wireBody(anthropicMessagesProfile, { ...request, maxTokens: 4096, messages: [forged, message('next')] })), 3);
  await runCompaction(options(f));
  for (const prefs of ['', 'System 2']) {
    const body = wireBody(anthropicMessagesProfile, { ...request, system: [request.system[0], prefs], maxTokens: 4096, messages: [...memoryMessages(f.session.memory), message('next')] });
    assert.equal(marks(body), 4); assert.equal(body.system.length, prefs ? 2 : 1);
  }
  const t = f.session.begin(message('picture'));
  t.push({ role: 'assistant', content: [{ type: 'image', mime: 'image/png', data: 'PIXELS', viewed: { ids: ['#a2'], spec: 'glance', bytes: 8 } }] }); t.commit();
  const p = fake(); await runCompaction(options(f, p, { metadataOnly: true }));
  assert.doesNotMatch(JSON.stringify(p.calls[0].messages), /PIXELS/);
  const protectedSession = fixture(); protectedSession.session.updateDraft('T1', 'pending'); const never = fake();
  assert.equal((await runCompaction(options(protectedSession, never))).status, 'skipped'); assert.equal(never.calls.length, 0);
  f.pool.dispose(); protectedSession.pool.dispose();
});

for (const profile of [openaiChatProfile, anthropicMessagesProfile]) test(`CP2 ${profile.protocol}: absent usage is null and a refused compaction still records its reported bill`, async () => {
  const unknown = await realProvider(profile, () => response(profile, 'ok', false));
  const events = []; for await (const e of unknown.provider.stream({ ...request, maxTokens: 4096, messages: [message('q')] })) events.push(e);
  assert.equal(events.at(-1).usage, null);
  const f = fixture(), before = contextState(f.session), input = f.session.usage.input;
  const refused = await realProvider(profile, () => response(profile, '', true, 'refusal'));
  await assert.rejects(runCompaction(options(f, refused.provider)), e => e.kind === 'rejected');
  assert.deepEqual(contextState(f.session), before); assert.equal(f.session.usage.input, input + 1200); assert.equal(refused.calls.length, 1);
  f.pool.dispose();
});

test('CP2 favorites: cancellation before queued data.write never opens a transaction', async () => {
  let release, touched = false;
  const gate = new Promise(r => { release = r; }), abort = new AbortController();
  const store = createAskFavorites({ databases: { transaction() { touched = true; throw new Error('must not open'); } }, data: { async write(work) { await gate; return work(); } } });
  const saving = store.write([{ id: 'saved' }], [], undefined, abort.signal);
  abort.abort(new DOMException('stop', 'AbortError')); release();
  await assert.rejects(saving, e => e.name === 'AbortError'); assert.equal(touched, false);
});

test('CP3 settings: fixed high water, positive safe integers, independent attachment limits and round trip', () => {
  for (const value of [undefined, null, '', '96000', 0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(readAskSettings({ compaction: { highWaterTokens: value } }).compaction.highWaterTokens, 64000);
  const s = readAskSettings({ compaction: { highWaterTokens: 96000 }, textAttachments: { chars: 4000, totalChars: 8000 } });
  assert.equal(s.compaction.highWaterTokens, 96000);
  assert.deepEqual(readAskSettings(JSON.parse(JSON.stringify(s))), s);
  assert.equal(s.textAttachments.chars, 4000);
});

test('CP3 archive check: reading the trigger does not consume it; proceeding to a normal request does', async () => {
  const f = fixture(); await runCompaction(options(f));
  const restored = f.session.fork(2, f.pool.get);
  assert.equal(restored.archiveRebuild, true); assert.equal(restored.lastInputTokens, null);
  restored.checkedArchive();
  assert.equal(restored.archiveRebuild, false); assert.equal(restored.lastInputTokens, null);
  assert.equal(restored.memory, null); assert.match(JSON.stringify(restored.messages), /正文正文/);
  f.pool.dispose();
});
