import test from 'node:test';
import assert from 'node:assert/strict';
import { boardNameContent, conversationNameContent, namingRequest, readGeneratedName } from '../src/ask/naming.ts';
import { readAskSettings } from '../src/ask/settings.ts';
import { collectBackupPreferences, validateBackupManifest } from '../src/storage/backup-schema.ts';
import { names } from '../src/storage/names.ts';

test('AI naming: scoped text, bounded history and empty-input rejection', () => {
  const form = { prompt: ' rainy station ', negative: 'negative-secret', seed: 77, characters: [
    { on: true, prompt: 'girl, red coat', negative: 'character-negative-secret', id: 'c1' },
    { on: false, prompt: 'disabled-secret' },
  ] };
  const source = boardNameContent(form), request = namingRequest('Exact Model [suffix]', source);
  assert.deepEqual(source.content, { prompt: 'rainy station', characters: [{ prompt: 'girl, red coat' }] });
  assert.deepEqual(request.tools, []); assert.equal(request.messages.length, 1);
  assert.doesNotMatch(JSON.stringify(request), /negative-secret|disabled-secret|workspace_state|image_url/);
  const history = Array.from({ length: 20 }, (_, i) => ({ question: `q${i} ${'x'.repeat(3000)}`, reply: 'y'.repeat(5000) }));
  const content = conversationNameContent(history).content;
  assert.equal(content.length, 5); assert.match(content[0].question, /^q0 /); assert.match(content[1].question, /^q16 /);
  assert.ok(JSON.stringify(content).length < 12200);
  assert.throws(() => namingRequest('model', boardNameContent({ prompt: ' ', characters: [] })), /先填写/);
  assert.throws(() => namingRequest('model', conversationNameContent([])), /先开始/);
});

test('AI naming: title formatting tolerates wrappers and rejects partial lists, controls and excessive text', () => {
  for (const text of ['夜雨电车', '  “夜雨电车”  ', '**夜雨电车**', '`夜雨电车`']) assert.equal(readGeneratedName(text, 60), '夜雨电车');
  for (const text of ['', '  ', '标题一\n标题二', 'a\u0000b', 'a\u2028b', 'x'.repeat(61)]) assert.throws(() => readGeneratedName(text, 60));
});

test('AI naming: optional choice survives backup independently of ASK picks and preserves model IDs', () => {
  const base = readAskSettings({ connectionId: 'ask', model: 'main' });
  assert.equal(base.naming, undefined);
  const config = readAskSettings({ ...base, naming: { connectionId: 'namer', model: ' Claude Name [provider] ', key: 'excluded-secret' } });
  assert.deepEqual(config.naming, { connectionId: 'namer', model: 'Claude Name [provider]' });
  assert.deepEqual(config.models, { ask: ['main'] });
  const preferences = collectBackupPreferences({ getItem(key) { return key === names.ask ? JSON.stringify(config) : null; } });
  const restored = validateBackupManifest({ app: 'koma-image', kind: 'backup', version: 2, id: '12345678-1234-1234-1234-123456789012', createdAt: new Date(0).toISOString(), favorites: [], conversations: [], assets: [], preferences });
  assert.deepEqual(JSON.parse(restored.preferences.ask), config);
  assert.doesNotMatch(JSON.stringify(preferences), /excluded-secret/);
  assert.deepEqual(readAskSettings({ naming: { connectionId: 'namer', model: 'bad\nid' } }).naming, { connectionId: 'namer', model: '' });
});
