import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredModels, initialModelEntries } from '../src/domain/models.ts';
import { normalizeCatalog, normalizeOptions } from '../src/domain/catalog.ts';
import { validateRouting } from '../src/config/connections.ts';
import { nativeCatalog, nativeMappedCatalog, nativeRequest } from '../src/gateway/native-protocols.ts';
import { profileFor } from '../src/gateway/profile.ts';
import { toStandardPayload } from '../src/gateway/routes.ts';
import { validateParameterOverrides } from '../src/domain/model-parameters.ts';
import { supportsSourcePayload } from '../src/domain/source-funding.ts';
import { createSourcePriority } from '../src/services/source-priority.ts';
import { newConversation, contextSnapshot, beginTurn, reviveConversation } from '../src/domain/conversation.ts';
import { assetRefs } from '../src/storage/records.ts';
import { validateConversation } from '../src/storage/backup-schema.ts';

const id = 'gpt-image-2.6-sunburst', profile = profileFor('openai-images-v1');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHZkAAAAASUVORK5CYII=';
const connection = name => ({ id: name, name, baseUrl: 'https://synthetic.example.test', profileId: profile.id, credentialRef: name, revision: 'one' });
const routing = () => ({ version: 1, connections: { a: connection('a'), b: connection('b') }, links: {
  a: { [id]: { id: 'custom-channel/image-26', manual: true, on: true } },
  b: { [id]: { id: 'custom-channel/image-26', manual: true, on: true, markup: true } },
} });
function model(config, connection = 'a', declared = false, selectedProfile = profile) {
  const raw = nativeCatalog(profile, { data: [{ id: 'custom-channel/image-26', image_capabilities: { markup: declared } }] });
  return normalizeCatalog(nativeMappedCatalog(selectedProfile, raw, config, connection), config, connection, selectedProfile).models.find(m => m.id === id);
}

test('2.5 and 2.6 markup fields share source defaults, overrides and alias handling', () => {
  for (const template of ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2.6-sunburst', 'gpt-image-2.6-flare']) {
    const config = { version: 1, connections: { a: connection('a') }, links: { a: { [template]: { id: 'vendor/custom-image', manual: true, on: true } } } };
    const raw = nativeCatalog(profile, { data: [{ id: 'vendor/custom-image' }] });
    const read = () => normalizeCatalog(nativeMappedCatalog(profile, raw, config, 'a'), config, 'a', profile).models.find(m => m.id === template);
    assert.equal(read().configurationFields.markup.default, 'true');
    assert.equal(read().markup, true); assert.equal(read().fields.markup, undefined);
    assert.equal(normalizeOptions(read()).markup, undefined, 'source configuration must not become a scalar image option');
    config.links.a[template].parameters = validateParameterOverrides({ markup: null });
    assert.equal(read().markup, false);
    assert.equal(read().markupEligible, true, 'the model can still select native mode and route to another enabled source');
    config.links.a[template].parameters = validateParameterOverrides({ markup: { type: 'boolean', options: ['true', 'false'], default: 'false' } });
    assert.equal(read().configurationFields.markup.default, 'false'); assert.equal(read().markup, false);
    config.links.a[template].parameters.markup.default = 'true';
    assert.equal(read().markup, true);
  }
  const config = validateRouting(routing());
  assert.equal(model(config).markup, false);
  assert.equal(model(config, 'a', true).markup, true);
  assert.equal(model(config, 'b').markup, true);
  config.links.a[id].markup = false;
  assert.equal(model(config, 'a', true).markup, false);
  assert.equal(model(config, 'b', true, profileFor('koma-standard-v1')).markup, false);
  const mapped = model(config, 'b');
  assert.equal(mapped.upstreamId, 'custom-channel/image-26');
  assert.deepEqual(mapped.fields.complexity.options, ['low', 'medium', 'high']);
  assert.equal(mapped.fields.complexity.default, 'high');
  assert.deepEqual(normalizeOptions(mapped, { quality: '', complexity: '' }), { quality: 'auto', complexity: 'high', size: 'auto', output_format: 'png' });
  assert.ok(mapped.fields.quality.options.includes('max'));
  assert.equal(initialModelEntries().filter(m => m.id.startsWith('gpt-image-2.6-')).length, 2);
  assert.equal(configuredModels({ models: [] }).some(m => m.family === 'gpt'), false);
  config.links.a[id].markup = 'true';
  assert.throws(() => validateRouting(config), /原生标注/);
});

test('native edits send a separate PNG markup file and reject masks, scalar overrides and unsupported protocols', async () => {
  const payload = { model: id, tool: 'image-edit', init_image: png, markup_image: png, prompt: 'edit the mark', image_options: { complexity: 'medium', quality: 'xhigh' } };
  const request = nativeRequest(profile, payload);
  assert.equal(request.path, '/images/edits');
  assert.equal(request.body.getAll('image[]').length, 1);
  assert.equal(request.body.get('complexity'), 'medium');
  assert.equal(request.body.get('markup').type, 'image/png');
  assert.deepEqual(await request.body.get('markup').arrayBuffer(), await request.body.get('image[]').arrayBuffer());
  assert.equal(request.body.has('markup_image'), false);
  assert.throws(() => nativeRequest(profile, { ...payload, image_options: { markup: true } }), /Images 参数 markup 无效/);
  for (const key of ['markup', 'markup.image_url', 'images']) assert.throws(() => validateParameterOverrides({ [key]: { options: [], default: '' } }));
  assert.throws(() => nativeRequest(profile, { ...payload, mask_image: png }), /不能.*同时/);
  assert.throws(() => nativeRequest(profile, { ...payload, markup_image: png.replace('image/png', 'image/jpeg') }), /PNG/);
  assert.throws(() => nativeRequest(profileFor('gemini-native-v1'), payload), /不支持原生标注/);
  assert.throws(() => toStandardPayload(payload), /未声明原生标注/);
  assert.equal(nativeRequest(profile, { ...payload, markup_image: undefined, additional_images: [png] }).body.getAll('image[]').length, 2);
});

test('source priority skips unsupported markup before submission and never retries a submitted failure', async () => {
  const config = routing(), wanted = model(config), payload = { model: id, tool: 'image-edit', markup_image: png };
  assert.equal(supportsSourcePayload(wanted, payload), false);
  assert.equal(supportsSourcePayload(model(config, 'b'), payload), true);
  const submitted = [];
  const clients = Object.fromEntries(['a', 'b'].map(source => [source, {
    profile, catalog: async () => ({ models: [model(config, source)], samplers: [] }), quota: async () => null,
    execute: async (_payload, _consume, options) => { await options.beforeSubmit(null); submitted.push(source); throw new Error('synthetic submitted failure'); },
  }]));
  const priority = createSourcePriority({ configuration: config, hasCredential: () => true, context: () => ({ assertCurrent() {} }) }, source => clients[source]);
  assert.equal((await priority.select(wanted, undefined, payload)).model.connection, 'b');
  await assert.rejects(priority.execute(wanted, payload, () => {}), /synthetic submitted failure/);
  assert.deepEqual(submitted, ['b']);
});

test('native annotation snapshots retain independent assets, exclude the guide and survive restore without leaking into later turns', () => {
  const c = newConversation({ model: id });
  c.pendingAnnotation = { sourceAssetId: 'original', inputAssetId: 'input', guideAssetId: 'guide', text: '', singleImage: false,
    markup: { inputAssetId: 'native-input', overlayAssetId: 'overlay' }, snapshot: {
      image: { entity_key: 'sha256:synthetic', record_id: 'source', scope: { kind: 'page', id: 'test' } }, width: 32, height: 32,
      regions: [{ key: 'r', shape: 'rect', bbox: { x: .2, y: .2, w: .5, h: .5 }, comment: 'blue' }], edges: { dilate: 0, feather: 0 },
    } };
  c.mainId = 'input'; c.attachments = ['guide', 'ref'];
  const snapshot = contextSnapshot(c, 'change', 2);
  assert.deepEqual(snapshot.imageIds, ['native-input', 'ref']);
  assert.match(snapshot.text, /独立透明标注层/); assert.doesNotMatch(snapshot.text, /图 2/);
  const { turn } = beginTurn(c, snapshot, 'change', c.settings);
  assert.ok(assetRefs([c]).has('overlay'));
  assert.equal(validateConversation(structuredClone(c)).turns[0].snapshot.annotation.markup.overlayAssetId, 'overlay');
  assert.equal(reviveConversation(structuredClone(c)).turns[0].snapshot.annotation.markup.inputAssetId, 'native-input');
  assert.equal(contextSnapshot(c, 'next').annotation, undefined);
  assert.ok(!contextSnapshot(c, 'next').imageIds.includes('guide'));
  turn.snapshot.annotation.singleImage = true;
  assert.throws(() => validateConversation(c));
});
