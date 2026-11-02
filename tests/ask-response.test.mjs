import test from 'node:test';
import assert from 'node:assert/strict';
import { createResponseStream } from '../src/ask/response-stream.ts';
import { withToolResponse } from '../src/ask/prompts/response.ts';
import { readAskSettings } from '../src/ask/settings.ts';
import { createConnections } from '../src/services/connections.ts';
import { createProvider, wireBody } from '../src/ask/provider.ts';
import { openaiChatProfile, anthropicMessagesProfile } from '../src/gateway/profile.ts';
import { createCodec } from '../src/ask/codec.ts';
import { run } from '../src/ask/runner.ts';
import { createSession } from '../src/ask/session.ts';
import { replyText } from '../src/ask/compact/ledger.ts';
import { getTurn } from '../src/ask/compact/archive.ts';

const profiles = [openaiChatProfile, anthropicMessagesProfile];
const encoder = new TextEncoder();
const textOf = events => events.filter(e => e.type === 'text').map(e => e.text).join('');
const request = { model: 'synthetic', tools: [], system: ['core', ''], messages: [{ role: 'user', content: [{ type: 'text', text: '请回答' }] }], maxTokens: 4096 };
const envelope = (content, extra = {}) => ({ name: 'submit_response', input: { content }, ...extra });
const collect = async source => { const out = []; for await (const event of source) out.push(event); return out; };

function wire(profile, { plain = '', calls = [], stop, finish = true }) {
  const events = [];
  if (profile === openaiChatProfile) {
    if (plain) events.push({ choices: [{ delta: { content: plain } }] });
    calls.forEach((c, index) => {
      const name = c.lateName ? '' : c.name;
      events.push({ choices: [{ delta: { tool_calls: [{ index, id: `c${index}`, function: { name } }] } }] });
      if (c.object) events.push({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: c.input } }] } }] });
      else for (const part of (c.parts ?? [JSON.stringify(c.input)]))
        events.push({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: part } }] } }] });
      if (c.lateName) events.push({ choices: [{ delta: { tool_calls: [{ index, function: { name: c.name } }] } }] });
    });
    if (finish) events.push({ choices: [{ delta: {}, finish_reason: stop ?? (calls.length ? 'tool_calls' : 'stop') }], usage: { prompt_tokens: 20, completion_tokens: 10 } });
    return events.map(e => `data: ${JSON.stringify(e)}\n\n`).concat(finish ? ['data: [DONE]\n\n'] : []);
  }
  events.push({ type: 'message_start', message: { usage: { input_tokens: 20 } } });
  if (plain) events.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: plain } }, { type: 'content_block_stop', index: 0 });
  calls.forEach((c, i) => {
    const index = i + 1;
    events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: `c${i}`, name: c.name, input: c.object ? c.input : {} } });
    if (!c.object) for (const part of (c.parts ?? [JSON.stringify(c.input)]))
      events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: part } });
    if (finish) events.push({ type: 'content_block_stop', index });
  });
  if (finish) events.push({ type: 'message_delta', delta: { stop_reason: stop ?? (calls.length ? 'tool_use' : 'end_turn') }, usage: { output_tokens: 10 } }, { type: 'message_stop' });
  return events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
}

async function providerFor(profile, fetcher) {
  const store = new Map();
  const connections = createConnections({ getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, work => work());
  await connections.save({ version: 1, connections: { ask: { id: 'ask', name: 'test', baseUrl: 'https://synthetic.example.test/v1', profileId: profile.id, credentialRef: 'test-key', revision: 'r1' } }, links: {} });
  connections.supplyKey('test-key', 'synthetic-key');
  return createProvider(connections.context('ask'), fetcher);
}
const response = chunks => new Response(new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(encoder.encode(chunk)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });

test('tool response setting: opt-in, invalid values default off and preference roundtrip', () => {
  for (const value of [null, {}, { responseMode: true }, { responseMode: 'required' }]) assert.equal(readAskSettings(value).responseMode, 'text');
  const settings = readAskSettings({ responseMode: 'tool' });
  assert.equal(readAskSettings(JSON.parse(JSON.stringify(settings))).responseMode, 'tool');
});

test('response string decoder: every split boundary, escaping, nested decoys and Unicode', () => {
  const prose = '  中文 "引号" \\ 路径\n\t表格 | 值\n```js\n{"x":1}\n``` 😀𝄞\b\f\r /';
  for (const raw of [JSON.stringify({ meta: { content: '错误字段' }, list: ['content'], content: prose, extra: true }),
    '{"ignored":"\\\"content\\\"","con\\u0074ent":' + JSON.stringify(prose).replace('😀', '\\ud83d\\ude00').replace('𝄞', '\\ud834\\udd1e') + '}']) {
    for (let split = 0; split <= raw.length; split++) {
      const decoder = createResponseStream();
      assert.equal(decoder.push(raw.slice(0, split)) + decoder.push(raw.slice(split)) + decoder.finish(), prose, `split ${split}`);
    }
    const decoder = createResponseStream();
    assert.equal(raw.split('').map(char => decoder.push(char)).join('') + decoder.finish(), prose);
  }
});

for (const profile of profiles) {
  test(`${profile.protocol}: envelope and plain prose are tolerant alternatives with no tool residue`, async () => {
    const codec = createCodec([], [{ from: '红色外套', to: 'azure dress' }]);
    for (const sample of [
      { plain: '普通正文' },
      { calls: [envelope('azure dress\n正文', { parts: JSON.stringify({ content: 'azure dress\n正文' }).split('') })] },
      { plain: '重复正文', calls: [envelope('重复正文')] },
      { plain: '前言不采用', calls: [envelope('采用信封正文')] },
      { plain: '空信封回退正文', calls: [envelope('  ')] },
      { plain: '非字符串信封回退正文', calls: [envelope(42)] },
      { calls: [envelope('完整对象', { object: true })] },
      { calls: [envelope('迟到工具名', { lateName: true })] },
      { calls: [envelope('第一份正文'), envelope('第二份正文')] },
    ]) {
      const provider = await providerFor(profile, async () => response(wire(profile, sample)));
      const events = await collect(provider.stream(withToolResponse(request), { codec }));
      const chosen = sample.calls?.find(c => typeof c.input.content === 'string' && c.input.content.trim())?.input.content ?? sample.plain;
      assert.equal(textOf(events), codec.decode(chosen));
      assert.equal(events.some(e => e.type === 'call'), false);
    }
  });

  test(`${profile.protocol}: envelope text streams before completion, including codec boundaries`, async () => {
    let source;
    const codec = createCodec([], [{ from: '红外套', to: 'azure dress' }]);
    const provider = await providerFor(profile, async () => new Response(new ReadableStream({ start(c) { source = c; } }), { headers: { 'content-type': 'text/event-stream' } }));
    const events = provider.stream(withToolResponse(request), { codec });
    const first = events.next();
    while (!source) await new Promise(resolve => setTimeout(resolve, 0));
    const all = wire(profile, { calls: [envelope('前段 azure dress 后段', { parts: ['{"content":"前段 azure ', 'dress 后段"}'] })] });
    const cut = all.findIndex(chunk => chunk.includes('dress 后段'));
    for (const chunk of all.slice(0, cut)) source.enqueue(encoder.encode(chunk));
    const preview = await first;
    assert.equal(preview.value.type, 'text');
    assert.ok(preview.value.text.startsWith('前段'));
    for (const chunk of all.slice(cut)) source.enqueue(encoder.encode(chunk));
    source.close();
    assert.equal(preview.value.text + textOf(await collect(events)), '前段 红外套 后段');
  });

  test(`${profile.protocol}: ordinary tool mixing, draft completion and history use only normalized text`, async () => {
    for (const business of [null, 'get_state', 'propose_draft']) {
      const dispatched = [], session = createSession(), turn = session.begin(request.messages[0]);
      const rounds = [{ plain: '重复说明', calls: [...(business ? [{ name: business, input: {} }] : []), envelope('正文说明')] }, { plain: '查询后的正常回答' }];
      const provider = await providerFor(profile, async (_url, init) => {
        dispatched.push(JSON.parse(init.body));
        return response(wire(profile, rounds.shift()));
      });
      const executed = [];
      const tools = new Map(['get_state', 'propose_draft'].map(name => [name, {
        tool: { name, description: name, schema: { type: 'object' } }, verb: '读取', object: () => '资料', final: name === 'propose_draft',
        run() { executed.push(name); return { content: [{ type: 'text', text: '业务结果' }] }; },
      }]));
      const events = await collect(run({ responseMode: 'tool', request: { ...request, tools: [...tools.values()].map(e => e.tool) },
        stream: (r, signal) => provider.stream(r, { signal }), turn, tools, context: {}, signal: new AbortController().signal }));
      turn.commit();
      assert.equal(dispatched.length, business === 'get_state' ? 2 : 1);
      assert.deepEqual(executed, business ? [business] : []);
      assert.equal(events.filter(e => e.type === 'tool-start').length, business ? 1 : 0);
      assert.doesNotMatch(JSON.stringify(session.messages), /submit_response|accepted|重复说明/);
      assert.equal(turn.budget.toolCalls, business ? 1 : 0);
      assert.match(replyText(session.records[0]), /正文说明/);
      assert.match(getTurn({ turns: ['T1'] }, session.records, () => null).turns[0].reply, /正文说明/);
      for (const nextProfile of profiles) {
        const next = wireBody(nextProfile, { ...request, messages: session.messages });
        assert.doesNotMatch(JSON.stringify(next), /submit_response/);
        assert.match(JSON.stringify(next), /正文说明/);
      }
    }
  });

  test(`${profile.protocol}: length-limited envelopes keep ordinary truncation; disconnects still fail`, async () => {
    const cut = { calls: [envelope('', { parts: ['{"content":"部分正文'] })] };
    const provider = await providerFor(profile, async () => response(wire(profile, { ...cut, stop: profile === openaiChatProfile ? 'length' : 'max_tokens' })));
    const events = await collect(provider.stream(withToolResponse(request)));
    assert.equal(textOf(events), '部分正文');
    assert.equal(events.at(-1).stop, 'length');
    for (const sample of [cut, { plain: '普通文本中断' }]) {
      const disconnected = await providerFor(profile, async () => response(wire(profile, { ...sample, finish: false })));
      const partial = [];
      await assert.rejects(async () => { for await (const event of disconnected.stream(withToolResponse(request))) partial.push(event); });
      assert.equal(textOf(partial), sample.plain ?? '部分正文');
    }
  });
}
