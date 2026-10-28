import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveHome, sourceTrail } from '../src/home/derive.ts';
import { readHomePreferences, resolvedLayout } from '../src/home/model.ts';
import { imageOrigin, imageLine, chatImageOrigin, chatImageId, canReuseDrawingParams } from '../src/domain/image-origin.ts';
import { imageParameters } from '../src/domain/image-parameters.ts';
import { DEFAULTS, boardForm, reuseFields, prepareDrawingFields } from '../src/domain/drawing.ts';
import { newConversation } from '../src/domain/conversation.ts';
import { parseDraft, stateHash } from '../src/ask/draft/validate.ts';
import { metadata } from '../src/ask/library.ts';
import { backupPreferences } from '../src/storage/backup-schema.ts';
import { names } from '../src/storage/names.ts';

const board = (id, prompt = '') => ({ id, name: `画板 ${id}`, color: '#888', form: boardForm({ ...DEFAULTS, prompt }), nextCharacterId: 1 });
const image = (id, boardId, at = 10) => ({ id, createdAt: at, favoritedAt: at, size: { width: 832, height: 1216 }, params: { boardId }, blob: new Blob(['original']), thumbBlob: null });
const preview = (boardId, sourceId = 'expired') => ({ boardId, sourceId, createdAt: 8, width: 832, height: 1216, prompt: 'cached', blob: new Blob(['preview']) });
const input = (changes = {}) => ({ boards: [board('a'), board('b'), board('empty')], activeBoardId: 'a', history: [], favorites: [], conversations: [], currentConversationId: '', assets: new Map(), previews: [], preferences: readHomePreferences(null), ...changes });
function chat(id, at = 20, status = 'done') {
  const c = newConversation();
  const turn = { id: `t-${id}`, prompt: `prompt ${id}`, settings: { model: 'chat-image' }, selectedVersion: 0, versions: [{ id: `v-${id}`, status, blocks: [{ type: 'image', assetId: `a-${id}` }] }] };
  return { ...c, id, title: `对话 ${id}`, updatedAt: at, turns: [turn] };
}
const delivery = (line, order, sourceId = 'favorite') => ({ slateId: 's', slateTitle: '交付', todoId: `t-${order}`, title: `任务 ${order}`, order, active: true, sourceId, params: { boardId: line } });

test('HOME face priority: explicit favorite, newest image of this board, preview, text; cancelled cover and deleted board fall back safely', () => {
  const a = image('old', 'a'), latest = image('new', 'a', 30), other = image('other', 'b', 50);
  const data = input({ history: [a, other, latest], favorites: [a], previews: [preview('a')], preferences: { ...readHomePreferences(null), covers: { 'image:a': a.id } } });
  let home = deriveHome(data);
  assert.equal(home.current.face.recordId, 'old');
  assert.deepEqual(home.current.recent.map(p => p.recordId), ['new']);
  assert.equal(home.current.updatedAt, 30);
  home = deriveHome({ ...data, favorites: [] });
  assert.equal(home.current.face.recordId, 'new');
  home = deriveHome({ ...data, favorites: [], history: [] });
  assert.deepEqual(home.current.face, { kind: 'preview', boardId: 'a', width: 832, height: 1216 });
  assert.deepEqual(home.current.recent, []);
  assert.equal(home.current.count, null);
  home = deriveHome({ ...data, boards: [board('b')], activeBoardId: 'b' });
  assert.equal(home.lines.some(l => l.id === 'image:a'), false);
  assert.equal(home.finals[0].source, '已删除的画板');
  assert.equal(home.finals[0].recordId, 'old');
});

test('HOME current can be text, other empty lines stay hidden, first use stays empty, history eviction uses per-board cache', () => {
  assert.equal(deriveHome(input()).firstUse, true);
  assert.deepEqual(deriveHome(input()).lines, []);
  const home = deriveHome(input({ history: [image('b1', 'b')], previews: [preview('a')] }));
  assert.equal(home.current.face.kind, 'preview');
  assert.deepEqual(home.lines.map(l => l.id), ['image:a', 'image:b']);
  const text = deriveHome(input({ favorites: [image('b1', 'b')] }));
  assert.equal(text.current.id, 'image:a');
  assert.equal(text.current.face, null);
  assert.equal(text.lines.some(l => l.id === 'image:empty'), false);
});

test('CHAT uses newest completed version, respects six recent conversations, deduplicates pinned favorite, projects no Blob or URL', () => {
  const conversations = Array.from({ length: 8 }, (_, i) => chat(String(i), i));
  conversations[7].turns[0].versions.push({ id: 'retry', status: 'pending', blocks: [{ type: 'image', assetId: 'retry' }] });
  const assets = new Map(conversations.map(c => [`a-${c.id}`, { width: 768, height: 768, blob: new Blob(['secret-original']), url: 'blob:private', name: 'not-display-metadata' }]));
  const c = conversations[7], turn = c.turns[0], v = turn.versions[0];
  const favorite = { ...image(chatImageId(c.id, turn.id, v.id, 'a-7'), 'wrong'), params: { ...chatImageOrigin(c, turn, v, 'a-7'), tool: 'chat' } };
  const data = input({ conversations, assets, currentConversationId: c.id, favorites: [favorite], preferences: { covers: { 'chat:7': favorite.id }, layout: null, lastLocation: { workspace: 'chat', at: 1 } } });
  const home = deriveHome(data);
  assert.equal(home.current.face.kind, 'favorite');
  assert.deepEqual(home.current.recent, []);
  assert.equal(home.lines.filter(l => l.workspace === 'chat').length, 6);
  assert.equal(home.finals[0].canRestore, false);
  const unpinned = deriveHome({ ...data, preferences: readHomePreferences(null) });
  const face = unpinned.allLines.find(l => l.id === 'chat:7').face;
  assert.equal(face.versionId, v.id);
  assert.deepEqual(Object.keys(face).sort(), ['assetId', 'conversationId', 'height', 'kind', 'turnId', 'versionId', 'width']);
  assert.equal(JSON.stringify(home).includes('blob:private'), false);
  c.turns.push({ ...turn, id: 'later-turn', versions: [{ id: 'later-turn-image', status: 'done', completedAt: 10, blocks: [{ type: 'image', assetId: 'a-6' }] }] });
  v.completedAt = 20;
  const retried = deriveHome({ ...data, preferences: readHomePreferences(null) });
  assert.equal(retried.allLines.find(l => l.id === 'chat:7').face.versionId, v.id, 'retrying an earlier turn becomes the latest completed image');
});

test('Slate delivery orders existing lines only and marks exact favorites without creating new finals', () => {
  const data = input({ boards: [board('a'), board('b'), board('c')], history: [image('b', 'b', 100), image('c', 'c', 20)], favorites: [image('f', 'a')], deliveries: [delivery('c', 0, 'f'), delivery('missing', 1)] });
  const home = deriveHome(data);
  assert.deepEqual(home.lines.map(l => l.id), ['image:a', 'image:c', 'image:b']);
  assert.equal(home.finals.length, 1);
  assert.equal(home.finals[0].deliveries.length, 1);
  assert.equal(deriveHome({ ...data, favorites: [] }).finals.length, 0);
});

test('status comes only from real activity on the originating line, and creation/export metadata is allowlisted', () => {
  const home = deriveHome(input({ history: [image('a', 'a'), image('b', 'b')], activity: [
    { line: 'image:b', kind: 'generation', text: '正在生成 1／2' }, { line: 'image:b', kind: 'mask', text: '区域已修改' },
  ] }));
  assert.equal(home.current.status, '');
  assert.equal(home.lines[1].status, '正在生成 1／2');
  const params = { tool: 'manual-edit', boardId: 'a', editId: 'edit-1', editParent: 'history:stable', sourceRecipe: { tool: 'chat', chat_options: { aspect: 'square', nested: { key: 'bad' } }, apiKey: 'secret' }, apiKey: 'secret', label: '#h4' };
  assert.deepEqual(imageOrigin(params), { boardId: 'a', editId: 'edit-1', editParent: 'history:stable' });
  assert.equal(imageLine({ boardId: 'a', chatConversationId: 'c' }), 'chat:c');
  const clean = imageParameters(params);
  assert.equal(JSON.stringify(clean).includes('secret'), false);
  assert.equal(JSON.stringify(clean).includes('#h4'), false);
  assert.deepEqual(clean.sourceRecipe.chat_options, { aspect: 'square' });
  assert.equal(metadata({ ...image('m', 'a'), params }).editParent, 'history:stable');
  assert.equal(sourceTrail({ boardName: '旧来源', tool: 'inpaint' }, [], []), '旧来源 → 重绘');
  assert.equal(sourceTrail({}, [], []), '');
});

test('CHAT favorites and manual edits of CHAT cannot restore a drawing recipe through UI or ASK; NAI descendants can', () => {
  const base = { form: { ...DEFAULTS }, composer: '', conversationId: 'c', models: [], samplers: [] };
  for (const params of [{ tool: 'chat', prompt: 'not a drawing recipe' }, { tool: 'manual-edit', sourceRecipe: { tool: 'chat' } }]) {
    assert.equal(canReuseDrawingParams(params), false);
    assert.deepEqual(reuseFields({ params }), {});
    assert.deepEqual(prepareDrawingFields(params, [], []), { changes: {}, applied: [] });
    assert.throws(() => parseDraft({ base_hash: stateHash(base), draft_title: '恢复', steps: [{ kind: 'restore_partial', source: '#f1', fields: ['prompt'] }] }, base, [{ aliases: ['#f1'], params }]), /没有可恢复的绘图配方/);
  }
  assert.equal(canReuseDrawingParams({ tool: 'inpaint', chatConversationId: 'c', seed: 1 }), true);
  assert.equal(canReuseDrawingParams({ prompt: 'old favorite' }), true);
});

test('three persisted layouts, responsive default, safe optional preferences and exclusion from ordinary backup', () => {
  assert.deepEqual(readHomePreferences(null), { covers: {}, layout: null, lastLocation: null });
  for (const layout of ['rows', 'cols', 'mosaic']) {
    assert.equal(readHomePreferences({ layout }).layout, layout);
    assert.equal(resolvedLayout(layout, 320), layout);
  }
  assert.equal(resolvedLayout(null, 1440), 'rows');
  for (const width of [320, 390, 768, 860]) assert.equal(resolvedLayout(null, width), 'cols');
  assert.deepEqual(readHomePreferences({ covers: { 'image:a': 'f1', bad: 'f2', 'chat:b': 2 }, layout: 'spread', lastLocation: { workspace: 'editor', at: 1 } }), { covers: { 'image:a': 'f1' }, layout: null, lastLocation: null });
  assert.equal(Object.values(backupPreferences).includes(names.home), false);
});
