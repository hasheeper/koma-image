import test from 'node:test';
import assert from 'node:assert/strict';
import { readAskParameters } from '../src/ask/parameters.ts';
import { MODEL_LIMIT, modelParameters, readAskSettings, withModel, withParameters } from '../src/ask/settings.ts';
import { wireBody } from '../src/ask/provider.ts';
import { namingRequest, conversationNameContent } from '../src/ask/naming.ts';
import { openaiChatProfile as chat, anthropicMessagesProfile as anthropic, geminiSharedProfile as gemini } from '../src/gateway/profile.ts';
import { collectBackupPreferences, validateBackupManifest } from '../src/storage/backup-schema.ts';
import { names } from '../src/storage/names.ts';

const request = { model: 'any provider model', system: ['system', ''], tools: [], maxTokens: 4096,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] };

test('ASK defaults: optional limits/sampling are absent for Gemini and OpenAI, including naming; Anthropic retains required max_tokens', () => {
  const naming = namingRequest(request.model, conversationNameContent([{ question: 'q', reply: 'a' }]));
  for (const r of [request, naming, { ...request, maxTokens: 8192 }]) {
    const oai = wireBody(chat, r), native = wireBody(gemini, r), claude = wireBody(anthropic, r);
    for (const key of ['max_tokens', 'max_completion_tokens', 'temperature', 'top_p']) assert.equal(Object.hasOwn(oai, key), false);
    assert.deepEqual(native.generationConfig, { responseModalities: ['TEXT'] });
    assert.equal(claude.max_tokens, r.maxTokens);
    assert.equal(Object.hasOwn(claude, 'temperature'), false);
    assert.equal(Object.hasOwn(claude, 'top_p'), false);
  }
});

test('ASK overrides: protocol mappings preserve explicit zero and only send one selected OpenAI output field', () => {
  const parameters = { maxOutputTokens: 32768, temperature: 0, topP: 0 };
  const oai = wireBody(chat, { ...request, parameters });
  assert.equal(oai.max_completion_tokens, 32768); assert.equal(Object.hasOwn(oai, 'max_tokens'), false);
  assert.equal(oai.temperature, 0); assert.equal(oai.top_p, 0);
  const legacy = wireBody(chat, { ...request, parameters: { ...parameters, outputTokenField: 'max_tokens' } });
  assert.equal(legacy.max_tokens, 32768); assert.equal(Object.hasOwn(legacy, 'max_completion_tokens'), false);
  assert.deepEqual(wireBody(gemini, { ...request, parameters }).generationConfig, { responseModalities: ['TEXT'], maxOutputTokens: 32768, temperature: 0, topP: 0 });
  const claude = wireBody(anthropic, { ...request, parameters });
  assert.equal(claude.max_tokens, 32768); assert.equal(claude.temperature, 0); assert.equal(claude.top_p, 0);
  for (const profile of [chat, anthropic, gemini]) {
    const body = wireBody(profile, { ...request, parameters: { outputTokenField: 'max_tokens' } });
    assert.equal(Object.hasOwn(body, 'outputTokenField'), false);
    if (profile === chat) assert.equal(Object.hasOwn(body, 'max_tokens'), false);
  }
});

test('ASK parameter storage: connection and exact model isolation, reset, backup roundtrip and no selection side effect', () => {
  const a = 'Exact Model [provider]', b = 'other-model';
  const base = readAskSettings({ connectionId: 'first', model: a, models: { first: [a, b], second: [a] } });
  let s = withParameters(base, 'first', b, { maxOutputTokens: 32768, temperature: 0 });
  s = withParameters(s, 'second', a, { topP: .75 });
  assert.equal(s.model, a); assert.equal(s.connectionId, 'first');
  assert.deepEqual(modelParameters(s, 'first', a), {});
  assert.deepEqual(modelParameters(s, 'first', b), { maxOutputTokens: 32768, temperature: 0 });
  assert.deepEqual(modelParameters(s, 'second', a), { topP: .75 });
  assert.deepEqual(modelParameters(withModel(s, 'first', b), 'first', b), modelParameters(s, 'first', b));
  const preferences = collectBackupPreferences({ getItem: key => key === names.ask ? JSON.stringify(s) : null });
  const restored = validateBackupManifest({ app: 'koma-image', kind: 'backup', version: 2,
    id: '12345678-1234-1234-1234-123456789012', createdAt: new Date(0).toISOString(), favorites: [], conversations: [], assets: [], preferences });
  assert.deepEqual(JSON.parse(restored.preferences.ask), s);
  s = withParameters(s, 'first', b, {});
  assert.deepEqual(s.parameters, { second: { [a]: { topP: .75 } } });
  assert.deepEqual(withParameters(s, 'second', a, {}), base);
  assert.deepEqual(readAskSettings(JSON.parse(JSON.stringify(base))), base);
});

test('ASK parameter validation: invalid imports and unknown fields never become request parameters', () => {
  assert.deepEqual(readAskParameters({ maxOutputTokens: 1.5, temperature: Infinity, topP: 1.01, apiKey: 'excluded', thinking: true }), {});
  for (const n of [-1, 0, Number.MAX_SAFE_INTEGER + 1]) assert.equal(readAskParameters({ maxOutputTokens: n }).maxOutputTokens, undefined);
  assert.deepEqual(readAskParameters({ temperature: 2, topP: 1, maxOutputTokens: 1 }), { maxOutputTokens: 1, temperature: 2, topP: 1 });
  const settings = readAskSettings({ parameters: { first: { 'bad\nid': { topP: .5 }, valid: { maxOutputTokens: -1 }, safe: { topP: .5, apiKey: 'excluded' } } } });
  assert.deepEqual(settings.parameters, { first: { safe: { topP: .5 } } });
  assert.deepEqual(modelParameters(settings, 'toString', '__proto__'), {});
  assert.deepEqual(readAskSettings({ parameters: { first: { empty: {} } } }).parameters, undefined);
});

test('ASK parameter storage: full picked list preserves independent naming and previously picked model settings', () => {
  const models = Array.from({ length: MODEL_LIMIT }, (_, i) => `model-${i}`);
  let settings = readAskSettings({ connectionId: 'first', model: models[0], models: { first: models },
    naming: { connectionId: 'first', model: 'naming-only' } });
  for (const model of [...models, 'previous-pick', 'naming-only'])
    settings = withParameters(settings, 'first', model, { maxOutputTokens: 32768 });
  const restored = readAskSettings(JSON.parse(JSON.stringify(settings)));
  assert.deepEqual(restored, settings);
  assert.deepEqual(modelParameters(restored, 'first', 'naming-only'), { maxOutputTokens: 32768 });
  assert.deepEqual(modelParameters(restored, 'first', 'previous-pick'), { maxOutputTokens: 32768 });
});

test('ASK custom parameters: scalar types, nested paths and disabled/empty fields map without changing managed inputs', () => {
  const field = (type, value) => ({ type, options: [], default: value });
  const custom = { reasoning_effort: field('string', 'high'), presence_penalty: field('number', '0'),
    parallel_tool_calls: field('boolean', 'false'), disabled: null, empty: field('string', ''),
    'thinkingConfig.thinkingBudget': field('number', '-1') };
  const parameters = readAskParameters({ custom });
  assert.deepEqual(parameters.custom, custom);
  for (const profile of [chat, anthropic, gemini]) {
    const body = wireBody(profile, { ...request, parameters });
    const output = profile === gemini ? body.generationConfig : body;
    assert.equal(output.reasoning_effort, 'high');
    assert.equal(output.presence_penalty, 0);
    assert.equal(output.parallel_tool_calls, false);
    assert.deepEqual(output.thinkingConfig, { thinkingBudget: -1 });
    assert.equal(Object.hasOwn(output, 'disabled'), false);
    assert.equal(Object.hasOwn(output, 'empty'), false);
    assert.equal(Object.hasOwn(body, 'custom'), false);
  }
  const settings = withParameters(readAskSettings({ connectionId: 'first', model: 'model' }), 'first', 'model', parameters);
  assert.deepEqual(readAskSettings(JSON.parse(JSON.stringify(settings))), settings);
});

test('ASK custom parameters: managed inputs, prototype paths, invalid values and overlapping paths cannot enter requests', () => {
  const field = { type: 'number', options: [], default: '3' };
  const custom = Object.fromEntries(['model', 'messages', 'system', 'systemInstruction', 'tools', 'tool_choice', 'toolConfig', 'stream',
    'stream_options', 'contents', 'responseModalities', 'generationConfig', 'maxOutputTokens', 'max_tokens', 'max_completion_tokens',
    'temperature', 'topP', 'top_p', '__proto__', 'constructor.key', 'x.__proto__.key'].map(key => [key, field]));
  Object.assign(custom, { safe: field, invalid: { ...field, default: 'NaN' }, 'safe.nested': field });
  const parameters = readAskParameters({ custom });
  assert.deepEqual(parameters.custom, { safe: field });
  for (const profile of [chat, anthropic, gemini]) {
    const body = wireBody(profile, { ...request, parameters: { custom } });
    assert.equal(body.model, profile === gemini ? undefined : request.model);
    assert.equal(profile === gemini ? body.generationConfig.safe : body.safe, 3);
    if (profile === gemini) assert.deepEqual(body.generationConfig.responseModalities, ['TEXT']);
    else assert.equal(body.stream, true);
  }
});
