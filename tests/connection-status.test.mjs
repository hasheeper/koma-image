import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogFailureStatus, connectionDisplayStatus } from '../src/gateway/connection-status.ts';
import { GatewayRequestError } from '../src/gateway/transport.ts';
import { seedreamProfile, standardProfile } from '../src/gateway/profile.ts';
import { SEEDREAM_LITE, SEEDREAM_PRO } from '../src/domain/seedream.ts';

const setup = () => ({ version: 1, connections: { test: { id: 'test', profileId: 'seedream-v1' } }, links: {} });
const limited = () => catalogFailureStatus(seedreamProfile, new GatewayRequestError('无法连接', 'network'));
test('connection status: optional directory failure follows enabled mappings and successful upstream IDs', () => {
  const routing = setup();
  const status = () => connectionDisplayStatus(routing, 'test', undefined, limited(), ['tested-id']);
  assert.equal(status().label, '等待配置');
  routing.links.test = { [SEEDREAM_LITE]: { id: 'new-id', manual: true, on: true } };
  assert.equal(status().label, '已配置 · 1 个模型');
  assert.equal(status().s, 'wait');
  routing.links.test[SEEDREAM_PRO] = { id: 'tested-id', manual: true, on: true };
  assert.equal(status().label, '连接成功 · 2 个模型');
  routing.links.test[SEEDREAM_PRO].on = false;
  assert.equal(status().label, '已配置 · 1 个模型');
  delete routing.links.test[SEEDREAM_LITE];
  assert.equal(status().label, '等待配置');
});
test('connection status: missing keys, auth failures and standard directory errors stay actionable', () => {
  const routing = setup();
  routing.links.test = { [SEEDREAM_LITE]: { id: 'tested-id', manual: true, on: true } };
  const failures = [
    { s: 'wait', text: '未配置 Key', label: '等待配置' },
    catalogFailureStatus(seedreamProfile, new GatewayRequestError('鉴权失败（401）', 'http', 401)),
    catalogFailureStatus(seedreamProfile, new GatewayRequestError('访问被拒绝（403）', 'http', 403)),
    catalogFailureStatus(seedreamProfile, new GatewayRequestError('供应商错误', 'http', 503)),
  ];
  for (const failure of failures)
    assert.deepEqual(connectionDisplayStatus(routing, 'test', undefined, failure, ['tested-id']), failure);
  assert.equal(catalogFailureStatus(standardProfile, new GatewayRequestError('无法连接', 'network')).s, 'err');
  assert.equal(catalogFailureStatus(seedreamProfile, new GatewayRequestError('未找到', 'http', 404)).kind, 'catalog-limited');
});
test('connection status: authenticated catalog success still waits for a usable model; mixed text connections stay usable', () => {
  const routing = setup(), checked = { s: 'ok', text: '可用' };
  assert.equal(connectionDisplayStatus(routing, 'test', { models: { unknown: {} } }, checked).label, '等待配置');
  assert.equal(connectionDisplayStatus(routing, 'test', { models: { [SEEDREAM_LITE]: {} } }, checked).label, '连接成功 · 1 个模型');
  routing.connections.test.profileId = 'openai-chat-images-v1';
  assert.deepEqual(connectionDisplayStatus(routing, 'test', { models: { 'text-only': {} } }, checked), checked);
});
