import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";

let server, browser, origin;
before(async () => {
  // A test-only entry, outside the production bundle and public assets.
  server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false, open: false },
    plugins: [{ name: "service-test-entry", configureServer(dev) {
      dev.middlewares.use((request, response, next) => {
        if (request.url !== "/__services_test__") return next();
        response.setHeader("Content-Type", "text/html"); response.end("<!doctype html><html><body>Service test</body></html>");
      });
    } }] });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

async function start(context) {
  const page = await context.newPage();
  await page.goto(`${origin}/__services_test__`);
  await page.evaluate(async () => {
    const { createApplicationServices } = await import("/src/services/application.ts");
    const db = await import("/src/storage/databases.ts");
    const { names } = await import("/src/storage/names.ts");
    window.dbTools = db; window.names = names;
    window.app = createApplicationServices({ storage: localStorage, indexedDB, locks: navigator.locks,
      events: window, channel: new BroadcastChannel(names.sync), fetch: async () => { throw new Error("unexpected network request"); } });
    await app.start();
  });
  return page;
}

test("real browser schemas, atomic chat transactions, original Blob bytes and one startup lease", async () => {
  const context = await browser.newContext();
  const page = await start(context);
  try {
    const result = await page.evaluate(async () => {
      await app.start(); // Idempotent startup does not acquire another lease.
      const known = (await indexedDB.databases()).map(db => db.name).sort();
      const details = [];
      for (const schema of dbTools.schemas) {
        const db = await dbTools.idbRequest(indexedDB.open(schema.name));
        details.push({ name: db.name, version: db.version, stores: [...db.objectStoreNames] }); db.close();
      }
      await app.data.write(async () => {
        const tx = app.databases.transaction(names.databases.chat, ["conversations", "assets"], "readwrite");
        const done = dbTools.transactionDone(tx);
        tx.objectStore("assets").put({ id: "synthetic", blob: new Blob([new Uint8Array([0, 128, 255, 10])], { type: "image/png" }) });
        tx.objectStore("conversations").put({ id: "conversation", attachments: ["synthetic"] });
        await done;
      });
      let aborted = false;
      try {
        await app.data.write(async () => {
          const tx = app.databases.transaction(names.databases.chat, ["conversations", "assets"], "readwrite");
          const done = dbTools.transactionDone(tx);
          tx.objectStore("conversations").put({ id: "must-rollback" });
          tx.objectStore("assets").add({ id: "synthetic" }); // Duplicate key aborts both stores.
          await done;
        });
      } catch { aborted = true; }
      const tx = app.databases.transaction(names.databases.chat, ["conversations", "assets"]);
      const [asset, missing] = await Promise.all([dbTools.idbRequest(tx.objectStore("assets").get("synthetic")), dbTools.idbRequest(tx.objectStore("conversations").get("must-rollback"))]);
      return { known, details, aborted, rolledBack: missing === undefined, bytes: [...new Uint8Array(await asset.blob.arrayBuffer())],
        local: Object.keys(localStorage), session: Object.keys(sessionStorage),
        dataLocks: (await navigator.locks.query()).held.filter(lock => lock.name === names.dataLock).map(lock => lock.mode) };
    });
    assert.deepEqual(result.known, ["koma-chat", "koma-handoff", "koma-image-favorites"]);
    assert.deepEqual(result.details.map(d => d.stores), [["favorites"], ["assets", "conversations"], ["items"]]);
    assert.ok(result.details.every(d => d.version === 1));
    assert.deepEqual(result.bytes, [0, 128, 255, 10]); assert.ok(result.aborted && result.rolledBack);
    assert.deepEqual(result.local, []); assert.deepEqual(result.session, []); assert.deepEqual(result.dataLocks, ["shared"]);
    await page.evaluate(() => app.dispose());
    assert.deepEqual(await page.evaluate(async () => (await navigator.locks.query()).held), []);
  } finally { await context.close(); }
});

test("two tabs share task slots and import exclusions; closing a tab releases locks", async () => {
  const context = await browser.newContext();
  const a = await start(context), b = await start(context);
  try {
    await a.evaluate(() => {
      window.running = app.runTask({ id: "batch", workspace: "image", snapshot: {} }, async ({ signal }) => {
        window.entered = true;
        await new Promise(resolve => { window.finish = resolve; signal.addEventListener("abort", resolve, { once: true }); });
      });
    });
    await a.waitForFunction(() => window.entered);
    assert.equal(await b.evaluate(async () => (await app.runTask({ id: "chat", workspace: "chat", snapshot: {} }, async () => "unexpected")).status), "busy");
    await a.evaluate(async () => { finish(); await running; });
    assert.match(await a.evaluate(() => app.data.import(async () => "unexpected").catch(e => e.message)), /其他标签/);
    await b.close();
    await a.waitForFunction(async () => (await navigator.locks.query()).held.filter(l => l.name === names.dataLock).length === 1);
    const events = await a.evaluate(async () => {
      const events = [];
      app.data.register({ async flush() { events.push("flush"); }, async reload() { events.push("reload"); } });
      await app.data.import(async () => {
        events.push("import");
        const held = (await navigator.locks.query()).held;
        if (!held.some(l => l.name === names.dataLock && l.mode === "exclusive")) throw new Error("missing exclusive lease");
      });
      return { events, phase: app.data.phase, accepting: app.scheduler.accepting };
    });
    assert.deepEqual(events, { events: ["flush", "import", "reload"], phase: "ready", accepting: true });
  } finally { await context.close(); }
});

test("connection changes propagate without broadcasting or storing credentials; caches invalidate", async () => {
  const context = await browser.newContext();
  const a = await start(context), b = await start(context);
  try {
    await a.evaluate(async () => {
      await app.connections.save({ version: 1, connections: { primary: { id: "primary", name: "测试连接", baseUrl: "https://gateway.example.test",
        profileId: "koma-standard-v1", credentialRef: "key-primary", revision: "initial" } }, links: {} });
      app.connections.supplyKey("key-primary", "synthetic-secret");
    });
    await b.waitForFunction(() => app.connections.configuration.connections.primary?.name === "测试连接");
    assert.match(await b.evaluate(() => { try { app.gateway("primary"); return "unexpected"; } catch (e) { return e.message; } }), /Key/);
    assert.equal(await a.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes("synthetic-secret")), false);
    await a.evaluate(() => { window.oldContext = app.connections.context("primary"); });
    await b.evaluate(async () => {
      const config = structuredClone(app.connections.configuration); config.connections.primary.baseUrl = "https://another.example.test";
      await app.connections.save(config);
    });
    await a.waitForFunction(() => app.connections.configuration.connections.primary.baseUrl === "https://another.example.test");
    assert.match(await a.evaluate(() => { try { oldContext.assertCurrent(); return "unexpected"; } catch (e) { return e.message; } }), /改变/);
  } finally { await context.close(); }
});

test("application execution stays inside the slot through response consumption and cannot submit concurrently", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/__services_test__`);
    const result = await page.evaluate(async () => {
      const { createApplicationServices } = await import("/src/services/application.ts");
      const app = createApplicationServices({ storage: localStorage, indexedDB, locks: navigator.locks,
        fetch: async url => new Response(JSON.stringify(url.pathname.endsWith("estimate") ? { cost: 1 } : { image: "synthetic" })) });
      await app.start();
      await app.connections.save({ version: 1, connections: { primary: { id: "primary", name: "测试", baseUrl: "https://gateway.example.test",
        profileId: "koma-standard-v1", credentialRef: "key-primary", revision: "initial" } }, links: {} });
      app.connections.supplyKey("key-primary", "synthetic-key");
      let started, finish, escaped, concurrent;
      const ready = new Promise(resolve => { started = resolve; });
      const hold = new Promise(resolve => { finish = resolve; });
      const running = app.runTask({ id: "one", workspace: "editor", snapshot: {} }, async task => {
        escaped = task.gateway("primary");
        // Intentionally discard the promise: the application must still hold its slot.
        void escaped.execute({ model: "test" }, async response => { started(); await hold; return response.json(); });
        concurrent = await escaped.execute({ model: "test" }, response => response.json()).catch(e => e.message);
      });
      await ready;
      const busy = await app.runTask({ id: "two", workspace: "chat", snapshot: {} }, async () => "unexpected");
      finish(); await running;
      const expired = await escaped.execute({ model: "test" }, response => response.json()).catch(e => e.message);
      const after = await app.runTask({ id: "three", workspace: "image", snapshot: {} }, async () => "released");
      await app.dispose();
      return { concurrent, busy: busy.status, expired, after: after.value };
    });
    assert.match(result.concurrent, /等待本张/); assert.equal(result.busy, "busy");
    assert.match(result.expired, /任务已结束/); assert.equal(result.after, "released");
  } finally { await context.close(); }
});
