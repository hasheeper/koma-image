import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareRoutingImport, reasoningConnections, validateRouting } from '../src/config/connections.ts';
import { CUSTOM_IMAGES_ID, newImageChannel, readImageChannel } from '../src/config/image-channel.ts';
import { supportsLayerDecomposition } from '../src/domain/catalog.ts';
import { createGateway } from '../src/gateway/client.ts';
import { connectionDisplayStatus } from '../src/gateway/connection-status.ts';
import { testConnection } from '../src/gateway/connection-test.ts';
import { connectionProfiles, editableImageChannel, profileFor } from '../src/gateway/profile.ts';
import { endpoint } from '../src/gateway/transport.ts';
import { createConnections } from '../src/services/connections.ts';

const base = 'https://images.example.test/relay/v1';
const ref = 'data:image/png;base64,YQ==';
function routing(config, links = {}) {
  return validateRouting({ version: 1, connections: { relay: { id: 'relay', name: 'relay', profileId: CUSTOM_IMAGES_ID,
    baseUrl: base, credentialRef: 'key-relay', revision: 'r1', imageChannel: config } }, links: { relay: links } });
}
function context(config) {
  return { connection: config.connections.relay, routing: config, key: () => 'synthetic-key', assertCurrent() {} };
}

test('a generic Images source uses a manual model without discovery and sends JSON generation and multipart editing to separate paths', async () => {
  const paths = { catalog: '', generate: 'render?version=2', toolRun: '/remix' };
  const config = routing({ format: 'openai-images', paths }, { 'gpt-image-2': { id: 'deployment/g2', manual: true, on: true } });
  const ctx = context(config), calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: url.href, body: init.body });
    assert.equal(init.headers.Authorization, 'Bearer synthetic-key');
    assert.equal(init.redirect, 'error');
    return Response.json({ data: [{ b64_json: 'YQ==' }] });
  };
  const client = createGateway(ctx, fetcher);
  const diagnosis = await testConnection(ctx, fetcher);
  const [model] = (await client.catalog()).models;
  assert.deepEqual(reasoningConnections(config), []);
  assert.equal(model.upstreamId, 'deployment/g2');
  assert.equal(supportsLayerDecomposition(model), false);
  const status = () => connectionDisplayStatus(config, 'relay', {}, diagnosis, client.successfulModels())?.label;
  assert.equal(status(), '使用本地模型配置');
  assert.deepEqual(calls, []);
  for (const input of [{}, { tool: 'image-edit', init_image: ref }]) {
    const run = await client.execute({ model: model.id, prompt: 'fixture', ...input }, response => response.json());
    assert.equal(run.via.upstreamId, model.upstreamId);
    assert.equal(run.quote, null);
  }
  assert.deepEqual(calls.map(call => call.url), [base + '/render?version=2', base + '/remix']);
  assert.equal(JSON.parse(calls[0].body).model, model.upstreamId);
  assert.equal(calls[1].body.get('model'), model.upstreamId);
  assert.equal(await calls[1].body.get('image[]').text(), 'a');
  assert.equal(status(), '已验证生图');
});

test('generic Gemini expands the mapped model on the configured edit endpoint and Seedream routes only a split to its optional endpoint', async () => {
  const gemini = routing({ format: 'gemini-native', paths: { generate: '/draw/{model}', toolRun: '/revise/{model}:render' } },
    { 'gemini-3.1-flash-image': { manual: true, id: 'tenant/banana 2', on: true } });
  const banana = createGateway(context(gemini), async (url, init) => {
    assert.equal(url.href, base + '/revise/tenant%2Fbanana%202:render');
    assert.equal(init.headers['x-goog-api-key'], 'synthetic-key');
    assert.equal(init.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(init.body).contents[0].parts[1].inlineData, { mimeType: 'image/png', data: 'YQ==' });
    return Response.json({ candidates: [] });
  });
  const [model] = (await banana.catalog()).models;
  await banana.execute({ model: model.id, tool: 'image-edit', init_image: ref }, response => response.json());
  const fixedPath = '/models/banana:generateContent';
  const fixed = profileFor(routing({ format: 'gemini-native', paths: { generate: fixedPath, toolRun: fixedPath } }).connections.relay);
  assert.equal(endpoint(base, fixed.transport.paths.generate, fixed, model.upstreamId).href, base + fixedPath);

  const paths = { generate: '/make', toolRun: '/edit', layerDecompose: '/layers' };
  const sd = routing({ format: 'seedream', paths }, { 'seedream-5.5': { manual: true, id: 'endpoint-a', on: true } });
  const requests = [], client = createGateway(context(sd), async (url, init) => {
    requests.push({ url: url.href, body: JSON.parse(init.body) });
    return Response.json({ data: [] });
  });
  const [layer] = (await client.catalog()).models;
  assert.ok(supportsLayerDecomposition(layer));
  for (const extra of [{}, { layerDecomposition: { maxImages: 3 } }])
    await client.execute({ model: layer.id, tool: 'image-edit', init_image: ref, ...extra }, r => r.json());
  assert.deepEqual(requests.map(r => r.url), [base + '/edit', base + '/layers']);
  assert.equal(requests[0].body.layer_decomposition, undefined);
  assert.deepEqual(requests[1].body.layer_decomposition_options, { max_images: 3 });
  assert.equal(requests[1].body.model, 'endpoint-a');
});

test('only the generic supplier is listed, older connections retain their addresses and configurable uploads can share the job path', () => {
  assert.deepEqual(connectionProfiles.filter(p => [CUSTOM_IMAGES_ID, 'kie-images-v1', 'openrouter-images-v1'].includes(p.id)).map(p => p.id), [CUSTOM_IMAGES_ID]);
  for (const id of ['kie-images-v1', 'openrouter-images-v1']) {
    const old = profileFor(id), config = editableImageChannel({ profileId: id });
    const current = profileFor(routing(config).connections.relay);
    for (const operation of Object.keys(old.transport.paths)) {
      const address = old.transport.fixedBaseUrl;
      assert.equal(endpoint(address, current.transport.paths[operation], current).href, endpoint(address, old.transport.paths[operation], old).href);
    }
  }
  const cfg = newImageChannel('kie-images');
  Object.assign(cfg.paths, { catalog: '', generate: '/submit', toolRun: '/submit', uploadImage: '/submit', imageTask: '/status?ref={taskId}' });
  cfg.uploadBaseUrl = 'https://storage.example.test/uploads';
  const profile = profileFor(routing(cfg).connections.relay);
  assert.equal(endpoint(base, '/submit', profile).href, base + '/submit');
  assert.equal(endpoint(base, '/submit', profile, undefined, 'uploadImage').href, cfg.uploadBaseUrl + '/submit');
  assert.equal(endpoint(base, cfg.paths.imageTask, profile, undefined, 'imageTask', 'job-1').href, base + '/status?ref=job-1');
  const sameHost = profileFor(routing({ ...cfg, uploadBaseUrl: '' }).connections.relay);
  assert.equal(endpoint(base, '/submit', sameHost, undefined, 'uploadImage').href, base + '/submit');
});

test('channel settings invalidate cached sources, and importing replacement endpoints cannot reuse saved keys', async () => {
  const cfg = newImageChannel('kie-images');
  const before = routing(cfg), storage = new Map();
  const connections = createConnections({ getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }, async fn => fn());
  await connections.save(before);
  connections.supplyKey('key-relay', 'fixture');
  const oldContext = connections.context('relay'), catalogKey = connections.catalogKey('relay');
  const renamed = routing({ ...cfg, modelIds: { 'seedream-5.5': { decompose: 'split-sd' } } });
  assert.equal(prepareRoutingImport(renamed, before).connections.relay.credentialRef, 'key-relay');
  await connections.save(renamed);
  assert.notEqual(connections.catalogKey('relay'), catalogKey);
  assert.throws(oldContext.assertCurrent, /改变/);
  const linkedKey = connections.catalogKey('relay');
  for (const edit of [{ paths: { ...cfg.paths, toolRun: '/other' } }, { uploadBaseUrl: 'https://upload.example.test' }]) {
    const next = routing({ ...cfg, ...edit });
    assert.notEqual(prepareRoutingImport(next, before).connections.relay.credentialRef, 'key-relay');
    await connections.save(next);
    assert.notEqual(connections.catalogKey('relay'), linkedKey);
    connections.reload();
    assert.deepEqual(connections.context('relay').connection.imageChannel, next.connections.relay.imageChannel);
  }
});

test('channel configuration rejects invalid paths, credentials in URLs and overlapping model bindings before requests', () => {
  const cfg = newImageChannel('kie-images');
  for (const path of ['https://elsewhere.example.test/draw', '//elsewhere.example.test', '/%2e%2e/draw', '/out?api_key=secret', '/{model}', '']) {
    assert.throws(() => readImageChannel({ ...cfg, paths: { ...cfg.paths, generate: path } }));
  }
  assert.throws(() => routing({ ...cfg, uploadBaseUrl: 'https://user:pass@upload.example.test' }));
  assert.throws(() => routing({ ...cfg, format: 'unknown' }));
  assert.throws(() => routing({ ...cfg, modelIds: { 'seedream-5.5': { edit: 'nano-banana-2' } } }), /同一个上游/);
  for (const format of ['openai-images', 'gemini-native', 'seedream', 'kie-images', 'openrouter-images']) {
    const profile = profileFor(routing(newImageChannel(format)).connections.relay);
    assert.equal(profile.transport.fixedBaseUrl, undefined);
    assert.equal(profile.transport.pathBases, undefined);
    assert.equal(profile.reasoning, undefined);
  }
});
