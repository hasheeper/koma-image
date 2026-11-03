import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useNativeFixture, open } from './helpers/native-fixture.mjs';
useNativeFixture();

test('JSON and ZIP routing imports detach credentials before requesting a changed destination', async () => {
  for (const kind of ['json', 'zip']) {
    const t = await open('openai-images-v1'), { page } = t;
    try {
      const config = await page.evaluate(() => services.connections.configuration);
      config.connections.test.baseUrl = 'https://gateway.example.test/other';
      if (kind === 'json') {
        await page.evaluate(() => location.hash = '#/chat/settings/security');
        await page.locator('#settingsPanel[open]').waitFor();
        await page.locator('#settingsPanel .s-row').filter({ hasText: '导入配置' }).locator('input[type="file"]').setInputFiles({
          name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(config)),
        });
        await page.getByText('配置已导入', { exact: true }).waitFor();
      } else {
        await page.evaluate(async config => {
          const { createArchive } = await import('/src/storage/backup-archive.ts');
          const manifest = { app: 'koma-image', kind: 'backup', version: 2, id: crypto.randomUUID(), createdAt: new Date().toISOString(), favorites: [], conversations: [], assets: [], preferences: { routing: JSON.stringify(config) } };
          const archive = await createArchive([['koma-image-backup.json', new Blob([JSON.stringify(manifest)])]]);
          await services.backup.import(await services.backup.read(archive));
        }, config);
      }
      await page.waitForFunction(() => services.connections.configuration.connections.test.baseUrl.endsWith('/other'));
      const result = await page.evaluate(() => {
        const ref = services.connections.configuration.connections.test.credentialRef;
        let error = '';
        try { services.connections.context('test'); } catch (e) { error = e.message; }
        return { ref, error, originalKey: JSON.parse(sessionStorage.getItem('koma.session.keys') || '{}')['test-key'] };
      });
      assert.notEqual(result.ref, 'test-key');
      assert.match(result.error, /Key/);
      assert.equal(result.originalKey, 'synthetic-native-only');
      assert.equal(t.requests.some(r => r.path.startsWith('/other/')), false);
      assert.deepEqual(t.errors, []);
    } finally { await t.context.close(); }
  }
});

test('incomplete favorite metadata is rejected before ZIP import writes any data', async () => {
  const t = await open('openai-images-v1'), { page } = t;
  try {
    const result = await page.evaluate(async png => {
      const { createArchive } = await import('/src/storage/backup-archive.ts');
      const blob = new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], { type: 'image/png' });
      const manifest = { app: 'koma-image', kind: 'backup', version: 2, id: crypto.randomUUID(), createdAt: new Date().toISOString(), favorites: [{ id: 'broken', createdAt: 1, favoritedAt: 2, params: {}, image: { path: 'favorites/0.png', type: 'image/png' }, thumbnail: null }], conversations: [], assets: [], preferences: {} };
      const archive = await createArchive([['koma-image-backup.json', new Blob([JSON.stringify(manifest)])], ['favorites/0.png', blob]]);
      let error = '';
      try { await services.backup.import(await services.backup.read(archive)); } catch (e) { error = e.message; }
      const db = await new Promise((resolve, reject) => { const req = indexedDB.open('koma-image-favorites'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      try {
        const count = await new Promise((resolve, reject) => { const req = db.transaction('favorites').objectStore('favorites').count(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
        return { error, count };
      } finally { db.close(); }
    }, t.png.toString('base64'));
    assert.match(result.error, /不完整|格式/);
    assert.equal(result.count, 0);
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});
