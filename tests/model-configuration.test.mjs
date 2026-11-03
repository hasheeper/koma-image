import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRouting, imageConnections, reasoningConnections } from '../src/config/connections.ts';
import { initialModelEntries, configuredModels, removedModel } from '../src/domain/models.ts';
import { normalizeCatalog, normalizeOptions, sourceState, supportsModel } from '../src/domain/catalog.ts';
import { supportsSourcePayload } from '../src/domain/source-funding.ts';
import { validateParameterOverrides } from '../src/domain/model-parameters.ts';
import { buildChatPayload } from '../src/domain/media.ts';
import { createConnections } from '../src/services/connections.ts';
import { createGateway } from '../src/gateway/client.ts';
import { createProvider } from '../src/ask/provider.ts';
import { nativeMappedCatalog } from '../src/gateway/native-protocols.ts';
import { profileFor } from '../src/gateway/profile.ts';
import { collectBackupPreferences, validateBackupManifest } from '../src/storage/backup-schema.ts';
import { names } from '../src/storage/names.ts';

const connection = (profileId = 'openai-images-v1', id = 'a') => ({ id, name: id, baseUrl: profileId === 'nai-official-v1' ? 'https://image.novelai.net' : 'https://gateway.example.test/v1', profileId, credentialRef: `key-${id}`, revision: 'r1' });
const config = (profileId) => ({ version: 1, connections: { a: connection(profileId) }, links: {} });
const entry = (templateId = 'gpt-image-2', defaults = {}) => ({ id: 'model-custom', name: '渠道自定义模型', templateId, defaults });
function service(local, saved = new Map()) {
  const storage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
  const connections = createConnections(storage, work => work(), local);
  connections.reload();
  return { connections, saved, storage };
}
const manifest = preferences => ({ app: 'koma-image', kind: 'backup', version: 2, id: '12345678-1234-1234-1234-123456789012', createdAt: new Date(0).toISOString(), favorites: [], conversations: [], assets: [], preferences });

test('model entries: editable presets, deletions, stable identities and validation preserve fixed NAI', () => {
  assert.equal(initialModelEntries().length, 13);
  const value = config(); value.models = [entry()];
  const restored = validateRouting(JSON.parse(JSON.stringify(value)));
  assert.deepEqual(restored.models, value.models);
  assert.equal(configuredModels(restored).filter(m => m.family === 'novelai').length, 5);
  assert.equal(configuredModels({ models: [] }).length, 5);
  assert.equal(removedModel(restored, 'gpt-image-2'), true);
  assert.equal(removedModel(restored, 'model-custom'), false);
  for (const bad of [ { ...entry(), id: 'nai-diffusion-5-full' }, { ...entry(), templateId: 'nai-diffusion-5-full' }, { ...entry(), defaults: [] }, { ...entry(), defaults: { quality: 'bad\nvalue' } }, { ...entry(), defaults: { arbitrary_json: '{}' } } ])
    assert.throws(() => validateRouting({ ...value, models: [bad] }));
  assert.throws(() => validateRouting({ ...value, models: [entry(), entry()] }));
});

test('native manual IDs work without discovery and transmit saved defaults and aliases through each adapter', async () => {
  for (const [profileId, template, defaults] of [
    ['openai-images-v1', 'gemini-3-pro-image', { quality: 'vendor-quality', size: '2048x1536', output_format: 'webp' }],
    ['gemini-native-v1', 'gpt-image-2', { aspect_ratio: '7:5', image_size: '8K' }],
  ]) {
    const { connections } = service(), routing = config(profileId), alias = '渠道/render custom?mode=2#v3@relay';
    routing.models = [entry(template, defaults)];
    routing.links.a = { 'model-custom': { id: alias, manual: true, on: true } };
    await connections.save(routing); connections.supplyKey('key-a', 'synthetic-only');
    const requests = [], gateway = createGateway(connections.context('a'), async (url, init) => {
      requests.push({ url, init });
      return url.pathname.endsWith('/models') ? Response.json({ error: 'key synthetic-only was rejected' }, { status: 401 }) : Response.json({ ok: true });
    });
    await assert.rejects(gateway.rawCatalog(), { message: '鉴权失败（401），请检查 API Key' });
    const [model] = (await gateway.catalog()).models;
    await gateway.catalog();
    assert.equal(requests.length, 2, 'a failed discovery is not repeated by each execution lookup');
    assert.equal(model.id, 'model-custom'); assert.equal(model.upstreamId, alias);
    assert.equal(sourceState(routing, 'a', configuredModels(routing).at(-1), []), 'on');
    await gateway.execute(buildChatPayload(model, 'synthetic prompt', {}), r => r.json());
    const { url, init } = requests.at(-1), body = JSON.parse(init.body);
    if (profileId === 'openai-images-v1') {
      assert.equal(body.model, alias);
      for (const [key, value] of Object.entries(defaults)) assert.equal(body[key], value);
    } else {
      assert.ok(url.pathname.endsWith(`/models/${encodeURIComponent(alias)}:generateContent`));
      assert.deepEqual(body.generationConfig.imageConfig, { aspectRatio: '7:5', imageSize: '8K' });
    }
    assert.equal(requests.filter(r => r.init.method === 'POST').length, 1);
    connections.dispose();
  }
});

test('standard manual mapping preserves quote protection and explicit defaults with incomplete directory fields', async () => {
  const { connections } = service(), routing = config('koma-standard-v1');
  routing.models = [entry('gpt-image-2', { quality: 'vendor-quality', size: '2048x2048' })];
  routing.links.a = { 'model-custom': { id: 'vendor-id', manual: true, on: true } };
  await connections.save(routing); connections.supplyKey('key-a', 'synthetic-only');
  let metadata = { studio_features: { version: 2, max_cost: true }, models: { 'vendor-id': { editor_family: 'gpt', operations: ['generate', 'edit'], tools: ['image-edit'], image_capabilities: { fields: { quality: { options: ['vendor-quality'], default: 'vendor-quality' } } } } } };
  const requests = [], fetcher = async (url, init) => {
    requests.push({ url, init });
    return Response.json(url.pathname.endsWith('/models') ? metadata : url.pathname.endsWith('/estimate') ? { cost: 3 } : { ok: true });
  };
  const gateway = createGateway(connections.context('a'), fetcher);
  const [model] = (await gateway.catalog()).models;
  await gateway.execute(buildChatPayload(model, 'test', {}), r => r.json());
  const sent = requests.filter(r => r.init.method === 'POST').map(r => JSON.parse(r.init.body));
  assert.equal(sent.length, 2); assert.equal(sent[0].model, 'vendor-id');
  assert.equal(sent[1].max_cost, 3); assert.equal(sent[1].image_options.quality, 'vendor-quality');
  metadata = { ...metadata, models: { 'another-id': { provider: 'novelai' } } };
  assert.equal((await gateway.catalog(true)).models.find(m => m.id === 'model-custom').upstreamId, 'vendor-id');
  metadata = { ...metadata, studio_features: { version: 1, max_cost: false } };
  await assert.rejects(gateway.catalog(true), /报价保护/);
  connections.dispose();
});

test('deletion removes standard aliases without removing unrelated gateway tools; NAI sources remain isolated', () => {
  const routing = config('koma-standard-v1'); routing.models = [];
  const raw = { models: { 'vendor-image': { provider: 'openai', editor_family: 'gpt' }, 'vendor-banana': { editor_family: 'gemini' }, 'fal-upscaler': { provider: 'fal' } } };
  assert.deepEqual(normalizeCatalog(raw, routing, 'a').models.map(m => m.id), ['fal-upscaler']);
  routing.connections.nai = connection('nai-official-v1', 'nai');
  for (const m of configuredModels({})) assert.equal(supportsModel(routing, 'nai', m), m.family === 'novelai');
  routing.models = [entry()];
  routing.links.nai = { 'model-custom': { id: 'bad-map', on: true, manual: true } };
  assert.equal(sourceState(routing, 'nai', configuredModels(routing).at(-1), [{ id: 'bad-map' }]), 'miss');
  const mapped = nativeMappedCatalog(profileFor('koma-standard-v1'), raw, routing, 'a');
  assert.equal(Object.keys(mapped.models).length, 3);
});

test('model edits and both interface flags survive persistence, another reader and backups without credentials', async () => {
  const { connections, storage, saved } = service(), routing = config('openai-chat-images-v1');
  routing.models = [entry('gemini-3-pro-image', { image_size: '4K' })];
  routing.links.a = { 'model-custom': { id: 'special render id', manual: true, on: true } };
  await connections.save(routing); connections.supplyKey('key-a', 'synthetic-secret');
  const other = service(undefined, saved).connections;
  assert.deepEqual(other.configuration.models, routing.models);
  const preferences = collectBackupPreferences(storage), backup = validateBackupManifest(manifest(preferences));
  const restored = JSON.parse(backup.preferences.routing);
  assert.deepEqual(restored.models, routing.models); assert.deepEqual(restored.links, routing.links);
  assert.equal(imageConnections(restored).length, 1); assert.equal(reasoningConnections(restored).length, 1);
  assert.ok(!JSON.stringify(backup).includes('synthetic-secret'));
  for (const profileId of ['openai-chat-v1', 'openai-images-v1', 'openai-chat-images-v1']) {
    routing.connections.a.profileId = profileId; await connections.save(routing);
    assert.equal(connections.context('a').key(), 'synthetic-secret');
    assert.deepEqual(connections.configuration.links, routing.links);
  }
  connections.dispose(); other.dispose();
});

test('local model entries persist separately from readonly server connections and round-trip in backups', async () => {
  const { connections, storage } = service({ baseUrl: 'http://127.0.0.1:9999/api', token: 'runtime-only' });
  const routing = structuredClone(connections.configuration); routing.models = [entry()];
  await connections.save(routing); connections.reload();
  assert.deepEqual(connections.configuration.models, routing.models);
  assert.equal(storage.getItem(names.routing), null);
  const backup = validateBackupManifest(manifest(collectBackupPreferences(storage)));
  assert.deepEqual(JSON.parse(backup.preferences.localModelEntries), routing.models);
  assert.ok(!JSON.stringify(backup).includes('runtime-only'));
  connections.dispose();
});

test('shared supplier routes ASK and Images through one URL and credential with independent adapters', async () => {
  const { connections } = service(); await connections.save(config('openai-chat-images-v1'));
  connections.supplyKey('key-a', 'shared-synthetic-key');
  const context = connections.context('a'), requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    if (url.pathname.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-image-2' }, { id: 'arbitrary-text-id' }] });
    if (url.pathname.endsWith('/chat/completions')) return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    return Response.json({ ok: true });
  };
  const gateway = createGateway(context, fetcher), [model] = (await gateway.catalog()).models;
  await gateway.execute(buildChatPayload(model, 'image prompt', {}), r => r.json());
  const events = [];
  for await (const event of createProvider(context, fetcher).stream({ model: 'arbitrary-text-id', tools: [], system: ['test'], maxTokens: 100, messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }] })) events.push(event);
  assert.ok(events.length);
  assert.deepEqual(requests.map(r => r.url.pathname), ['/v1/models', '/v1/images/generations', '/v1/chat/completions']);
  assert.ok(requests.every(r => r.init.headers.Authorization === 'Bearer shared-synthetic-key'));
  assert.equal(JSON.parse(requests.at(-1).init.body).model, 'arbitrary-text-id');
  connections.dispose();
});

test('source parameters: declared fields win over reference presets, empty defaults omit fields, manual overrides survive refresh and backups', async () => {
  const { connections, storage } = service(), routing = config('openai-images-v1');
  routing.connections.b = connection('openai-images-v1', 'b');
  routing.models = [entry()];
  const parameters = { quality: null, vendor_steps: { type: 'number', options: [], min: 1, max: 40, default: '12' }, watermark: { type: 'boolean', options: ['true', 'false'], default: 'false' } };
  routing.links = {
    a: { 'model-custom': { id: 'vendor-render', manual: true, on: true, parameters } },
    b: { 'model-custom': { id: 'vendor-render', manual: true, on: true } },
  };
  await connections.save(routing); connections.supplyKey('key-a', 'synthetic-only');
  let fields = { quality: { options: ['upstream-special'], default: '' }, vendor_steps: { type: 'number', options: [], min: 1, max: 80, default: '20' } };
  const calls = [], fetcher = async (url, init) => {
    calls.push({ url, init });
    return url.pathname.endsWith('/models') ? Response.json({ data: [{ id: 'vendor-render', image_capabilities: { fields } }] }) : Response.json({ ok: true });
  };
  const client = createGateway(connections.context('a'), fetcher);
  let [model] = (await client.catalog()).models;
  assert.equal(model.parameterSource, 'declared');
  assert.equal(model.fields.quality, undefined); assert.equal(model.fields.size, undefined);
  assert.equal(model.fields.vendor_steps.max, 40);
  assert.deepEqual(normalizeOptions(model), { vendor_steps: '12', watermark: 'false' });
  assert.equal(supportsSourcePayload(model, { model: model.id, image_options: { vendor_steps: '41' } }), false);
  assert.equal(supportsSourcePayload(model, { model: model.id, image_options: { undeclared: 'x' } }), false);
  assert.equal(supportsSourcePayload(model, { model: model.id, image_options: { watermark: 'false' } }), true);
  await client.execute(buildChatPayload(model, 'test', {}), r => r.json());
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { model: 'vendor-render', prompt: 'test', n: 1, vendor_steps: 12, watermark: false });
  await client.execute(buildChatPayload(model, 'test', { vendor_steps: '', watermark: '' }), r => r.json());
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { model: 'vendor-render', prompt: 'test', n: 1 });
  const before = calls.length;
  await assert.rejects(client.execute({ model: model.id, image_options: { vendor_steps: '41' } }, r => r.json()), /vendor_steps/);
  await assert.rejects(client.execute({ model: model.id, image_options: { undeclared: 'x' } }, r => r.json()), /undeclared/);
  assert.equal(calls.length, before, 'invalid options never submit a request');
  fields = { quality: { options: ['refreshed'], default: 'refreshed' }, vendor_steps: { type: 'number', options: [], default: '30' } };
  [model] = (await client.catalog(true)).models;
  assert.equal(model.fields.quality, undefined); assert.equal(model.fields.vendor_steps.default, '12');
  assert.deepEqual(connections.configuration.links.a['model-custom'].parameters, parameters);
  const raw = { models: { 'vendor-render': { image_capabilities: { fields } } } };
  const [other] = normalizeCatalog(nativeMappedCatalog(profileFor('openai-images-v1'), raw, routing, 'b'), routing, 'b', profileFor('openai-images-v1')).models;
  assert.equal(other.fields.quality.default, 'refreshed'); assert.equal(other.fields.watermark, undefined);
  const backup = validateBackupManifest(manifest(collectBackupPreferences(storage)));
  assert.deepEqual(JSON.parse(backup.preferences.routing).links.a['model-custom'].parameters, parameters);
  connections.dispose();
});

test('source parameters: Gemini scalar extension paths and Images multipart carry configured types without changing image data or mandatory fields', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGRkAAAAASUVORK5CYII=';
  for (const profile of ['gemini-native-v1', 'openai-images-v1']) {
    const { connections } = service(), routing = config(profile), gemini = profile === 'gemini-native-v1';
    routing.models = [entry(gemini ? 'gemini-3-pro-image' : 'gpt-image-2')];
    routing.links.a = { 'model-custom': { id: 'custom-render', manual: true, on: true, parameters: gemini
      ? { temperature: { type: 'number', options: [], min: 0, max: 2, default: '0.5' }, 'imageConfig.imageSize': { options: ['2K', '4K'], default: '4K' }, image_size: null }
      : { watermark: { type: 'boolean', options: [], default: 'false' }, compression: { type: 'number', options: [], default: '80' } } } };
    await connections.save(routing); connections.supplyKey('key-a', 'synthetic-only');
    const calls = [], client = createGateway(connections.context('a'), async (url, init) => {
      calls.push({ url, init });
      return url.pathname.endsWith('/models') ? Response.json(gemini ? { models: [{ name: 'models/custom-render' }] } : { data: [{ id: 'custom-render' }] }) : Response.json({ ok: true });
    });
    const [model] = (await client.catalog()).models;
    assert.equal(model.parameterSource, 'reference');
    await client.execute(buildChatPayload(model, 'test', {}, [png]), r => r.json());
    const body = calls.at(-1).init.body;
    if (gemini) {
      const data = JSON.parse(body);
      assert.deepEqual(data.generationConfig, { responseModalities: ['TEXT', 'IMAGE'], temperature: .5, imageConfig: { imageSize: '4K' } });
      assert.equal(data.contents[0].parts[1].inlineData.data, png.split(',')[1]);
    } else {
      assert.ok(body instanceof FormData);
      assert.equal(body.get('watermark'), 'false'); assert.equal(body.get('compression'), '80');
      assert.equal(body.get('n'), '1'); assert.equal(body.has('quality'), false);
      assert.deepEqual(Buffer.from(await body.get('image[]').arrayBuffer()), Buffer.from(png.split(',')[1], 'base64'));
    }
    connections.dispose();
  }
});

test('source parameters: standard Gemini edit converts image_size only at the selected source and keeps quote ceiling protection', async () => {
  const { connections } = service(), routing = config('koma-standard-v1');
  routing.models = [entry('gemini-3-pro-image')];
  routing.links.a = { 'model-custom': { id: 'vendor-banana', manual: true, on: true } };
  await connections.save(routing); connections.supplyKey('key-a', 'synthetic-only');
  const sent = [], client = createGateway(connections.context('a'), async (url, init) => {
    if (url.pathname.endsWith('/models')) return Response.json({ studio_features: { version: 2, max_cost: true }, models: { 'vendor-banana': { editor_family: 'gemini', operations: ['generate', 'edit'], tools: ['image-edit'], image_capabilities: { fields: { image_size: { options: ['1K', '2K'], default: '' } } } } } });
    sent.push(JSON.parse(init.body));
    return Response.json(url.pathname.endsWith('/estimate') ? { cost: 3 } : { ok: true });
  });
  const [model] = (await client.catalog()).models;
  const payload = buildChatPayload(model, 'test', { image_size: '2K' }, ['synthetic-reference']);
  assert.equal(supportsSourcePayload(model, payload), true);
  await client.execute(payload, r => r.json());
  assert.deepEqual(payload.image_options, { image_size: '2K' });
  assert.ok(sent.every(body => body.image_options.output_size === '2k' && body.image_options.image_size === undefined));
  assert.equal(sent.at(-1).max_cost, 3);
  connections.dispose();
});

test('source parameters: validation rejects reserved paths, non-scalar schemas and inconsistent values', () => {
  for (const parameters of [
    JSON.parse('{"__proto__":{"options":[]}}'), { 'imageConfig.constructor.foo': { options: [] } }, { model: { options: [] } },
    { responseModalities: { options: [] } }, { foo: { type: 'object', options: [] } },
    { steps: { type: 'number', options: [], min: 10, max: 1 } }, { steps: { type: 'number', options: [], default: 'NaN' } },
    { watermark: { type: 'boolean', options: [], default: 'yes' } }, { quality: { options: ['high'], default: 'unsupported' } },
    { foo: { options: [], default: {} } }, { foo: { options: [], default: [] } }, { foo: { options: [], default: Infinity } },
  ]) assert.throws(() => validateParameterOverrides(parameters));
});
