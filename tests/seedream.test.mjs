import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnections } from '../src/services/connections.ts';
import { createGateway, QuoteUnsupported } from '../src/gateway/client.ts';
import { seedreamProfile, standardProfile, connectionProfiles, profileFor } from '../src/gateway/profile.ts';
import { nativeRequest } from '../src/gateway/native-protocols.ts';
import { testConnection } from '../src/gateway/connection-test.ts';
import { endpoint } from '../src/gateway/transport.ts';
import { validateRouting } from '../src/config/connections.ts';
import { buildChatPayload, isGenerativeEditorModel } from '../src/domain/media.ts';
import { SEEDREAM_LITE, SEEDREAM_PRO, SEEDREAM_FLASH, SEEDREAM_55, validateSeedreamSize } from '../src/domain/seedream.ts';

const png = 'data:image/png;base64,AA==';
async function setup(profile, raw, { template = SEEDREAM_LITE, alias = template, manual = false, discoveryStatus = 200, generationStatus = 200, parameters } = {}) {
  const store = new Map(), calls = [];
  const connections = createConnections({ getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, work => work());
  const routing = { version: 1, connections: { test: { id: 'test', name: 'Synthetic', baseUrl: 'https://gateway.example.test' + (profile === seedreamProfile ? '/api/v3' : '/v1'), profileId: profile.id, credentialRef: 'synthetic', revision: 'r1' } }, links: { test: { [template]: { id: alias, on: true, manual, ...(parameters ? { parameters } : {}) } } } };
  await connections.save(routing); connections.supplyKey('synthetic', 'synthetic-key');
  const fetcher = async (url, init) => {
    calls.push({ path: url.pathname, init, body: init.body ? JSON.parse(init.body) : undefined });
    if (url.pathname.endsWith('/models')) return Response.json(raw, { status: discoveryStatus });
    if (url.pathname.endsWith('/estimate')) return Response.json({ cost: 3 });
    return Response.json(generationStatus === 200 ? { data: [{ b64_json: 'AA==' }] } : { error: 'synthetic failure' }, { status: generationStatus });
  };
  const context = connections.context('test');
  return { connections, routing, context, calls, fetcher, gateway: createGateway(context, fetcher) };
}

test('Seedream: official JSON generation and reference editing share one endpoint, preserve data and boolean options', async () => {
  const t = await setup(seedreamProfile, { data: [{ id: SEEDREAM_LITE }] });
  const [model] = (await t.gateway.catalog()).models;
  assert.equal(model.templateId, SEEDREAM_LITE);
  assert.equal(model.maxImages, 14);
  assert.equal(isGenerativeEditorModel(model), true);
  assert.deepEqual(model.fields.size.options, ['2K', '3K', '4K']);
  assert.equal((await testConnection(t.context, t.fetcher)).s, 'ok');
  for (const input of [[], [png], [png, png]]) {
    const output = await t.gateway.execute(buildChatPayload(model, 'exact prompt', { watermark: 'false' }, input), r => r.json());
    const last = t.calls.at(-1);
    assert.equal(last.path, '/api/v3/images/generations');
    assert.equal(last.init.headers.Authorization, 'Bearer synthetic-key');
    assert.deepEqual(last.body, { model: SEEDREAM_LITE, prompt: 'exact prompt', response_format: 'b64_json', size: '2K', output_format: 'png', watermark: false,
      ...(input.length ? { image: input.length === 1 ? png : input } : {}) });
    assert.equal(output.quote, null);
  }
  const before = t.calls.length;
  await assert.rejects(t.gateway.estimate({ model: model.id }), QuoteUnsupported);
  assert.equal(t.calls.length, before);
  assert.equal(t.calls.filter(c => /estimate|quota|token_stats/.test(c.path)).length, 0);
});

test('Seedream: Lite/Pro/Flash sizes and image limits follow template even for custom upstream IDs', async () => {
  for (const [template, images, good, bad] of [[SEEDREAM_LITE, 14, '4K', '1K'], [SEEDREAM_PRO, 10, '1.5K', '4K'], [SEEDREAM_FLASH, 10, '2K', '3K']]) {
    const t = await setup(seedreamProfile, { data: [{ id: 'provider/custom-id' }] }, { template, alias: 'provider/custom-id', manual: true });
    const [model] = (await t.gateway.catalog()).models;
    await t.gateway.execute(buildChatPayload(model, 'test', { size: good }, Array(images).fill(png)), r => r.json());
    assert.equal(t.calls.at(-1).body.model, 'provider/custom-id');
    assert.throws(() => buildChatPayload(model, 'test', {}, Array(images + 1).fill(png)), /最多/);
    const before = t.calls.length;
    await assert.rejects(t.gateway.execute(buildChatPayload(model, 'test', { size: bad }), r => r.json()), /分辨率档位/);
    await assert.rejects(t.gateway.execute(buildChatPayload(model, 'test', { size: '100x100' }), r => r.json()), /总像素/);
    assert.equal(t.calls.length, before);
  }
  for (const bad of ['auto', '0x100', '16384x1', '9007199254740992x9007199254740992', 2048]) assert.throws(() => validateSeedreamSize(bad, SEEDREAM_LITE));
  validateSeedreamSize('2048x2048', SEEDREAM_LITE);
  validateSeedreamSize('1024x1024', SEEDREAM_PRO);
});

test('Seedream 5.5: manual model binding works without discovery, supports transparent background with PNG guard, and auto-matches official aliases', async () => {
  const t = await setup(seedreamProfile, { error: 'no listing' }, { template: SEEDREAM_55, alias: 'vendor/future-image', manual: true, discoveryStatus: 404 });
  const [model] = (await t.gateway.catalog()).models;
  assert.equal(model.name, 'Seedream 5.5');
  assert.deepEqual(model.fields.size.options, ['1K', '1.5K', '2K']);
  assert.deepEqual(model.fields.background.options, ['auto', 'transparent', 'opaque']);
  assert.equal(model.fields.background.default, 'auto');
  await t.gateway.execute(buildChatPayload(model, 'test', { size: '3072x2048', background: 'transparent', output_format: 'png' }), r => r.json());
  assert.equal(t.calls.at(-1).body.model, 'vendor/future-image');
  assert.equal(t.calls.at(-1).body.background, 'transparent');
  assert.equal(t.calls.at(-1).body.output_format, 'png');
  // Transparent background rejects JPEG both at payload builder and native request boundary.
  assert.throws(() => buildChatPayload(model, 'test', { background: 'transparent', output_format: 'jpeg' }), /PNG/);
  assert.throws(() => nativeRequest(seedreamProfile, { model: 'vendor/future-image', prompt: 'test', image_options: { background: 'transparent', output_format: 'jpeg' } }), /PNG/);
  await t.gateway.catalog();
  assert.equal(t.calls.filter(c => c.path.endsWith('/models')).length, 1);
  t.routing.links.test[SEEDREAM_55].on = false;
  await t.connections.save(t.routing);
  await assert.rejects(createGateway(t.connections.context('test'), t.fetcher).catalog());
  assert.equal(t.calls.filter(c => c.path.endsWith('/generations')).length, 1);

  // Official Seedream 5.5 aliases auto-match without manual links and standard gateway forwards background.
  const auto = await setup(seedreamProfile, { data: [{ id: 'dola-seedream-5-5-261028' }] }, { template: SEEDREAM_55, alias: 'dola-seedream-5-5-261028', manual: false });
  const [matched] = (await auto.gateway.catalog()).models;
  assert.equal(matched.id, SEEDREAM_55);
  assert.equal(matched.upstreamId, 'dola-seedream-5-5-261028');
  assert.equal(matched.fields.background.default, 'auto');

  const stdRaw = { studio_features: { version: 2, max_cost: true }, models: { 'doubao-seedream-5-5': {
    provider_id: 'byteplus', editor_family: 'seedream', operations: ['generate', 'edit'], tools: ['image-edit'],
  } } };
  const std = await setup(standardProfile, stdRaw, { template: SEEDREAM_55, alias: 'doubao-seedream-5-5', manual: false });
  const [stdModel] = (await std.gateway.catalog()).models;
  await std.gateway.execute(buildChatPayload(stdModel, 'transparent sticker', { background: 'transparent' }), r => r.json());
  assert.equal(std.calls.at(-1).body.image_options.background, 'transparent');
  assert.equal(std.calls.at(-1).body.image_options.output_format, 'png');
});

test('Seedream: unsupported result modes fail before submission and server rejection never retries', async () => {
  const payload = { model: SEEDREAM_LITE, prompt: 'test', image_options: {} };
  for (const image_options of [{ response_format: 'url' }, { sequential_image_generation: 'auto' }, { layer_decomposition: true }, { stream: true }, { n: 4 }])
    assert.throws(() => nativeRequest(seedreamProfile, { ...payload, image_options }));
  assert.throws(() => nativeRequest(seedreamProfile, { ...payload, tool: 'image-edit', init_image: png, mask_image: png }), /蒙版/);
  // Layer decomposition accepts strictly 1 image, expands nested max_images, omits background, and rejects invalid counts.
  const decomp = nativeRequest(seedreamProfile, {
    model: 'doubao-seedream-5-5',
    prompt: '拆出右马尾和袖子',
    tool: 'image-edit',
    init_image: png,
    additional_images: [],
    image_options: {
      layer_decomposition: true,
      'layer_decomposition_options.max_images': 10,
      background: 'transparent',
      size: 'auto',
      output_format: 'png',
      watermark: false,
    },
  });
  assert.equal(decomp.path, '/images/generations');
  assert.equal(decomp.body.layer_decomposition, true);
  assert.deepEqual(decomp.body.layer_decomposition_options, { max_images: 10 });
  assert.equal(decomp.body.background, undefined);
  assert.equal(decomp.body.size, 'auto');
  assert.equal(decomp.body.image, png);
  assert.throws(() => nativeRequest(seedreamProfile, {
    model: 'doubao-seedream-5-5',
    prompt: '',
    tool: 'image-edit',
    init_image: png,
    additional_images: [png],
    image_options: { layer_decomposition: true },
  }), /1 张输入图/);
  assert.throws(() => nativeRequest(seedreamProfile, {
    model: 'doubao-seedream-5-5',
    prompt: '',
    tool: 'image-edit',
    init_image: png,
    image_options: { layer_decomposition: true, 'layer_decomposition_options.max_images': 1 },
  }), /2 至 100/);
  const t = await setup(seedreamProfile, { data: [{ id: SEEDREAM_LITE }] }, { generationStatus: 503 });
  const [model] = (await t.gateway.catalog()).models;
  await assert.rejects(t.gateway.execute(buildChatPayload(model, 'test', {}), r => r.json()), /synthetic failure/);
  assert.equal(t.calls.filter(c => c.init.method === 'POST').length, 1);
  assert.deepEqual(t.gateway.successfulModels(), []);
});

test('Seedream connection evidence: record successful upstream IDs only after the image consumer succeeds', async () => {
  const t = await setup(seedreamProfile, { data: [{ id: SEEDREAM_LITE }] });
  const cache = {};
  let notifications = 0;
  const gateway = createGateway(t.context, t.fetcher, undefined, cache, () => notifications++);
  const [model] = (await gateway.catalog()).models;
  assert.deepEqual(gateway.successfulModels(), []);
  await assert.rejects(gateway.execute(buildChatPayload(model, 'test', {}), async () => { throw new Error('synthetic decode failure'); }), /decode failure/);
  assert.deepEqual(gateway.successfulModels(), []);
  assert.equal(notifications, 0);
  await gateway.execute(buildChatPayload(model, 'test', {}), r => r.json());
  assert.deepEqual(gateway.successfulModels(), [SEEDREAM_LITE]);
  assert.equal(notifications, 1);
  assert.deepEqual(createGateway(t.context, t.fetcher, undefined, cache).successfulModels(), [SEEDREAM_LITE]);
  assert.deepEqual(createGateway(t.context, t.fetcher).successfulModels(), []);
});

test('Standard gateway: Seedream aliases keep declared controls, quote and max_cost on existing routes', async () => {
  for (const base of ['https://gateway.example.test', 'https://gateway.example.test/v1']) {
    assert.equal(endpoint(base, standardProfile.transport.paths.generate, standardProfile).pathname, '/v1/studio/image/generate');
    assert.equal(endpoint(base, standardProfile.transport.paths.native, standardProfile).pathname, '/ai/generate-image');
  }
  const alias = 'channel/seedream-5@cn';
  const raw = { studio_features: { version: 2, max_cost: true }, models: { [alias]: {
    provider_id: 'byteplus', editor_family: 'seedream', operations: ['generate', 'edit'], tools: ['image-edit'],
    image_capabilities: { fields: { size: { options: ['2048x2048'], default: '2048x2048' }, watermark: { type: 'boolean', options: [true, false], default: false } } },
  } } };
  {
    const t = await setup(standardProfile, raw, { alias, manual: true });
    const [model] = (await t.gateway.catalog()).models;
    assert.equal(isGenerativeEditorModel(model), true);
    assert.deepEqual(model.fields.size.options, ['2048x2048']);
    assert.equal(model.fields.output_format, undefined, 'explicit directory controls take precedence');
    for (const input of [[], [png]]) {
      await t.gateway.execute(buildChatPayload(model, 'test', {}, input), r => r.json());
      const [estimate, generate] = t.calls.slice(-2);
      assert.equal(estimate.path, input.length ? '/v1/image/tools/estimate' : '/v1/studio/image/estimate');
      assert.equal(generate.path, input.length ? '/v1/image/tools/run' : '/v1/studio/image/generate');
      assert.equal(generate.body.model, alias);
      assert.equal(generate.body.max_cost, 3);
      assert.equal(generate.body.image_options.watermark, false);
      assert.equal(generate.body.init_image, input[0]);
    }
  }
  const missingFields = structuredClone(raw); delete missingFields.models[alias].image_capabilities;
  const t = await setup(standardProfile, missingFields, { alias, manual: true });
  const [model] = (await t.gateway.catalog()).models;
  assert.equal(model.parameterSource, 'reference'); assert.equal(model.fields.size.default, '2K');
  const unprotected = await setup(standardProfile, { ...raw, studio_features: {} }, { alias, manual: true });
  await assert.rejects(unprotected.gateway.catalog(), /报价保护/);
  assert.equal(unprotected.calls.filter(c => c.init.method === 'POST').length, 0);
});


test('one standard gateway: the short-lived duplicate ID retains connection and mapping data', () => {
  assert.deepEqual(connectionProfiles.filter(p => p.protocol === 'standard').map(p => p.id), ['koma-standard-v1']);
  assert.equal(profileFor('image-studio-v1'), standardProfile);
  const connection = { id: 'test', name: 'Synthetic', baseUrl: 'https://gateway.example.test/v1', profileId: 'image-studio-v1', credentialRef: 'saved-key-ref', revision: 'r1' };
  const links = { test: { [SEEDREAM_LITE]: { id: 'custom-seedream', manual: true, on: true } } };
  const restored = validateRouting({ version: 1, connections: { test: connection }, links });
  assert.deepEqual(restored.connections.test, { ...connection, profileId: standardProfile.id });
  assert.deepEqual(restored.links, links);
  assert.deepEqual(validateRouting(restored), restored);
});
