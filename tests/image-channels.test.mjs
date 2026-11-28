import assert from 'node:assert/strict';
import test from 'node:test';
import { encode } from 'fast-png';
import { CUSTOM_IMAGES_ID, newImageChannel, readImageChannel } from '../src/config/image-channel.ts';
import { SEEDREAM_LITE, SEEDREAM_PRO, SEEDREAM_FLASH } from '../src/domain/seedream.ts';
import { createGateway } from '../src/gateway/client.ts';
import { testConnection } from '../src/gateway/connection-test.ts';
import { connectionDisplayStatus } from '../src/gateway/connection-status.ts';
import { kieImagesProfile, openRouterImagesProfile } from '../src/gateway/profile.ts';
import { supportsLayerDecomposition } from '../src/domain/catalog.ts';
import { createSourcePriority } from '../src/services/source-priority.ts';
import { reasoningConnections } from '../src/config/connections.ts';
import { supportsSourcePayload } from '../src/domain/source-funding.ts';

const gpt = 'gpt-image-2', banana = 'gemini-3.1-flash-image', sd = 'seedream-5.5';
const refs = ['data:image/png;base64,YQ==', 'data:image/jpeg;base64,Yg=='];
const kieOk = data => Response.json({ code: 200, data });
function context(profile, links = {}, models) {
  const connection = { id: 'source', profileId: profile.id, baseUrl: profile.transport.fixedBaseUrl };
  return { connection, routing: { connections: { source: connection }, links: { source: links }, models },
    key: () => 'synthetic', assertCurrent() {} };
}
const list = (...values) => ({ type: 'enum', values });
function listed(id, max, params = {}) {
  return { id, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
    supported_parameters: { input_references: { type: 'range', min: 0, max }, ...params } };
}
const directory = { data: [
  listed('openai/gpt-image-2', 16, { quality: list('auto', 'low', 'high'), background: list('opaque', 'auto') }),
  listed('google/gemini-3.1-flash-image', 14, { resolution: list('512', '1K', '4K') }),
  listed('bytedance-seed/seedream-5-5', 3, { resolution: list('1K', '2K'), output_format: list('png', 'jpeg', 'svg') }),
  listed('other/image', 14),
] };

test('Kie sends each model and operation through one task with its own options and ordered references', async () => {
  const posts = [], uploads = [], engine = createGateway(context(kieImagesProfile), async (url, init) => {
    if (url.hostname === 'out.example.test') {
      assert.equal(init.headers, undefined);
      return new Response(new Blob(['synthetic'], { type: 'image/png' }));
    }
    assert.equal(init.headers.Authorization, 'Bearer synthetic');
    if (url.pathname.endsWith('/credit')) return kieOk(10);
    if (url.pathname.endsWith('/file-base64-upload')) {
      uploads.push(JSON.parse(init.body).base64Data);
      return kieOk({ downloadUrl: 'https://in.example.test/' + uploads.length });
    }
    if (url.pathname.endsWith('/createTask')) { posts.push(JSON.parse(init.body)); return kieOk({ taskId: 'fixture' }); }
    assert.equal(url.pathname, '/api/v1/jobs/recordInfo');
    return kieOk({ state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://out.example.test/image'] }) });
  });
  const models = (await engine.catalog()).models;
  assert.equal(models.length, 15);
  assert.deepEqual(models.filter(m => [sd, gpt, banana].includes(m.id)).map(m => [m.id, m.maxImages, supportsLayerDecomposition(m)]),
    [[sd, 10, true], [gpt, 16, false], [banana, 10, false]]);
  for (const [model, id, edit, options, input] of [
    [gpt, 'gpt-image-2-text-to-image', false, { image_size: '2K', aspect_ratio: '1:1', background: 'auto' }, { resolution: '2K', aspect_ratio: '1:1' }],
    [gpt, 'gpt-image-2-image-to-image', true, { background: 'transparent' }, { resolution: '1K', background: 'transparent', input_urls: ['https://in.example.test/1', 'https://in.example.test/2'] }],
    [banana, 'nano-banana-2', false, { image_size: '4K', output_format: 'jpg' }, { resolution: '4K', output_format: 'jpg', image_input: [] }],
    [banana, 'nano-banana-2', true, { image_size: '2K' }, { resolution: '2K', image_input: ['https://in.example.test/3', 'https://in.example.test/4'] }],
  ]) {
    const payload = { model, prompt: 'test prompt', image_options: options, ...(edit ? { tool: 'image-edit', init_image: refs[0], additional_images: refs.slice(1) } : {}) };
    const run = await engine.execute(payload, async r => r.images[0].blob.text());
    assert.equal(run.value, 'synthetic');
    assert.equal(run.via.upstreamId, id);
    assert.deepEqual(posts.at(-1), { model: id, input: { prompt: 'test prompt', ...input } });
  }
  assert.deepEqual(uploads, [...refs, ...refs]);
  const incompatible = { model: gpt, image_options: { image_size: '2K', aspect_ratio: '4:5' } };
  assert.equal(supportsSourcePayload(models[1], incompatible), false);
  for (const payload of [incompatible, { model: gpt, image_options: { image_size: '4K', background: 'opaque' } },
    { model: banana, tool: 'image-edit', init_image: refs[0], additional_images: Array(10).fill(refs[1]) },
    { model: gpt, tool: 'image-edit', init_image: refs[0], layerDecomposition: {} }]) {
    await assert.rejects(engine.execute({ prompt: 'test prompt', ...payload }, assert.fail));
  }
  assert.equal(uploads.length, 4);
  assert.equal(posts.length, 4);
});

test('OpenRouter scopes enums and reference limits to the live catalog and uses the synchronous Images endpoint', async () => {
  const calls = [], ctx = context(openRouterImagesProfile);
  const fetcher = async (url, init) => {
    assert.equal(url.origin, 'https://openrouter.ai');
    assert.equal(init.headers.Authorization, 'Bearer synthetic');
    if (url.pathname === '/api/v1/images/models') return Response.json(directory);
    assert.equal(url.pathname, '/api/v1/images');
    calls.push(JSON.parse(init.body));
    return Response.json({ data: [{ b64_json: '/9j/2Q==', media_type: 'image/jpeg' }] });
  };
  const engine = createGateway(ctx, fetcher);
  assert.match((await testConnection(ctx, fetcher)).text, /公开.*待验证/);
  const first = await engine.execute({ model: gpt, prompt: 'portrait', image_options: { quality: 'high' } }, r => r.images[0].blob.type);
  assert.equal(first.value, 'image/jpeg');
  assert.equal(first.via.upstreamId, 'openai/gpt-image-2');
  assert.deepEqual(calls[0], { model: 'openai/gpt-image-2', n: 1, prompt: 'portrait', response_format: 'b64_json', quality: 'high' });
  const models = (await engine.catalog()).models;
  assert.deepEqual(models.map(m => [m.id, m.maxImages, supportsLayerDecomposition(m)]),
    [[gpt, 16, false], [banana, 14, false], [sd, 3, true]]);
  assert.deepEqual(models[2].fields.output_format.options, ['png', 'jpeg']);
  const raw = await engine.rawCatalog();
  assert.match(connectionDisplayStatus(ctx.routing, 'source', raw, { s: 'ok' }, []).label, /公开目录/);
  assert.match(connectionDisplayStatus(ctx.routing, 'source', raw, { s: 'ok' }, engine.successfulModels()).label, /已验证生图/);
  const edit = { tool: 'image-edit', init_image: refs[0], additional_images: refs.slice(1) };
  for (const [model, upstream, options, resolution] of [
    [banana, 'google/gemini-3.1-flash-image', { image_size: '512' }, '512'],
    [sd, 'bytedance-seed/seedream-5-5', { size: '2K' }, '2K'],
  ]) {
    await engine.execute({ model, prompt: 'edit', image_options: options, ...edit }, r => r.images[0].blob.type);
    assert.deepEqual(calls.at(-1), { model: upstream, n: 1, prompt: 'edit', response_format: 'b64_json', resolution,
      input_references: refs.map(url => ({ type: 'image_url', image_url: { url } })) });
  }
  for (const payload of [
    { model: sd, ...edit, additional_images: Array(3).fill(refs[0]) }, { model: sd, ...edit, layerDecomposition: {} },
    ...[{ quality: 'ultra' }, { n: 3 }, { 'provider.options.seed.layer_decomposition': true }, { background: 'transparent' }]
      .map(image_options => ({ model: gpt, image_options })),
  ]) await assert.rejects(engine.execute({ prompt: 'edit', ...payload }, assert.fail));
  assert.equal(calls.length, 3);
});

test('channel mappings respect disabled, removed and custom entries, and stale upstream fields cannot expand the live catalog', async () => {
  const ctx = context(openRouterImagesProfile, {
    [gpt]: { id: 'openai/gpt-image-2', on: false }, [banana]: { id: 'openai/gpt-image-2', on: true },
    'model-custom': { id: 'google/gemini-3.1-flash-image', on: true, manual: true, parameters: {
      image_size: { options: ['8K'], default: '8K' }, quality: { options: ['unsafe'], default: 'unsafe' },
    } },
  }, [gpt, banana, 'model-custom'].map(id => ({ id, name: id, templateId: id === 'model-custom' ? banana : id, defaults: {} })));
  const engine = createGateway(ctx, async (_url, init) => {
    assert.equal(init.method, 'GET'); return Response.json(directory);
  });
  const { models } = await engine.catalog();
  assert.deepEqual(models.map(m => m.id), ['model-custom']);
  for (const payload of [{ model: gpt }, { model: sd }, { model: banana }, { model: 'model-custom', image_options: { image_size: '8K' } }])
    await assert.rejects(engine.execute({ prompt: 'hello', ...payload }, assert.fail));
  assert.equal(models[0].fields.quality, undefined);
  const unavailable = createGateway(context(openRouterImagesProfile), async () => Response.json({ data: [listed('openai/gpt-image-2', 0), listed('unmapped/image', 16)] }));
  await assert.rejects(unavailable.catalog(), /没有.*可用/);
});

test('OpenRouter stops at a rejection or cancelled request and records success only after consumption', async () => {
  const abort = new AbortController();
  let posts = 0;
  const engine = createGateway(context(openRouterImagesProfile), async (url, init) => {
    if (url.pathname.endsWith('/models')) return Response.json(directory);
    posts++;
    if (posts === 1) return Response.json({ error: { message: 'fixture insufficient credits' } }, { status: 402 });
    if (posts === 2) { abort.abort(); init.signal.throwIfAborted(); }
    if (posts === 3) return Response.json({ data: [] });
    return Response.json({ data: [{ b64_json: '/9j/2Q==' }] });
  });
  const payload = { model: gpt, prompt: 'draw' };
  await assert.rejects(engine.execute(payload, assert.fail), /insufficient credits/);
  await assert.rejects(engine.execute(payload, assert.fail, { signal: abort.signal }), { name: 'AbortError' });
  await assert.rejects(engine.execute(payload, assert.fail), /内嵌结果图/);
  await assert.rejects(engine.execute(payload, () => { throw new Error('invalid image'); }), /invalid image/);
  assert.deepEqual(engine.successfulModels(), []);
  assert.equal(posts, 4);
});

test('a preferred image-only channel cannot block a model or split operation it does not implement', async () => {
  const source = context(kieImagesProfile), other = { ...context(openRouterImagesProfile).connection, id: 'router' };
  const routing = { ...source.routing, connections: { source: source.connection, router: other }, order: ['router', 'source'] };
  assert.deepEqual(reasoningConnections(routing), []);
  const gateway = createGateway(source, async () => kieOk(10));
  const priority = createSourcePriority({ configuration: routing, hasCredential: () => true, context: () => source }, id => {
    assert.equal(id, 'source', 'The public catalog should not be needed to split via Kie');
    return gateway;
  });
  const models = (await gateway.catalog()).models;
  const chosen = await priority.select(models.find(m => m.id === sd), undefined,
    { model: sd, tool: 'image-edit', init_image: refs[0], layerDecomposition: {} });
  assert.equal(chosen.model.connection, 'source');
  await assert.rejects(priority.select({ id: 'nai-diffusion-5-full' }), /没有支持/);
});

function customContext(format, { paths, modelIds, links } = {}) {
  const config = newImageChannel(format);
  Object.assign(config.paths, paths);
  const ctx = context({ id: CUSTOM_IMAGES_ID, transport: { fixedBaseUrl: 'https://images.example.test' } }, links);
  ctx.connection.imageChannel = readImageChannel({ ...config, modelIds });
  return ctx;
}

function kieFixture() {
  const posts = [], uploads = [];
  const fetcher = async (url, init) => {
    if (url.hostname === 'files.example.test') {
      assert.equal(init.headers, undefined);
      return new Response(new Blob(['fixture'], { type: 'image/png' }));
    }
    if (url.pathname.endsWith('/credit')) return kieOk(20);
    if (url.pathname.endsWith('/file-base64-upload')) {
      uploads.push(JSON.parse(init.body).base64Data);
      return kieOk({ downloadUrl: 'https://input.example.test/' + uploads.length });
    }
    if (url.pathname.endsWith('/createTask')) {
      posts.push(JSON.parse(init.body));
      return kieOk({ taskId: 'fixture' });
    }
    assert.equal(url.pathname, '/api/v1/jobs/recordInfo');
    const urlBase = 'https://files.example.test/';
    const result = posts.at(-1).input.image_url
      ? { resultObject: { layers_data: [{ z_index: 1, url: urlBase + 'part' }, { z_index: 0, url: urlBase + 'base' }] } }
      : { resultUrls: [urlBase + 'out'] };
    return kieOk({ state: 'success', resultJson: JSON.stringify(result) });
  };
  return { posts, uploads, fetcher };
}

test('Kie expanded templates submit their own create and edit IDs, required fields and reference keys', async () => {
  const { posts, uploads, fetcher } = kieFixture();
  const engine = createGateway(customContext('kie-images'), fetcher);
  const cases = [
    [SEEDREAM_LITE, 'seedream/5-lite', 'image_urls', { size: '4K' }, { quality: 'ultra', aspect_ratio: '1:1', output_format: 'png', nsfw_checker: false }],
    [SEEDREAM_PRO, 'seedream/5-pro', 'image_urls', { size: '2K' }, { quality: 'high', aspect_ratio: '1:1', output_format: 'png', nsfw_checker: false }],
    [SEEDREAM_FLASH, 'seedream/5-flash', 'image_urls', { size: '1.5K' }, { size: '1.5K', aspect_ratio: '1:1', output_format: 'png', nsfw_checker: false }],
    ['gpt-image-1.5', 'gpt-image/1.5', 'input_urls', {}, { aspect_ratio: '1:1', quality: 'medium' }],
    ...['flare', 'sunburst'].flatMap(v => [
      ['gpt-image-2.5-' + v, 'gpt-image-2-5-' + v, 'input_urls', { image_size: '2K', background: 'auto' }, { resolution: '2K' }],
      ['gpt-image-2.6-' + v, 'gpt-image-2-6/' + v, 'input_urls', { quality: 'max', complexity: 'medium', output_format: 'webp', output_compression: '75' },
        { resolution: '1K', quality: 'max', complexity: 'medium', output_format: 'webp', output_compression: 75 }],
    ]),
    ['gemini-2.5-flash-image', ['google/nano-banana', 'google/nano-banana-edit'], 'image_urls', { output_format: 'jpeg' }, { aspect_ratio: '1:1', output_format: 'jpeg' }],
    ['gemini-3-pro-image', ['nano-banana-pro', 'nano-banana-pro'], 'image_input', {}, { resolution: '1K', output_format: 'jpg' }],
    ['gemini-nano-banana-2.1', ['nano-banana-2-1', 'nano-banana-2-1'], 'image_input', { image_size: '4K' }, { resolution: '4K' }],
    ['gemini-3.1-flash-lite-image', ['nano-banana-2-lite', 'nano-banana-2-lite'], 'image_urls', {}, { aspect_ratio: 'auto' }],
  ];
  for (const [model, upstream, key, options, expected] of cases) {
    const ids = Array.isArray(upstream) ? upstream : [upstream + '-text-to-image', upstream + '-image-to-image'];
    for (const edit of [false, true]) {
      const payload = { model, prompt: 'fixture prompt', image_options: options, ...(edit ? { tool: 'image-edit', init_image: refs[0] } : {}) };
      const result = await engine.execute(payload, r => r.images.length);
      const input = { prompt: payload.prompt, ...expected };
      if (edit) input[key] = ['https://input.example.test/' + uploads.length];
      else if (key === 'image_input') input[key] = [];
      assert.equal(result.via.upstreamId, ids[Number(edit)]);
      assert.deepEqual(posts.at(-1), { model: result.via.upstreamId, input }, model);
      assert.equal(result.value, 1);
    }
  }
  assert.equal(posts.length, 24);
  assert.deepEqual(uploads, Array(12).fill(refs[0]));
  const { models } = await engine.catalog();
  assert.deepEqual(models.filter(supportsLayerDecomposition).map(m => m.id), [sd, SEEDREAM_PRO, SEEDREAM_FLASH]);
  assert.equal(models.find(m => m.id === 'gemini-3-pro-image').maxImages, 8);
  assert.equal(models.find(m => m.id === sd).fields.size.options.includes('3K'), true);
  for (const [model, image_options] of [
    ['gpt-image-2.5-sunburst', { image_size: '4K', aspect_ratio: '27:16' }],
    ['gpt-image-2.6-flare', { output_compression: '25', output_format: 'png' }],
    ['gemini-3.1-flash-lite-image', { image_size: '2K' }],
    [SEEDREAM_PRO, { size: '1.5K' }],
  ]) await assert.rejects(engine.execute({ model, prompt: 'fixture prompt', tool: 'image-edit', init_image: refs[0], image_options }, assert.fail));
  assert.equal(uploads.length, 12);
  assert.equal(posts.length, 24);
});

test('Kie 5.0 Pro and Flash split with automatic count and a separate size schema', async () => {
  const { posts, uploads, fetcher } = kieFixture();
  const engine = createGateway(customContext('kie-images'), fetcher);
  for (const [model, slug] of [[SEEDREAM_PRO, '5-pro'], [SEEDREAM_FLASH, '5-flash']]) {
    const payload = { model, tool: 'image-edit', init_image: refs[0], layerDecomposition: {}, image_options: { size: '1.5K' } };
    const run = await engine.execute(payload, r => r.images.map(i => i.metadata.z_index));
    assert.deepEqual(run.value, [0, 1]);
    assert.deepEqual(posts.at(-1), { model: 'seedream/' + slug + '-layer-decomposition',
      input: { image_url: 'https://input.example.test/' + uploads.length, output_format: 'png', size: '1.5K' } });
    for (const extra of [{ layerDecomposition: { maxImages: 4 } }, { layerDecomposition: { textRecognition: true } },
      { additional_images: refs }, { image_options: { nsfw_checker: false } }]) {
      await assert.rejects(engine.execute({ ...payload, ...extra }, assert.fail));
    }
  }
  await assert.rejects(engine.execute({ model: sd, tool: 'image-edit', init_image: refs[0], layerDecomposition: {}, image_options: { size: '3K' } }, assert.fail));
  assert.equal(posts.length, 2);
  assert.equal(uploads.length, 2);
});

test('split UI capabilities and submission respect source field switches and split-only tiers', async () => {
  const { posts, uploads, fetcher } = kieFixture();
  const links = {
    [SEEDREAM_PRO]: { id: 'seedream/5-pro-text-to-image', on: true, parameters: { size: null, output_format: null } },
    [sd]: { id: 'seedream/5-5-text-to-image', on: true, parameters: { size: null, output_format: null, nsfw_checker: null } },
    [SEEDREAM_FLASH]: { id: 'seedream/5-flash-text-to-image', on: true,
      parameters: { size: { options: ['2K'], default: '2K' }, output_format: { options: ['jpeg'], default: 'jpeg' } } },
  };
  const engine = createGateway(customContext('kie-images', { links }), fetcher);
  const { models } = await engine.catalog();
  const edit = { tool: 'image-edit', init_image: refs[0], layerDecomposition: {} };
  for (const model of [SEEDREAM_PRO, sd]) {
    const source = models.find(item => item.id === model);
    assert.deepEqual(source.splitFields, {});
    const disabled = { ...edit, model, image_options: { size: '2K' } };
    assert.equal(supportsSourcePayload(source, disabled), false);
    await assert.rejects(engine.execute(disabled, assert.fail), /参数/);
    await engine.execute({ ...edit, model }, result => result.images.length);
    assert.deepEqual(posts.at(-1).input, {
      image_url: 'https://input.example.test/' + uploads.length,
      ...(model === SEEDREAM_PRO ? { size: 'auto' } : {}),
    });
  }
  const flash = models.find(item => item.id === SEEDREAM_FLASH);
  assert.deepEqual(flash.splitFields.size.options, ['auto', '2K']);
  assert.deepEqual(flash.splitFields.output_format.options, ['jpeg']);
  await engine.execute({ ...edit, model: SEEDREAM_FLASH, image_options: { size: '2K' } }, result => result.images.length);
  assert.deepEqual(posts.at(-1).input, { size: '2K', output_format: 'jpeg', image_url: 'https://input.example.test/3' });
  assert.equal(uploads.length, 3);
});

test('GPT 2.6 native markup travels separately from ordered edit references on both formats', async () => {
  const png = rgba => 'data:image/png;base64,' + Buffer.from(encode({ width: 1, height: 1, data: Uint8Array.from(rgba), channels: 4 })).toString('base64');
  const original = png([40, 50, 60, 255]), markup = png([40, 50, 60, 32]);
  const model = 'gpt-image-2.6-sunburst', other = 'gpt-image-2.5-sunburst';
  const payload = { model, prompt: 'edit the mark', tool: 'image-edit', init_image: original, additional_images: [refs[1]], markup_image: markup };
  const { posts, uploads, fetcher } = kieFixture();
  const options = { output_format: 'webp', output_compression: 80 };
  const sync = [], syncFetch = async (url, init) => {
    if (url.pathname.endsWith('/models')) return Response.json({ data: [listed('openai/' + model, 2, {
      output_format: list('png', 'webp'), output_compression: { type: 'range', min: 10, max: 90 },
    }), listed('openai/' + other, 2)] });
    sync.push(JSON.parse(init.body));
    return Response.json({ data: [{ b64_json: original.split(',')[1] }] });
  };
  for (const [format, fetch, upstream] of [['kie-images', fetcher, 'gpt-image-2-6/sunburst-text-to-image'], ['openrouter-images', syncFetch, 'openai/' + model]]) {
    const engine = createGateway(customContext(format), fetch);
    const { models } = await engine.catalog();
    assert.equal(models.find(m => m.id === model).markup, true);
    assert.equal(models.find(m => m.id === other).markupEligible, false);
    await engine.execute({ ...payload, image_options: options }, r => r.images.length);
    await assert.rejects(engine.execute({ ...payload, model: other }, assert.fail), /原生标注/);
    await assert.rejects(engine.execute({ ...payload, markup_image: refs[1] }, assert.fail), /PNG/);
    await assert.rejects(engine.execute({ ...payload, image_options: { output_format: 'png', output_compression: 40 } }, assert.fail), /压缩/);
    const disabled = createGateway(customContext(format, { links: { [model]: { id: upstream, on: true, parameters: { markup: null } } } }), fetch);
    await assert.rejects(disabled.execute(payload, assert.fail), /未启用原生标注/);
  }
  assert.deepEqual(uploads, [original, refs[1], markup]);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].input.input_urls, ['https://input.example.test/1', 'https://input.example.test/2']);
  assert.equal(posts[0].input.markup, 'https://input.example.test/3');
  assert.equal(sync.length, 1);
  const image = url => ({ type: 'image_url', image_url: { url } });
  assert.deepEqual(sync[0].input_references, [image(original), image(refs[1])]);
  assert.deepEqual(sync[0].markup, image(markup));
  assert.equal(sync[0].output_compression, 80);
});

test('synchronous Seedream split uses its configured suffix and alias and returns sorted layer metadata', async () => {
  const id = 'tenant/seed', ctx = customContext('openrouter-images', { modelIds: { [sd]: { generate: id } }, paths: { layerDecompose: '/layers' } });
  const posted = [], bytes = '/9j/2Q==', base = { b64_json: bytes, layer: { z_index: 0 } };
  const part = { b64_json: bytes, layer: { z_index: 1, name: 'ear', bounding_box: { absolute: [10, 20, 40, 60] } } };
  let data = [part, base];
  const client = createGateway(ctx, async (url, init) => {
    if (url.pathname.endsWith('/models')) return Response.json({ data: [listed(id, 10, { resolution: list('1K', '2K') })] });
    assert.equal(url.pathname, '/layers');
    posted.push(JSON.parse(init.body));
    return Response.json({ data });
  });
  const payload = { model: sd, tool: 'image-edit', init_image: refs[0], layerDecomposition: { maxImages: 2 }, image_options: { size: '2K' } };
  for (const options of [{}, { maxImages: 1 }, { maxImages: 17 }, { maxImages: 2, textRecognition: true }])
    await assert.rejects(client.execute({ ...payload, layerDecomposition: options }, assert.fail));
  assert.equal(posted.length, 0);
  for (data of [[part], [base, base], [part, base, base], [{ ...base, b64_json: 'bogus' }]]) await assert.rejects(client.execute(payload, assert.fail));
  assert.deepEqual(client.successfulModels(), []);
  data = [part, base];
  const run = await client.execute(payload, r => r.images.map(i => i.metadata));
  assert.deepEqual(run.value, [base.layer, part.layer]);
  assert.equal(run.via.upstreamId, id);
  assert.equal(posted.at(-1).model, id);
  assert.equal(posted.at(-1).resolution, '2K');
  assert.equal(posted.at(-1).n, 1);
  assert.deepEqual(posted.at(-1).provider, { options: { seed: { layer_decomposition: true, layer_decomposition_options: { max_images: 2 } } } });
});

test('a catalog refresh removes unavailable templates; a directory-less relay opts into further models by ID', async () => {
  const id = 'gemini-nano-banana-2.1', upstream = 'google/' + id;
  let available = [listed('openai/gpt-image-2', 16), listed(upstream, 5), listed('novelai/nai-diffusion-5-full', 3)];
  const engine = createGateway(customContext('openrouter-images'), async () => Response.json({ data: available }));
  assert.deepEqual((await engine.catalog()).models.map(m => m.id), [gpt, id]);
  available = [listed('openai/gpt-image-2', 16)];
  assert.deepEqual((await engine.catalog(true)).models.map(m => m.id), [gpt]);
  for (const [modelIds, ids] of [[{}, [gpt, banana, sd]], [{ [id]: { generate: upstream } }, [gpt, banana, sd, id]]]) {
    const client = createGateway(customContext('openrouter-images', { paths: { catalog: '' }, modelIds }), assert.fail);
    assert.deepEqual((await client.catalog()).models.map(m => m.id), ids);
  }
  const old = customContext('kie-images', { modelIds: { [banana]: { generate: 'nano-banana-pro' } } });
  const { models } = await createGateway(old, async () => kieOk(1)).catalog();
  assert.ok(!models.some(m => m.id === 'gemini-3-pro-image'));
  assert.equal(models.find(m => m.id === banana).upstreamId, 'nano-banana-pro');
  assert.throws(() => customContext('kie-images', { modelIds: { [banana]: { generate: 'shared' }, 'gemini-3-pro-image': { generate: 'shared' } } }), /同一个上游/);
});
