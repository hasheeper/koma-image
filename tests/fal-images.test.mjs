import assert from 'node:assert/strict';
import test from 'node:test';
import { encode } from 'fast-png';
import { newImageChannel, readImageChannel, CUSTOM_IMAGES_ID } from '../src/config/image-channel.ts';
import { reasoningConnections } from '../src/config/connections.ts';
import { supportsLayerDecomposition, normalizeOptions } from '../src/domain/catalog.ts';
import { SEEDREAM_55, SEEDREAM_PRO, SEEDREAM_FLASH, SEEDREAM_LITE } from '../src/domain/seedream.ts';
import { falImageModels } from '../src/gateway/fal-models.ts';
import { createGateway } from '../src/gateway/client.ts';

const bytes = Buffer.from(encode({ width: 512, height: 512, channels: 4, data: new Uint8Array(512 * 512 * 4) }));
const png = 'data:image/png;base64,' + bytes.toString('base64');
const ref = 'data:image/jpeg;base64,/9j/2Q==';
const base = 'https://queue.example.test/relay', asset = 'https://media.example.test';
const job = base + '/vendor/app/requests/task-1';
const submit = { request_id: 'task-1', status_url: job + '/status', response_url: job };
const file = { url: asset + '/output.png' };
function setup({ paths, ids, links, reply, status, result, onPoll } = {}) {
  const channel = newImageChannel('fal-queue');
  Object.assign(channel.paths, paths);
  const source = { id: 'fal', profileId: CUSTOM_IMAGES_ID, baseUrl: base, imageChannel: readImageChannel({ ...channel, modelIds: ids }) };
  const routing = { connections: { fal: source }, links: { fal: links ?? {} } };
  const calls = { posts: [], gets: [], files: [] };
  const client = createGateway({ connection: source, routing, key: () => 'synthetic', assertCurrent() {} }, async (url, init) => {
    if (url.origin === asset) {
      assert.equal(init.credentials, 'omit'); assert.equal(init.headers, undefined); assert.equal(init.redirect, 'error');
      calls.files.push(url.href);
      return new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } });
    }
    assert.equal(url.origin, new URL(base).origin); assert.ok(url.pathname.startsWith('/relay/'));
    assert.equal(init.headers.Authorization, 'Key synthetic'); assert.equal(init.redirect, 'error');
    if (init.method === 'POST') {
      calls.posts.push({ url: url.href, body: JSON.parse(init.body) });
      return Response.json(reply ?? submit);
    }
    calls.gets.push(url.href);
    if (url.pathname.endsWith('/status') || url.pathname.includes('/check/')) {
      onPoll?.();
      const progress = typeof status === 'function' ? status() : status;
      return Response.json(progress ?? { status: 'COMPLETED', request_id: 'task-1' });
    }
    return result instanceof Response ? result : Response.json(result ?? { images: [file] });
  });
  return { client, calls, routing };
}

test('fal templates send one flat queue request for generation and ordered references for edits', async () => {
  const { client, calls, routing } = setup();
  const { models } = await client.catalog();
  assert.equal(models.length, 17); assert.deepEqual(reasoningConnections(routing), []);
  assert.deepEqual(models.filter(supportsLayerDecomposition).map(m => m.id), [SEEDREAM_55, SEEDREAM_PRO, SEEDREAM_FLASH]);
  assert.deepEqual(calls, { posts: [], gets: [], files: [] });
  for (const m of models) {
    const binding = falImageModels.find(b => b.templateId === m.id);
    const inputs = m.maxImages > 1 ? [png, ref] : [png];
    for (const edit of [false, true]) {
      const run = await client.execute({ model: m.id, prompt: 'draw sample', image_options: normalizeOptions(m), ...(edit && {
        tool: 'image-edit', init_image: inputs[0], additional_images: inputs.slice(1),
      }) }, r => r.images[0].blob.type);
      const id = edit ? binding.edit : binding.generate, { url, body } = calls.posts.at(-1);
      assert.equal(url, base + '/' + id); assert.equal(run.via.upstreamId, id); assert.equal(run.value, 'image/png');
      assert.equal(body.prompt, 'draw sample'); assert.equal(body.num_images, 1);
      assert.equal(body.input, undefined); assert.equal(body.model, undefined);
      assert.deepEqual(body.image_urls, edit ? inputs : undefined);
      if (m.family === 'seedream') assert.equal(body.image_size, 'auto_2K');
      if (m.fields.nsfw_checker) assert.equal(body.enable_safety_checker, false);
      if (m.id === SEEDREAM_LITE) assert.equal(body.sequential_image_generation, 'disabled');
      if (m.id === 'gemini-nano-banana-2.1') assert.equal(body.resolution, '1K');
      if (binding.markup) assert.equal(body.reasoning_effort, 'high');
    }
  }
  assert.equal(calls.posts.length, 34); assert.equal(calls.files.length, 34);
  assert.deepEqual(calls.gets, Array.from({ length: 34 }, () => [job + '/status', job]).flat());
});

test('fal split uses the operation ID, respects its bounds, sorts layers, and downloads each file once', async () => {
  const baseLayer = { image: file, z_index: 0 }, part = { image: { url: asset + '/ear.png' }, z_index: 1, name: 'ear', bounding_box: { absolute: [2, 4, 8, 11] } };
  const { client, calls } = setup({ result: { images: [file, part.image], layers: [part, baseLayer] },
    ids: { [SEEDREAM_55]: { decompose: 'tenant/split' } }, paths: { layerDecompose: '/run/{model}',
      imageTask: '/check/{taskId}', imageResult: '/results/{taskId}' }, reply: { request_id: 'task-1' } });
  const payload = { model: SEEDREAM_55, tool: 'image-edit', init_image: png, layerDecomposition: { maxImages: 2, textRecognition: true }, image_options: { size: '1.5K' } };
  const run = await client.execute(payload, r => r.images.map(i => [i.metadata.z_index, i.metadata.bounding_box]));
  assert.deepEqual(run.value, [[0, undefined], [1, part.bounding_box]]); assert.equal(run.via.upstreamId, 'tenant/split');
  assert.deepEqual(calls.posts, [{ url: base + '/run/tenant/split', body: { image_url: png, image_size: 'auto_1.5K', enable_safety_checker: false, max_images: 2, enable_text_recognition: true } }]);
  assert.deepEqual(calls.files, [file.url, part.image.url]);
  assert.deepEqual(calls.gets, [base + '/check/task-1', base + '/results/task-1']);
  for (const change of [{ model: SEEDREAM_LITE }, { model: SEEDREAM_PRO }, { layerDecomposition: { maxImages: 101 } }, { image_options: { size: '3K' } }, { additional_images: [ref] }])
    await assert.rejects(client.execute({ ...payload, ...change }, assert.fail));
  assert.equal(calls.posts.length, 1);
  for (const model of [SEEDREAM_PRO, SEEDREAM_FLASH]) {
    await client.execute({ ...payload, model, layerDecomposition: {} }, r => r.images.length);
    assert.equal(calls.posts.at(-1).body.max_images, undefined); assert.equal(calls.posts.at(-1).body.image_size, 'auto_1.5K');
  }
});

test('fal GPT 2.6 sends a separate annotation and honours source parameters', async () => {
  const id = 'gpt-image-2.6-flare';
  const source = { id: 'openai/gpt-image-2.6/flare/text-to-image', on: true };
  const { client, calls } = setup({ links: { [id]: { ...source, parameters: { nsfw_checker: null } } } });
  const p = { model: id, tool: 'image-edit', prompt: 'try a new colour', init_image: png, additional_images: [ref], markup_image: png };
  await client.execute({ ...p, image_options: { output_format: 'webp', output_compression: '60', complexity: 'medium' } }, r => r.images.length);
  assert.deepEqual(calls.posts[0].body, { prompt: p.prompt, num_images: 1, image_urls: [png, ref], markup_image_url: png, output_format: 'webp', output_compression: 60, reasoning_effort: 'medium' });
  const disabled = setup({ links: { [id]: { ...source, parameters: { markup: null } } } });
  await assert.rejects(disabled.client.execute(p, assert.fail), /标注/); assert.equal(disabled.calls.posts.length, 0);
  await assert.rejects(client.execute({ ...p, model: 'gpt-image-2', markup_image: png }, assert.fail));
});

test('fal polls one submitted job through waiting and processing, then reads its result once', async () => {
  const progress = ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'];
  const { client, calls } = setup({ status: () => ({ status: progress.shift(), request_id: 'task-1' }) });
  await client.execute({ model: SEEDREAM_55, prompt: 'sample' }, r => r.images.length);
  assert.deepEqual(progress, []); assert.equal(calls.posts.length, 1);
  assert.deepEqual(calls.gets, [job + '/status', job + '/status', job + '/status', job]);
  assert.deepEqual(calls.files, [file.url]);
});

test('fal failures and cancellations never resubmit or send credentials to another queue host', async () => {
  const p = { model: SEEDREAM_55, prompt: 'sample' };
  const cases = [
    { reply: { ...submit, status_url: 'https://unrelated.example/' } },
    { reply: { ...submit, status_url: job.replace('/relay/', '/elsewhere/') + '/status' } },
    { status: { status: 'COMPLETED', request_id: 'another-job' } },
    { status: { status: 'COMPLETED', response_url: job.replace('task-1', 'another-job') } },
    { result: Response.json({ detail: 'insufficient credits' }, { status: 402 }) },
    { result: { images: [{ url: 'http://files.example/image' }] } },
  ];
  for (const c of cases) {
    const { client, calls } = setup(c);
    await assert.rejects(client.execute(p, assert.fail), /任务 task-1/);
    assert.equal(calls.posts.length, 1); assert.deepEqual(calls.files, []); assert.deepEqual(client.successfulModels(), []);
  }
  const invalid = setup({ result: Response.json({ detail: [{ loc: ['body', 'image_url'], msg: 'Image too small', input: png }] }, { status: 422 }) });
  await assert.rejects(invalid.client.execute(p, assert.fail), { message: 'image_url · Image too small（任务 task-1）' });
  assert.equal(invalid.calls.posts.length, 1); assert.deepEqual(invalid.calls.files, []);
  for (const layers of [[{ image: file, z_index: 1 }], [{ image: file, z_index: 0 }, { image: file, z_index: 0 }]]) {
    const { client, calls } = setup({ result: { layers } });
    await assert.rejects(client.execute({ ...p, init_image: png, tool: 'image-edit', layerDecomposition: {} }, assert.fail), /层序/);
    assert.deepEqual(calls.files, []);
  }
  const controller = new AbortController();
  const { client, calls } = setup({ status: { status: 'IN_QUEUE' }, onPoll: () => setTimeout(() => controller.abort(), 5) });
  await assert.rejects(client.execute(p, assert.fail, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls.posts.length, 1); assert.equal(calls.gets.length, 1);
  for (const generate of ['../another/model', 'https://elsewhere.test/model', 'abc/%2f/x']) {
    assert.throws(() => readImageChannel({ ...newImageChannel('fal-queue'), modelIds: { [SEEDREAM_55]: { generate } } }), /模型/);
  }
});
