import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiProfile, geminiChatProfile, geminiSharedProfile, openaiChatProfile } from '../src/gateway/profile.ts';
import { imageConnections, reasoningConnections, validateRouting } from '../src/config/connections.ts';
import { nativeCatalog } from '../src/gateway/native-protocols.ts';
import { createProvider, wireBody } from '../src/ask/provider.ts';
import { createCodec } from '../src/ask/codec.ts';
import { createSession } from '../src/ask/session.ts';
import { run } from '../src/ask/runner.ts';
import { createCallLog, inspectCall } from '../src/ask/debug.ts';

const tool = { name: 'get_state', description: '读取工作台', schema: { type: 'object', properties: { scope: { type: 'string' } } } };
const request = { model: 'relay/文字与香蕉 ?x=1', system: ['宪章', '偏好'], tools: [tool], maxTokens: 4096,
  messages: [{ role: 'user', content: [{ type: 'text', text: '读取工作台' }, { type: 'image', mime: 'image/png', data: 'AAAA' }] }] };
const frame = (parts, finishReason, usageMetadata) => ({ candidates: [{ index: 0, content: { role: 'model', parts }, ...(finishReason ? { finishReason } : {}) }], ...(usageMetadata ? { usageMetadata } : {}) });
const sse = chunks => chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('');
const connection = { id: 'gemini', name: '模拟 Gemini', profileId: geminiSharedProfile.id, baseUrl: 'https://example.test/relay/v1beta', credentialRef: 'key', revision: '1' };
const context = { connection, assertCurrent() {}, key: () => 'synthetic-gemini-key' };
const collect = async stream => { const out = []; for await (const e of stream) out.push(e); return out; };
function provider(replies, calls = [], options) {
  return createProvider(context, async (url, init) => {
    calls.push({ url: String(url), ...init, body: JSON.parse(init.body) });
    return replies.shift()();
  }, options);
}
const reply = (...chunks) => () => new Response(sse(chunks), { headers: { 'content-type': 'text/event-stream' } });

test('Gemini capability profiles share native discovery; text-only is excluded from image sources', () => {
  const routing = validateRouting({ version: 1, links: {}, connections: Object.fromEntries([geminiProfile, geminiChatProfile, geminiSharedProfile].map(p => [p.id, { ...connection, id: p.id, profileId: p.id }])) });
  assert.deepEqual(imageConnections(routing).map(c => c.profileId), [geminiProfile.id, geminiSharedProfile.id]);
  assert.deepEqual(reasoningConnections(routing).map(c => c.profileId), [geminiChatProfile.id, geminiSharedProfile.id]);
  for (const p of [geminiProfile, geminiChatProfile, geminiSharedProfile]) {
    const catalog = nativeCatalog(p, { models: [{ name: 'models/vendor-custom-id', displayName: '自定义模型' }] });
    assert.deepEqual(catalog.models, { 'vendor-custom-id': { name: '自定义模型' } });
  }
  assert.throws(() => createProvider({ ...context, connection: { ...connection, profileId: geminiProfile.id } }), /不支持 ASK/);
});

test('Gemini native request: escaped arbitrary model path, header key, text-only response, native schema and usage', async () => {
  const calls = [], traces = [];
  const p = provider([reply(frame([{ text: '读取' }]), frame([{ text: '完成' }], 'STOP', { promptTokenCount: 100, candidatesTokenCount: 8, thoughtsTokenCount: 12, cachedContentTokenCount: 60 }))], calls);
  const events = await collect(p.stream(request, { observe: e => traces.push(e) }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://example.test/relay/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`);
  assert.equal(calls[0].headers['x-goog-api-key'], 'synthetic-gemini-key');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].redirect, 'error');
  assert.equal(JSON.stringify(traces).includes('synthetic-gemini-key'), false);
  assert.deepEqual(calls[0].body.generationConfig, { maxOutputTokens: 4096, responseModalities: ['TEXT'] });
  assert.deepEqual(calls[0].body.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: 'AAAA' } });
  assert.deepEqual(calls[0].body.tools[0].functionDeclarations[0].parametersJsonSchema, tool.schema);
  assert.equal(calls[0].body.model, undefined);
  assert.equal(events.filter(e => e.type === 'text').map(e => e.text).join(''), '读取完成');
  assert.deepEqual(events.at(-1).usage, { input: 100, output: 20, cacheRead: 60, cacheWrite: 0 });
  assert.deepEqual(traces.at(-1).cache, { read: 60, write: null });
  assert.deepEqual(wireBody(geminiChatProfile, { ...request, toolChoice: 'none' }).toolConfig, { functionCallingConfig: { mode: 'NONE' } });
});

test('Gemini tool loop preserves exact signed parts, matches parallel calls and persists native replay', async () => {
  const calls = [], native = [
    { text: '内部摘要', thought: true },
    { text: '先检查。', thoughtSignature: 'text-signature' },
    { functionCall: { id: 'first', name: 'get_state', args: { scope: 'one' } }, thoughtSignature: 'function-signature' },
    { functionCall: { name: 'get_state', args: { scope: 'two' } } },
    { text: '', thoughtSignature: 'tail-signature' },
  ];
  const p = provider([reply(frame(native, 'STOP')), reply(frame([{ text: '检查完成。' }], 'STOP'))], calls);
  const session = createSession(), turn = session.begin(request.messages[0]);
  const registry = new Map([['get_state', { tool, verb: '读取', object: input => input.scope, run: input => ({ content: [{ type: 'text', text: input.scope }, { type: 'image', mime: 'image/png', data: 'AAAA' }] }) }]]);
  const events = await collect(run({ stream: p.stream, request, turn, tools: registry, context: {}, signal: new AbortController().signal }));
  assert.equal(events.filter(e => e.type === 'tool-start').length, 2);
  assert.equal(events.some(e => e.type === 'text' && e.text.includes('内部摘要')), false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body.contents[1].parts, native);
  const parts = calls[1].body.contents[2].parts;
  assert.deepEqual(parts.slice(0, 2), [
    { functionResponse: { id: 'first', name: 'get_state', response: { output: 'one' } } },
    { functionResponse: { name: 'get_state', response: { output: 'two' } } },
  ]);
  assert.equal(parts.filter(p => p.inlineData).length, 2);
  turn.commit();
  const snapshot = structuredClone(session.snapshot());
  const restored = createSession(undefined, snapshot.turns, snapshot.usage, snapshot.nextTurnId, snapshot);
  const next = restored.begin({ role: 'user', content: [{ type: 'text', text: '继续' }] });
  const resumed = { ...request, messages: next.messages() };
  assert.deepEqual(wireBody(geminiChatProfile, resumed).contents[1].parts, native);
  const foreign = wireBody(geminiChatProfile, { ...resumed, model: 'different-model' });
  assert.equal(JSON.stringify(foreign).includes('thoughtSignature'), false);
  assert.equal(JSON.stringify(foreign).includes('functionResponse'), false);
  assert.ok(JSON.stringify(foreign).includes('tool_call first get_state'));
  assert.equal(JSON.stringify(wireBody(openaiChatProfile, resumed)).includes('thoughtSignature'), false);

  const log = createCallLog(() => {});
  const id = log.start({ conversation: 'test', turn: 1, step: 2, question: '读取工作台', connection: 'gemini', protocol: 'gemini-native', model: request.model, promptVersion: 'test' }, JSON.stringify(calls[1].body));
  const inspection = inspectCall(log.get(id));
  assert.ok(inspection.parts.some(p => p.section === 'system' && p.gist.includes('宪章')));
  assert.ok(inspection.parts.some(p => p.role === 'model' && p.tool === 'get_state · get_state'));
  assert.equal(inspection.images.length, 3);
  assert.equal(inspection.images.filter(i => i.source === 'tool').length, 2);
  assert.equal(inspection.parts.some(p => p.text.includes('AAAA')), false);
  assert.equal(inspection.parameters.includes('contents'), false);
});

test('Gemini prose envelopes stay ordinary history; native acknowledgements preserve signed calls without executing a tool', async () => {
  const calls = [], native = [
    { functionCall: { name: 'submit_response', args: { content: '先说明。' } }, thoughtSignature: 'envelope-signature' },
    { functionCall: { name: 'get_state', args: {} } },
  ];
  const p = provider([reply(frame(native, 'STOP')), reply(frame([{ text: '完成。' }], 'STOP'))], calls);
  const session = createSession(), turn = session.begin(request.messages[0]);
  await collect(run({ stream: p.stream, request, turn, responseMode: 'tool', tools: new Map([['get_state', { tool, verb: '读取', object: () => '工作台', run: () => ({ content: [{ type: 'text', text: '状态' }] }) }]]), context: {}, signal: new AbortController().signal }));
  assert.equal(turn.budget.toolCalls, 1);
  assert.equal(turn.messages().flatMap(m => m.content).some(b => b.type === 'call' && b.name === 'submit_response'), false);
  assert.deepEqual(calls[1].body.contents[1].parts, native);
  assert.deepEqual(calls[1].body.contents[2].parts.map(p => p.functionResponse.name), ['submit_response', 'get_state']);
  assert.ok(turn.messages().some(m => m.content.some(b => b.type === 'text' && b.text === '先说明。')));
});

test('Gemini codec decodes visible output and tool inputs without rewriting opaque signatures', async () => {
  const codec = createCodec(['特征词']);
  const token = codec.encode('特征词');
  const native = [{ functionCall: { name: 'get_state', args: { scope: token } }, thoughtSignature: token }];
  const p = provider([reply(frame(native, 'STOP'))]);
  const events = await collect(p.stream(request, { codec }));
  assert.equal(events.find(e => e.type === 'call').call.input.scope, '特征词');
  assert.deepEqual(events.at(-1).gemini.parts, native);
});

test('Gemini refusal, malformed call, HTTP errors, interrupted stream and cancellation never retry', async () => {
  for (const [chunks, kind] of [
    [[{ promptFeedback: { blockReason: 'SAFETY' } }], 'rejected'],
    [[frame([{ functionCall: { name: 'get_state', args: 'bad' } }], 'STOP')], 'protocol'],
    [[frame([], 'MALFORMED_FUNCTION_CALL')], 'protocol'],
    [[frame([{ text: '未完成' }])], 'network'],
    [[frame([{ inlineData: { data: 'AAAA', mimeType: 'image/png' } }], 'STOP')], 'protocol'],
    [[{ error: { code: 429, message: 'rate limited' } }], 'rate'],
  ]) {
    const calls = [], p = provider([reply(...chunks)], calls);
    await assert.rejects(collect(p.stream(request)), e => e.kind === kind);
    assert.equal(calls.length, 1);
  }
  const calls = [], p = provider([() => new Response('{"error":{"message":"invalid key"}}', { status: 401 })], calls);
  await assert.rejects(collect(p.stream(request)), e => e.kind === 'auth');
  assert.equal(calls.length, 1);
  for (const cancel of [true, false]) {
    let cancelled = false;
    const controller = new AbortController();
    const stalled = provider([() => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse([frame([{ text: '开始' }])]))); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } })], [], { idleMs: 25 });
    const work = collect(stalled.stream(request, { signal: controller.signal }));
    if (cancel) setTimeout(() => controller.abort(new DOMException('stopped', 'AbortError')), 5);
    await assert.rejects(work, e => cancel ? e.name === 'AbortError' : e.kind === 'timeout');
    assert.equal(cancelled, true);
  }
});
