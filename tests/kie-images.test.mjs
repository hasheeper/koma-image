import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateway } from '../src/gateway/client.ts';
import { testConnection } from '../src/gateway/connection-test.ts';
import { KIE_IMAGE_URL, kieImagesProfile } from '../src/gateway/profile.ts';
import { endpoint } from '../src/gateway/transport.ts';
import { SEEDREAM_55 } from '../src/domain/seedream.ts';

const connection = { id: 'kie', profileId: kieImagesProfile.id, baseUrl: KIE_IMAGE_URL };
const context = { connection, routing: { connections: { kie: connection }, links: {} }, key: () => 'synthetic-key', assertCurrent() {} };
const success = data => Response.json({ code: 200, data });

test('Kie account errors in HTTP 200 fail authentication and uploads use the fixed provider host', async () => {
  const fetcher = async () => Response.json({ code: 401, msg: 'Unauthorized' });
  await assert.rejects(createGateway(context, fetcher).catalog(), /鉴权失败/);
  assert.match((await testConnection(context, fetcher)).text, /鉴权失败/);
  const path = kieImagesProfile.transport.paths.uploadImage;
  assert.equal(endpoint(KIE_IMAGE_URL, path, kieImagesProfile).href, 'https://kieai.redpandaai.co/api/file-base64-upload');
  assert.throws(() => endpoint('https://other.example', path, kieImagesProfile), /固定/);
});

test('Kie abort ends local polling without resubmitting a paid task', async () => {
  const paths = [], signal = new AbortController();
  const gateway = createGateway(context, async url => {
    paths.push(url.pathname);
    if (url.pathname.endsWith('/credit')) return success(1);
    if (url.pathname.endsWith('/createTask')) return success({ taskId: 'synthetic-job' });
    assert.equal(url.searchParams.get('taskId'), 'synthetic-job');
    setTimeout(() => signal.abort(new DOMException('cancelled', 'AbortError')), 10);
    return success({ state: 'generating' });
  });
  const [model] = (await gateway.catalog()).models;
  assert.equal(model.id, SEEDREAM_55);
  assert.equal(model.fields.size.allowCustom, undefined);
  await assert.rejects(gateway.execute({ model: model.id, prompt: 'synthetic prompt' },
    () => assert.fail('A cancelled task must not publish a result'), { signal: signal.signal }), { name: 'AbortError' });
  assert.deepEqual(paths, ['/api/v1/chat/credit', '/api/v1/jobs/createTask', '/api/v1/jobs/recordInfo']);
  assert.deepEqual(gateway.successfulModels(), []);
});
