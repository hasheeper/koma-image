import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from './helpers/vite.mjs';
import { chromium } from 'playwright';

let server, browser, origin;
before(async () => {
  await mkdir('.local/hm1', { recursive: true });
  server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, plugins: [{ name: 'home-data-test', configureServer(dev) {
    dev.middlewares.use((req, res, next) => {
      if (!req.url.startsWith('/__home_test__')) return next();
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body>HOME data test</body></html>');
    });
  } }] });
  await server.listen(); origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

async function start(context, seed = false) {
  const page = await context.newPage();
  await page.goto(`${origin}/__home_test__`);
  await page.evaluate(async seed => {
    const { createApplicationServices } = await import('/src/services/application.ts');
    const { createDrawing } = await import('/src/services/drawing.ts');
    const { createChat } = await import('/src/services/chat.ts');
    const { createHome } = await import('/src/home/service.ts');
    const { createSlates } = await import('/src/slate/service.ts');
    const { createUi } = await import('/src/app/ui.ts');
    const { createRouter } = await import('/src/app/router.ts');
    const { effectScope } = await import('/tests/helpers/vue.mjs');
    window.names = (await import('/src/storage/names.ts')).names;
    window.dbTools = await import('/src/storage/databases.ts');
    window.errors = []; window.network = [];
    window.app = createApplicationServices({ storage: localStorage, indexedDB, locks: navigator.locks, events: window,
      channel: new BroadcastChannel(names.sync), fetch: async (...args) => { network.push(String(args[0])); throw new Error('Unexpected upstream request'); } });
    await app.start();
    window.makeImage = async (width = 1600, height = 1000, color = '#9584e6') => {
      const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d');
      ctx.fillStyle = color; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#191d26'; ctx.fillRect(0, 0, width / 3, height / 2);
      return canvas.convertToBlob({ type: 'image/png' });
    };
    if (seed) {
      const { newConversation, beginTurn, contextSnapshot, completeVersion } = await import('/src/domain/conversation.ts');
      const { hashImage } = await import('/src/services/backup.ts');
      const blob = await makeImage(512, 512), assetId = await hashImage(blob);
      const c = newConversation({ model: 'synthetic-chat', options: { quality: 'standard' } }); c.id = 'synthetic-chat'; c.title = '合成图会话';
      const { turn, version } = beginTurn(c, contextSnapshot(c, 'synthetic', 1), 'synthetic', c.settings);
      completeVersion(c, turn, version, [{ type: 'image', assetId }], null, c.selectionRevision);
      await app.data.write(async () => {
        const tx = app.databases.transaction(names.databases.chat, ['conversations', 'assets'], 'readwrite'), done = dbTools.transactionDone(tx);
        tx.objectStore('conversations').put(c);
        tx.objectStore('assets').put({ id: assetId, name: 'synthetic.png', origin: 'result', width: 512, height: 512, blob });
        await done;
      });
      await app.preferences.set(names.chatCurrent, c.id);
    }
    window.scope = effectScope();
    window.ui = scope.run(createUi); ui.confirm = async () => true;
    window.router = scope.run(createRouter);
    window.drawing = createDrawing(app, ui, router);
    window.chat = createChat(app, ui);
    window.slates = createSlates(app, drawing);
    window.home = createHome({ services: app, drawing, chat, slates, router, onError: e => errors.push(String(e)) });
    await home.ready;
    window.readPreviews = async () => dbTools.idbRequest(app.databases.transaction(names.databases.home, 'previews').objectStore('previews').getAll());
    window.shutdown = async () => { await home.dispose(); await slates.dispose(); await chat.flush(); chat.dispose(); drawing.dispose(); scope.stop(); await app.dispose(); };
  }, seed);
  await page.waitForFunction(() => !drawing.snapshot().favoritesLoading);
  return page;
}

test('HOME drawing fixtures, scaled display-only cache, refresh, cover cancellation, board deletion and ordinary backup exclusion', async () => {
  const context = await browser.newContext();
  let page = await start(context);
  try {
    const before = await page.evaluate(async () => {
      const a = drawing.snapshot().activeBoardId, b = await drawing.createBoard();
      const first = await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing, home:window.home}, await makeImage(), { width: 1600, height: 1000 }, { boardId: a, prompt: 'first' }, null);
      await home.store.flush();
      const oldUrl = home.store.previewUrl(a);
      const latest = await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing, home:window.home}, await makeImage(1600, 1000, '#ddaa77'), { width: 1600, height: 1000 }, { boardId: a, prompt: 'latest' }, null);
      await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing, home:window.home}, await makeImage(400, 800), { width: 400, height: 800 }, { boardId: b }, null);
      await drawing.toggleFavorite(first); await home.setCover(`image:${a}`, first.id);
      await home.store.setLayout('mosaic'); await home.store.remember('chat'); await home.store.flush();
      const rows = await readPreviews(), dims = [];
      for (const row of rows) { const bitmap = await createImageBitmap(row.blob); dims.push([row.boardId, bitmap.width, bitmap.height, row.blob.type]); bitmap.close(); }
      const backup = await app.backup.export(), checked = await app.backup.read(backup.blob);
      const { snapshotPictures } = await import('/src/ask/library.ts'), { createIds } = await import('/src/ask/ids.ts');
      const library = snapshotPictures(drawing.snapshot().history, drawing.snapshot().favorites, createIds());
      let revoked = false; try { await fetch(oldUrl); } catch { revoked = true; }
      return { a, b, first: first.id, latest: latest.id, dims, revoked,
        previews: rows.map(r => ({ sourceId: r.sourceId, width: r.width, height: r.height })),
        cover: home.snapshot().allLines.find(l => l.id === `image:${a}`).face,
        library: library.length, counts: backup.counts, prefs: Object.keys(checked.preferences), errors, network };
    });
    assert.equal(before.dims.length, 2);
    assert.deepEqual(before.dims.find(x => x[0] === before.a).slice(1), [1080, 675, 'image/webp']);
    assert.deepEqual(before.dims.find(x => x[0] === before.b).slice(1), [400, 800, 'image/webp']);
    assert.equal(before.previews.find(p => p.sourceId === before.latest).width, 1600);
    assert.equal(before.cover.recordId, before.first); assert.equal(before.library, 3); assert.equal(before.revoked, true);
    assert.deepEqual(before.counts, { favorites: 1, conversations: 0, images: 0 });
    assert.equal(before.prefs.includes('home'), false); assert.deepEqual(before.errors, []); assert.deepEqual(before.network, []);
    await page.evaluate(() => shutdown()); await page.close(); page = await start(context);
    const after = await page.evaluate(async ({ a, b }) => {
      const fresh = drawing.snapshot(), afterReload = home.snapshot();
      await drawing.toggleFavorite(fresh.favorites[0]); await home.store.flush();
      const unpinned = home.snapshot().allLines.find(l => l.id === `image:${a}`).face;
      await drawing.removeBoard(a); await home.store.flush();
      return { history: fresh.history.length, current: fresh.current, favorites: fresh.favorites.length,
        layout: afterReload.preferences.layout, last: afterReload.preferences.lastLocation.workspace, unpinned,
        rows: (await readPreviews()).map(r => r.boardId), covers: home.store.snapshot().preferences.covers, errors, network };
    }, before);
    assert.equal(after.history, 0); assert.equal(after.current, null); assert.equal(after.favorites, 1);
    assert.equal(after.layout, 'mosaic'); assert.equal(after.last, 'chat'); assert.equal(after.unpinned.kind, 'preview');
    assert.deepEqual(after.rows, [before.b]); assert.deepEqual(after.covers, {}); assert.deepEqual(after.errors, []); assert.deepEqual(after.network, []);
  } finally { await context.close(); }
});

test('HOME races: slow encoding, cross-tab stale writes, page-local return location and queued preferences during maintenance', async () => {
  const context = await browser.newContext(); const a = await start(context), b = await start(context);
  try {
    const result = await a.evaluate(async () => {
      const old = await makeImage(), recent = await makeImage(800, 400), boardId = drawing.snapshot().activeBoardId;
      const record = (id, blob, at) => ({ id, blob, createdAt: at, size: { width: 1600, height: 1000 }, params: { boardId }, thumbBlob: null });
      const decode = window.createImageBitmap; let release, started;
      const wait = new Promise(r => { started = r; });
      window.createImageBitmap = async (blob, ...args) => { if (blob === old) { started(); await new Promise(r => { release = r; }); } return decode(blob, ...args); };
      home.store.capture(record('slow', old, 10)); const flushing = home.store.flush(); await wait;
      home.store.capture(record('newest', recent, 30)); release(); await flushing; window.createImageBitmap = decode;
      await home.store.remember('image');
      return { source: (await readPreviews())[0].sourceId, boardId };
    });
    assert.equal(result.source, 'newest');
    await b.waitForFunction(() => home.store.snapshot().previews[0]?.sourceId === 'newest');
    await b.evaluate(async () => {
      home.store.capture({ id: 'stale-other-tab', blob: await makeImage(), createdAt: 20, size: { width: 1600, height: 1000 }, params: { boardId: drawing.snapshot().activeBoardId }, thumbBlob: null });
      await home.store.flush(); await home.store.remember('chat'); await home.store.setLayout('cols');
    });
    await a.waitForFunction(() => home.store.snapshot().preferences.layout === 'cols');
    assert.equal(await a.evaluate(() => home.store.snapshot().preferences.lastLocation.workspace), 'image');
    assert.equal(await b.evaluate(async () => (await readPreviews())[0].sourceId), 'newest');
    await b.evaluate(() => shutdown()); await b.close();
    const maintained = await a.evaluate(async () => {
      let release, started;
      const wait = new Promise(r => { started = r; });
      const lock = navigator.locks.request(names.homePreferencesLock, async () => { started(); await new Promise(r => { release = r; }); });
      await wait;
      const pref = home.store.setLayout('mosaic');
      home.store.capture({ id: 'before-maintenance', blob: await makeImage(), createdAt: 40, size: { width: 1600, height: 1000 }, params: { boardId: drawing.snapshot().activeBoardId }, thumbBlob: null });
      const maintenance = app.data.import(async () => 'imported');
      release(); await Promise.all([lock, pref, maintenance]);
      return { phase: app.data.phase, layout: home.store.snapshot().preferences.layout, source: (await readPreviews())[0].sourceId, errors, network };
    });
    assert.deepEqual(maintained, { phase: 'ready', layout: 'mosaic', source: 'before-maintenance', errors: [], network: [] });
  } finally { await context.close(); }
});

test('CHAT favorite owns original bytes, survives source deletion and backup, manual EDIT and Slate retain stable provenance', async () => {
  const context = await browser.newContext(), page = await start(context, true);
  try {
    const result = await page.evaluate(async () => {
      const c = chat.snapshot().conversations.find(c => c.id === chat.snapshot().current.id), t = c.turns[0], v = t.versions[0], assetId = v.blocks[0].assetId;
      const candidate = await chat.favoriteRecord(c.id, t.id, v.id, assetId);
      const originalBytes = await candidate.blob.text();
      await drawing.toggleFavorite(candidate); await home.setCover(`chat:${c.id}`, candidate.id);
      const { createEditor } = await import('/src/services/editor.ts');
      const editor = createEditor(app, ui, router, drawing, chat);
      await editor.open('chat', candidate.blob, 'synthetic.png', { conversationId: c.id, settings: candidate.params });
      const token = editor.beginExternalEdit();
      await editor.applyExternalEdit(token.id, { mode: 'image', image: await makeImage(512, 512, '#ddbbaa') });
      await editor.saveFavorite();
      const manual = editor.record(editor.snapshot().viewed.recordId);
      const { parseSlateEdit } = await import('/src/slate/edit.ts');
      const { snapshotPictures } = await import('/src/ask/library.ts'), { createIds } = await import('/src/ask/ids.ts');
      const library = snapshotPictures(drawing.snapshot().history, drawing.snapshot().favorites, createIds());
      const picture = library.find(p => p.id === manual.id);
      await slates.commit(parseSlateEdit({ kind: 'slate_edit', op: 'create', slate_title: '合成交付', todos: [{ op: 'add', todo_title: '修图', status: 'done', bind: { source: picture.label, caption_source: 'base', caption_mode: 'full' } }] }, null, drawing.snapshot().form, library).change);
      const delivered = await slates.asset(slates.snapshot().todos[0].binding.assetId);
      const beforeDeletion = drawing.snapshot().favorites.length;
      await chat.remove(c); await chat.flush(); await home.store.flush();
      const backup = await app.backup.export(), checked = await app.backup.read(backup.blob);
      const saved = checked.favorites.find(f => f.id === candidate.id);
      const restored = await app.backup.import(checked);
      editor.dispose();
      return { id: candidate.id, conversation: c.id, turn: t.id, version: v.id, params: candidate.params,
        bytesSame: await saved.blob.text() === originalBytes, history: drawing.snapshot().history.length,
        manual: manual.params, delivered: delivered.params, beforeDeletion, favorites: drawing.snapshot().favorites.length,
        previews: (await readPreviews()).length, covers: home.store.snapshot().preferences.covers,
        restored, counts: backup.counts, errors, network };
    });
    assert.equal(result.bytesSame, true); assert.equal(result.params.tool, 'chat');
    assert.equal(result.params.chatConversationId, result.conversation); assert.equal(result.params.chatTurnId, result.turn); assert.equal(result.params.chatVersionId, result.version);
    assert.equal(result.manual.editParent, result.id); assert.equal(result.manual.sourceRecipe.tool, 'chat');
    assert.equal(result.manual.chatConversationId, result.conversation); assert.equal(result.manual.boardId, undefined);
    assert.equal(result.delivered.chatConversationId, result.conversation); assert.equal(result.delivered.editParent, result.id);
    assert.equal(result.beforeDeletion, 2); assert.equal(result.favorites, 2); assert.equal(result.history, 0);
    assert.equal(result.previews, 0); assert.deepEqual(result.covers, {});
    assert.equal(result.restored.favorites, 0); assert.equal(result.counts.images, 0);
    assert.deepEqual(result.errors, []); assert.deepEqual(result.network, []);
  } finally { await context.close(); }
});

test('CHAT favorite control fits 320/390/768/1440px and uses the real favorite store', async () => {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const seed = await start(context, true); await seed.evaluate(() => shutdown()); await seed.close();
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(`${origin}/#/chat`);
      await page.waitForSelector('.chat-print');
      await page.evaluate(() => {
        const p = document.body.__vue_app__._instance.provides;
        const shell = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'app-shell')];
        if (shell.router.route.value.overlay) shell.router.closeOverlay();
      });
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      const art = page.locator('.chat-print').first(); await art.hover();
      const trigger = art.locator('.result-menu-trigger');
      if (await trigger.isVisible()) await trigger.click();
      const button = art.getByRole('button', { name: '收藏图片', exact: true }); await button.click();
      const star = art.getByRole('button', { name: '取消收藏', exact: true });
      if (await trigger.isVisible()) await trigger.click();
      await star.waitFor({ state: 'visible' }); assert.equal(await star.getAttribute('aria-pressed'), 'true');
      const bounds = await star.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `star at ${width}`);
      const geometry = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      assert.ok(geometry.content <= geometry.viewport + 1);
      await page.screenshot({ path: `.local/hm1/chat-favorite-${width}.png` });
      if (width === 390) {
        await page.evaluate(() => {
          const p = document.body.__vue_app__._instance.provides;
          window.shell = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'app-shell')];
          shell.image.library = 'favorites'; shell.router.switchWorkspace('image');
        });
        await page.waitForSelector('#prompt', { state: 'visible' });
        const imported = await page.evaluate(() => {
          const tile = document.querySelector('.library-item .tile'), dataTransfer = new DataTransfer();
          tile.dispatchEvent(new DragEvent('dragstart', { dataTransfer, bubbles: true, cancelable: true }));
          window.dispatchEvent(new DragEvent('drop', { dataTransfer, cancelable: true }));
          return { draggable: tile.draggable, id: dataTransfer.getData('application/x-koma-history'), importing: shell.image.importing };
        });
        assert.equal(imported.draggable, true, 'CHAT favorites remain draggable to ASK');
        assert.ok(imported.id.startsWith('chat:')); assert.equal(imported.importing, false, 'the drawing import rejects CHAT options');
        await page.evaluate(() => shell.router.switchWorkspace('chat'));
        await art.hover();
      }
      await star.click();
      await page.waitForFunction(() => {
        const p = document.body.__vue_app__._instance.provides;
        return p[Object.getOwnPropertySymbols(p).find(k => k.description === 'drawing')].snapshot().favorites.length === 0;
      });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});
