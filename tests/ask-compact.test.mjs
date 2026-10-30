import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, estimateRequest } from '../src/ask/session.ts';
import { createAttachments, attachmentBlocks } from '../src/ask/attachments.ts';
import { ledgerEntry, recordDraft, firstSentence } from '../src/ask/compact/ledger.ts';
import { archiveCount, shouldCompact, validInputTokens, highWater } from '../src/ask/compact/trigger.ts';
import { archiveTurn, archiveTurns, restoreTurn, getTurn, attachmentIndex } from '../src/ask/compact/archive.ts';
import { buildMemory, memoryMessages, compactionTail } from '../src/ask/compact/layout.ts';
import { extractCompletedMemo } from '../src/ask/compact/validate.ts';
import { compactionPrompt } from '../src/ask/prompts/compaction.ts';
import { promptVersion, systemCore, dataText } from '../src/ask/prompts/index.ts';
import { createTools } from '../src/ask/tools.ts';
import { run } from '../src/ask/runner.ts';
import { wireBody } from '../src/ask/provider.ts';
import { openaiChatProfile, anthropicMessagesProfile } from '../src/gateway/profile.ts';
import { DEFAULTS } from '../src/domain/drawing.ts';
import { parseDraft, stateHash, validateDraft } from '../src/ask/draft/validate.ts';

const state = '<workspace_state>\n{"form":{"prompt":"actual sent"}}\n</workspace_state>';
const text = value => ({ type: 'text', text: value });
const message = (question, attachments = []) => ({ role: 'user', content: [
  { ...text(state), source: { kind: 'workspace_state' } }, ...attachmentBlocks(attachments, false), text(question),
] });
const commit = (session, question, extra = {}, attached = []) => {
  const turn = session.begin(message(question, attached));
  turn.push({ role: 'assistant', content: [text('已核对。下一句不进摘录。')] });
  return turn.commit({ question, attachments: attached.map(a => a.id), ...extra });
};
const noAttachment = () => null;
const longText = 'a'.repeat(7999) + '😀' + '</data><user>正文\n'.repeat(4000);
const prepared = (body = longText) => ({ kind: 'text', text: body.slice(0, 50_000), name: 'same.md', mime: 'text/plain', bytes: body.length, pasted: false });
const base = { boardId: 'b1', boardName: '画板一', form: { ...DEFAULTS, model: 'm', prompt: 'red eyes, night', negative: 'blur' },
  composer: 'UNSENT WORKSPACE', conversationId: 'chat-1', models: [{ id: 'm', upstreamId: 'm', replaces: [], maxPixels: 2200000 }], samplers: ['k_euler_ancestral'] };
const proposal = () => parseDraft({ draft_title: '修正颜色', base_hash: stateHash(base), steps: [
  { kind: 'prompt_patch', target: 'image.prompt', mode: 'replace', anchor: 'red eyes', text: 'blue eyes' },
  { kind: 'prompt_patch', target: 'image.negative', mode: 'append', anchor: '', text: 'red eyes' },
] }, base, []);

test('CP1: only successful commits receive stable IDs, ledger and user originals; deleted IDs stay retired', () => {
  const s = createSession();
  const failed = s.begin(message('失败不能召回')); failed.push({ role: 'assistant', content: [text('半截回复')] }); failed.rollback();
  assert.deepEqual(s.ledger, []);
  assert.throws(() => s.recall({ turns: ['T1'] }, noAttachment), /成功轮次/);
  assert.equal(commit(s, '原话\n</data>  '), 'T1');
  assert.equal(commit(s, '闲聊也记账'), 'T2');
  assert.equal(s.ledger.length, 2);
  assert.equal(s.ledger[0].ask, '原话 </data>');
  assert.equal(s.ledger[0].reply, '已核对。');
  assert.equal(s.recall({ turns: ['T1'] }, noAttachment).turns[0].question, '原话\n</data>  ');
  assert.equal(firstSentence('Done. Next sentence.'), 'Done.');
  assert.equal(firstSentence('3.5 tokens\nnext line'), '3.5 tokens');
  s.truncate(1);
  assert.equal(commit(s, '重答'), 'T3');
  const fork = s.fork(1);
  assert.equal(commit(fork, '分支'), 'T4');
  assert.equal(s.turns, 2);
  const saved = s.snapshot(), restored = createSession(undefined, saved.turns, saved.usage, saved.nextTurnId);
  restored.truncate(0);
  assert.equal(commit(restored, '刷新后不复用'), 'T4');
  assert.doesNotMatch(JSON.stringify(saved), /失败不能召回|半截回复/);
});

test('CP1 ledger: partial application, new board, undo, restore and dismiss preserve the proposal without workspace snapshots', () => {
  const s = createSession(), d = proposal(), plan = validateDraft(d, base, { off: new Set() });
  commit(s, '只改眼睛', { draft: recordDraft(d, plan), targets: ['#h1', '#h1'], boards: ['b1'] });
  assert.equal(s.ledger[0].draft.status, 'pending');
  assert.equal(s.fork(1).ledger[0].draft.status, 'dismissed', 'fork clears the pending card only in the branch');
  assert.equal(s.ledger[0].draft.status, 'pending');
  assert.deepEqual(s.ledger[0].targets, ['#h1']);
  const memory = buildMemory(s.records, s.ledger, [], '归档边界时待确认'), frozen = memory.text;
  const partial = validateDraft(d, base, { off: new Set([plan.steps[1].id]) });
  s.updateDraft('T1', 'applied', { ...partial, createdBoard: { id: 'b-new' } });
  assert.equal(s.ledger[0].draft.status, 'applied');
  assert.equal(s.ledger[0].draft.applied_to, 'b-new');
  assert.deepEqual(s.ledger[0].boards, ['b1', 'b-new']);
  assert.equal(s.records[0].draft.applied.changes.length, 1);
  assert.equal(s.ledger[0].draft.scope.length, 1);
  s.updateDraft('T1', 'reverted'); assert.equal(s.ledger[0].draft.status, 'reverted');
  assert.equal(memory.text, frozen);
  assert.match(buildMemory(s.records, s.ledger, [], '后来已回退').text, /reverted/);
  s.updateDraft('T1', 'applied'); assert.equal(s.ledger[0].draft.status, 'applied');
  const fork = s.fork(1); fork.updateDraft('T1', 'dismissed');
  assert.equal(s.ledger[0].draft.status, 'applied'); assert.equal(fork.ledger[0].draft.status, 'dismissed');
  const full = s.recall({ turns: ['T1'], include: 'full' }, noAttachment).turns[0];
  assert.equal(full.messages[0].content[0].text, state);
  assert.equal(full.draft.proposal.steps.length, 2);
  assert.doesNotMatch(JSON.stringify(full), /UNSENT WORKSPACE|"base":|"models":|"source":\{"kind"/);
});

test('CP1 archive: only attributed text bodies are extracted; images stay dehydrated and tools stay paired', () => {
  const pool = createAttachments(), a = pool.add(prepared()), b = pool.add(prepared('another body'));
  const s = createSession(), t = s.begin(message('same.md 普通提问\n' + a.text.slice(0, 20), [a, b]));
  t.push({ role: 'assistant', content: [{ type: 'call', id: 'look', name: 'view_image', input: { id: '#h1' } }] });
  t.push({ role: 'user', content: [{ type: 'result', id: 'look', content: [{ type: 'image', mime: 'image/png', data: 'PIXELS', viewed: { ids: ['#h1'], spec: 'glance', bytes: 8 } }] }] });
  t.commit({ attachments: [a.id, b.id] });
  const before = JSON.stringify(s.records), archived = archiveTurns(s.records, pool.get);
  assert.equal(JSON.stringify(s.records), before, 'candidate construction never mutates the live session');
  assert.equal(archived.texts[0], a, 'reuse the resource body instead of a duplicate payload');
  assert.equal(archived.index[0].total_chars, 50_000);
  const record = archived.turns[0];
  assert.doesNotMatch(JSON.stringify(record.messages), /PIXELS|another body/);
  assert.match(record.messages[0].content[1].text, /text-1.*50000/);
  assert.match(record.messages[0].content.at(-1).text, /same.md 普通提问/);
  assert.equal(record.messages[1].content[0].id, record.messages[2].content[0].id);
  const restored = restoreTurn(record, pool.get);
  assert.deepEqual(restored.messages[0], s.records[0].messages[0]);
  assert.doesNotMatch(JSON.stringify(restored), /PIXELS/);
  assert.throws(() => archiveTurn(s.records[0], noAttachment), /不可用/);
  pool.dispose();
});

test('CP1 get_turn: 50,000 characters roundtrip in 8,000-character pages, including surrogate and XML boundaries', () => {
  const pool = createAttachments(), a = pool.add(prepared()), s = createSession();
  commit(s, '附件问题', {}, [a]);
  let offset = 0, output = '', pages = 0;
  do {
    const r = s.recall({ attachments: [a.id], offset }, pool.get).attachments[0];
    assert.equal(r.total_chars, 50_000); assert.equal(r.offset, offset); assert.ok(r.text.length <= 8000);
    output += r.text; offset = r.next_offset; pages++;
  } while (offset !== null);
  assert.equal(output, a.text); assert.equal(pages, 7);
  assert.equal(s.recall({ attachments: [a.id], offset: 50_000 }, pool.get).attachments[0].text, '');
  const full = s.recall({ turns: ['T1'], include: 'full' }, pool.get);
  assert.equal(full.turns[0].messages[0].content[0].text, state);
  assert.doesNotMatch(JSON.stringify(full), /aaaaaa/);
  assert.ok(JSON.stringify(full).length < 2000);
  pool.dispose();
});

test('CP1 get_turn: explicit offset requires exactly one text attachment; scope never comes from a shared pool', () => {
  const pool = createAttachments(), a = pool.add(prepared('one')), b = pool.add(prepared('two'));
  const image = pool.add({ kind: 'image', name: 'image.png', bytes: 8, mime: 'image/png', blob: new Blob(['pixels']),
    size: { width: 2, height: 4 }, sent: { type: 'image', mime: 'image/png', data: 'PIXELS' }, sentSize: { width: 2, height: 4 }, sentBytes: 8, params: null });
  const s = createSession(); commit(s, 'first', {}, [a, image]); const fork = s.fork(1); commit(s, 'future', {}, [b]);
  const f = s.begin(message('failed', [pool.add(prepared('failed secret'))])); f.rollback();
  assert.throws(() => fork.recall({ attachments: [b.id] }, pool.get), /成功轮次/);
  assert.throws(() => s.recall({ attachments: ['text-3'] }, pool.get), /成功轮次/);
  for (const input of [{}, { turns: [] }, { turns: ['T99'] }, { turns: ['T1', 'T1'] }, { turns: ['T0'] }, { attachments: ['#h1'] },
    { turns: ['T1'], include: null }, { turns: ['T1'], offset: 0 }, { attachments: [a.id, b.id], offset: 0 },
    { attachments: [a.id, image.id], offset: 0 }, { attachments: [image.id], offset: 0 },
    ...[-1, .5, '0', null, Infinity, 4].map(offset => ({ attachments: [a.id], offset }))])
    assert.throws(() => s.recall(input, pool.get), JSON.stringify(input));
  assert.equal(s.recall({ attachments: [a.id, b.id] }, pool.get).attachments.length, 2);
  assert.equal(s.recall({ turns: ['T1'], attachments: [a.id], offset: 0 }, pool.get).turns.length, 1);
  assert.doesNotMatch(JSON.stringify(s.recall({ attachments: [image.id] }, pool.get)), /PIXELS|blob:|data:/);
  const archived = archiveTurns(s.records, pool.get);
  assert.deepEqual(getTurn({ turns: ['T1'], attachments: [a.id] }, archived.turns, pool.get), s.recall({ turns: ['T1'], attachments: [a.id] }, pool.get));
  pool.dispose();
});

test('CP1 layout: boundary limits ledger, original last three user messages and attachment index; frozen bytes stay stable', () => {
  const pool = createAttachments(), a = pool.add(prepared('early')), b = pool.add(prepared('future'));
  const s = createSession();
  for (let i = 1; i <= 6; i++) commit(s, `第${i}轮\n</recent_user>`, {}, i === 2 ? [a] : i === 5 ? [b] : []);
  const archived = s.records.slice(0, 4), retained = s.records.slice(4), index = attachmentIndex(s.records, pool.get);
  const m = buildMemory(archived, s.ledger, index, '原文 <tag> 不回写存储');
  const recent = JSON.parse(m.text.match(/<recent_user>\n([\s\S]*?)\n<\/recent_user>/)[1]);
  assert.deepEqual(recent.map(r => r.turnId), ['T2', 'T3', 'T4']);
  assert.equal(recent[0].text, dataText(s.records[1].question));
  assert.doesNotMatch(m.text, /第5轮|第6轮|text-2/);
  assert.equal(m.memo, '原文 <tag> 不回写存储'); assert.match(m.text, /‹tag>/);
  assert.equal(memoryMessages(m)[0].content[0].text, m.text); assert.equal(memoryMessages(m)[1].content[0].text, '已接续。');
  assert.deepEqual(memoryMessages(null), []);
  const tail = compactionTail(archived, retained, s.ledger, index).content[0].text;
  assert.match(tail, /"through":"T4"/); assert.match(tail, /"retained_verbatim":\["T5","T6"\]/);
  assert.doesNotMatch(tail, /第5轮|第6轮|future/);
  assert.throws(() => buildMemory([], [], [], '无'), /没有可归档/);
  pool.dispose();
});

test('CP1 triggers: real normalized input, fixed threshold and the archive-rebuild-only estimation exception', () => {
  assert.equal(highWater(), 220_000); assert.equal(highWater(1234), 1234); assert.equal(highWater(-1), 220_000);
  for (const usage of [null, { input: 0, cacheRead: 80 }, { input: NaN }, { input: Infinity }]) assert.equal(validInputTokens(usage), null);
  assert.equal(validInputTokens({ input: 100, output: 4, cacheRead: 80, cacheWrite: 10 }), 100);
  const normal = { totalTurns: 4, turnsSinceCompaction: 4, archiveCount: 1, lastInputTokens: 220_000 };
  assert.equal(shouldCompact(normal), true);
  for (const extra of [{ lastInputTokens: null }, { lastInputTokens: 219_999 }, { turnsSinceCompaction: 3 }, { totalTurns: 3 }, { archiveCount: 0 }])
    assert.equal(shouldCompact({ ...normal, ...extra }), false);
  assert.equal(shouldCompact({ ...normal, lastInputTokens: null, manual: true }), true);
  assert.equal(shouldCompact({ ...normal, lastInputTokens: null, estimatedTokens: 90_000 }), false, 'ordinary estimates never trigger');
  const restoredMessages = Array.from({ length: 2 }, () => message('字'.repeat(110_000)));
  const estimatedTokens = estimateRequest({ messages: restoredMessages, tools: [], system: ['', ''] });
  assert.equal(shouldCompact({ ...normal, totalTurns: 2, turnsSinceCompaction: 0, lastInputTokens: null, archiveRebuild: { estimatedTokens } }), true);
  assert.equal(shouldCompact({ ...normal, lastInputTokens: null, archiveRebuild: { estimatedTokens: 220_000 } }), false);
  assert.equal(shouldCompact({ ...normal, archiveCount: 0, archiveRebuild: { estimatedTokens } }), false);
});

test('CP1 retention: complete suffix shrinks 3→2→1 and pending drafts protect their entire suffix', () => {
  const sized = values => values.map((n, i) => ({ turnId: `T${i + 1}`, messages: [message('字'.repeat(n))] }));
  assert.equal(archiveCount(sized([1, 1, 1, 1, 1, 1])), 3);
  assert.equal(archiveCount(sized([1, 1, 1, 10_000, 10_000, 10_000])), 3);
  assert.equal(archiveCount(sized([1, 1, 1, 10_000, 10_000, 10_000]), 64_000), 4);
  assert.equal(archiveCount(sized([1, 1, 1, 1, 20_000, 20_000]), 64_000), 5);
  assert.equal(archiveCount(sized([1, 1, 1, 1, 20_000, 20_000]), 64_000, ['T2']), 1);
  assert.equal(archiveCount(sized([1, 1, 1, 1]), 64_000, ['T1']), 0);
  assert.equal(archiveCount(sized([90_000])), 0);
  assert.equal(archiveCount([]), 0);
});

test('CP1 memo v7: completed non-length memo required; scope instruction stays outside the ordinary System', () => {
  assert.equal(extractCompletedMemo('开场\n<memo>原文 <tag></memo>\n结束', 'end'), '原文 <tag>');
  for (const [body, stop, calls] of [['<memo>x</memo>', 'length'], ['<memo>x</memo>', 'refusal'], ['<memo>x</memo>', 'end', true], ['<memo>x', 'end'], ['<memo> </memo>', 'end'], ['', 'other']])
    assert.throws(() => extractCompletedMemo(body, stop, calls));
  assert.equal(compactionPrompt.version, 8); assert.match(promptVersion, /\.k8$/);
  assert.match(compactionPrompt.instruction, /成立的具体前提/); assert.match(compactionPrompt.instruction, /画风基底/);
  assert.match(compactionPrompt.instruction, /截至归档边界/); assert.doesNotMatch(compactionPrompt.instruction, /截至目前|尽量按原话复述/);
  assert.match(compactionPrompt.instruction, /不复述、引用或改写这些原话/);
  assert.match(compactionPrompt.instruction, /边界之后的轮次以原文保留，不在此整理/);
  assert.ok(!systemCore({ adult: false }).includes(compactionPrompt.instruction));
});

test('CP1 tool: regular runner budget, data wrapping and wire omission of local text provenance', async () => {
  const pool = createAttachments(), a = pool.add(prepared('字 <tag>')), s = createSession();
  commit(s, '原话', {}, [a]);
  const tools = createTools(), entry = tools.get('get_turn'), signal = new AbortController().signal;
  const context = { signal, metadataOnly: false, state: () => ({ text: state, images: 0 }), recall: input => s.recall(input, pool.get) };
  const outcome = entry.run({ attachments: [a.id] }, context);
  assert.match(outcome.content[0].text, /^<data>\n/); assert.match(outcome.content[0].text, /字 ‹tag>/);
  assert.equal(entry.final, undefined);
  let step = 0;
  const t = s.begin(message('召回原话'));
  async function* stream() {
    if (step++ < 7) yield { type: 'call', call: { type: 'call', id: `call${step}`, name: 'get_turn', input: { turns: ['T1'] } } };
    else yield { type: 'text', text: '已回顾。' };
    yield { type: 'done', stop: 'end', usage: null };
  }
  const request = { model: 'mock', system: [systemCore({ adult: false }), ''], maxTokens: 8192, tools: [...tools.values()].map(t => t.tool) };
  const events = []; for await (const event of run({ stream, request, turn: t, tools, context, signal })) events.push(event);
  assert.equal(events.filter(e => e.type === 'tool-end' && e.ok).length, 6);
  assert.match(events.find(e => e.type === 'tool-end' && !e.ok).reason, /上限/); t.rollback();
  for (const profile of [openaiChatProfile, anthropicMessagesProfile]) {
    const body = wireBody(profile, { ...request, messages: s.messages });
    assert.doesNotMatch(JSON.stringify(body), /"source":\{"kind"|"archived":/);
    assert.doesNotMatch(JSON.stringify(body.tools), /uniqueItems/);
    if (profile === openaiChatProfile) assert.ok(!('max_tokens' in body) && !('max_completion_tokens' in body));
    else assert.equal(body.max_tokens, 8192);
  }
  pool.dispose();
});

test('CP1 full recall: earlier get_turn attachment pages are indexed too and rehydrate exactly', () => {
  const pool = createAttachments(), a = pool.add(prepared()), s = createSession();
  commit(s, '读入附件', {}, [a]);
  const entry = createTools().get('get_turn'), outcome = entry.run({ attachments: [a.id], offset: 8000 }, { recall: input => s.recall(input, pool.get) });
  const t = s.begin(message('继续读'));
  t.push({ role: 'assistant', content: [{ type: 'call', id: 'recall', name: 'get_turn', input: { attachments: [a.id], offset: 8000 } }] });
  t.push({ role: 'user', content: [{ type: 'result', id: 'recall', content: outcome.content }] });
  t.push({ role: 'assistant', content: [text('已读')] }); t.commit();
  const full = s.recall({ turns: ['T2'], include: 'full' }, pool.get);
  assert.ok(JSON.stringify(full).length < 2000);
  assert.doesNotMatch(JSON.stringify(full), /正文\\n正文|正文.*正文.*正文/);
  const archived = archiveTurn(s.records[1], pool.get);
  assert.deepEqual(restoreTurn(archived, pool.get).messages, s.records[1].messages);
  pool.dispose();
});

test('CP1 existing Koma favorite: read missing IDs and attachment provenance without changing sent text', async () => {
  const { restoreSavedSession } = await import('../src/ask/favorites.ts');
  const { dataBlock } = await import('../src/ask/prompts/index.ts');
  const a = { ...prepared('old text <tag>'), id: 'text-1' };
  const oldMessages = [{ role: 'user', content: [text(state), text(`附件 · ${a.name} · ${a.text.length} 字\n${dataBlock(a.text)}`), text('旧问题')] },
    { role: 'assistant', content: [text('旧回答。')] }];
  const restored = restoreSavedSession({ session: { turns: [{ messages: oldMessages, viewed: [] }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    entries: [{ type: 'turn', id: 42, turn: { committed: 1, question: '旧问题', attachments: [{ id: a.id }] } }], attachments: [a] });
  const read = id => id === a.id ? a : null;
  assert.equal(restored.nextTurnId, 'T2');
  assert.equal(restored.recall({ attachments: ['text-1'] }, read).attachments[0].text, a.text);
  assert.doesNotMatch(JSON.stringify(restored.recall({ turns: ['T1'], include: 'full' }, read)), /old text/);
  assert.equal(restored.messages[0].content[1].text, oldMessages[0].content[1].text);
  assert.equal(restoreTurn(archiveTurn(restored.records[0], read), read).messages[0].content[1].text, oldMessages[0].content[1].text);
});
