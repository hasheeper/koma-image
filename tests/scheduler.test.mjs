import test from "node:test";
import assert from "node:assert/strict";
import { createScheduler } from "../src/services/scheduler.ts";
import { createDataLease } from "../src/services/data-lease.ts";
import { holdLock } from "../src/services/locks.ts";
import { names } from "../src/storage/names.ts";

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const task = (id = "task", workspace = "image") => ({ id, workspace, sessionId: "conversation", snapshot: { seed: 0, prompt: "snapshot" } });
const locks = navigator.locks;

test("N=1 excludes all workspaces and other application instances for the entire batch, without queueing", async () => {
  const a = createScheduler(locks), b = createScheduler(locks);
  const entered = deferred(), finish = deferred(); let invoked = 0;
  const spec = task(), running = a.run(spec, async context => {
    assert.equal(context.slot, 1); assert.equal(context.task.snapshot.seed, 0);
    assert.throws(() => { context.task.snapshot.seed = 100; });
    entered.resolve(); await finish.promise; return ["first image", "second image"];
  });
  spec.snapshot.seed = 20;
  await entered.promise;
  assert.deepEqual(await a.run(task("chat", "chat"), async () => invoked++), { status: "busy" });
  assert.deepEqual(await b.run(task("editor", "editor"), async () => invoked++), { status: "busy" });
  assert.equal(invoked, 0);
  finish.resolve(); assert.deepEqual((await running).value, ["first image", "second image"]);
  assert.equal(invoked, 0, "no hidden deferred work");
  assert.equal((await b.run(task("next", "chat"), async () => 3)).value, 3);
  assert.equal(a.activeCount, 0); assert.equal(b.activeCount, 0);
});

test("slot acquisition failure, exception, cancellation and unsupported locks fail closed and release handles", async () => {
  const scheduler = createScheduler(locks);
  const release = await holdLock(locks, names.taskSlot(1), "exclusive");
  assert.deepEqual(await scheduler.run(task(), async () => assert.fail()), { status: "busy" });
  await release();
  await assert.rejects(scheduler.run(task(), async () => { throw new Error("failure"); }), /failure/);
  const entered = deferred();
  const running = scheduler.run(task(), async ({ signal }) => { entered.resolve(); await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); });
  await entered.promise; scheduler.cancel("task");
  await assert.rejects(running, { name: "AbortError" });
  assert.equal(scheduler.activeCount, 0);
  assert.equal((await scheduler.run(task(), async () => "released")).value, "released");
  await assert.rejects(createScheduler().run(task(), async () => assert.fail()), /安全/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(scheduler.run(task(), async () => assert.fail(), aborted.signal), { name: "AbortError" });
  assert.equal(scheduler.activeCount, 0);
});

test("single-page import drains writes, releases its own shared lease, reloads caches, then reopens admission", async () => {
  const scheduler = createScheduler(locks), data = createDataLease(locks, scheduler);
  await data.start();
  const order = [], pending = deferred(), entered = deferred();
  const writing = data.write(async () => { entered.resolve(); await pending.promise; order.push("write"); });
  await entered.promise;
  data.register({ async flush(write) { await write(() => { order.push("flush"); }); }, async reload() {
    assert.equal(data.phase, "maintenance"); assert.equal(scheduler.accepting, false);
    await assert.rejects(data.write(() => {}), /维护/); order.push("reload");
  } });
  const importing = data.import(async () => {
    order.push("import"); assert.equal(data.phase, "maintenance");
    assert.equal((await scheduler.run(task(), async () => assert.fail())).status, "maintenance");
    const held = (await locks.query()).held;
    assert.ok(held.some(l => l.name === names.dataLock && l.mode === "exclusive"));
    assert.ok(held.some(l => l.name === names.taskGate && l.mode === "exclusive"));
    return 4;
  });
  await assert.rejects(data.write(() => assert.fail()), /维护/);
  pending.resolve(); await writing;
  assert.equal(await importing, 4);
  assert.ok(order.indexOf("write") < order.indexOf("import"));
  assert.deepEqual(order.slice(-2), ["import", "reload"]);
  assert.equal(data.phase, "ready"); assert.equal(scheduler.accepting, true);
  await data.dispose();
});

test("other tabs block import; partial failure refreshes caches and restores the shared lease", async () => {
  const a = createDataLease(locks, createScheduler(locks)), b = createDataLease(locks, createScheduler(locks));
  await a.start(); await b.start();
  let refreshes = 0;
  a.register({ async flush() {}, async reload() { refreshes++; } });
  await assert.rejects(a.import(async () => assert.fail()), /其他标签/);
  assert.equal(a.phase, "ready"); assert.equal(refreshes, 1);
  await b.dispose();
  await assert.rejects(a.import(async () => { throw new Error("partial failure"); }), /partial failure/);
  assert.equal(a.phase, "ready"); assert.equal(refreshes, 2);
  const held = (await locks.query()).held.filter(l => l.name === names.dataLock);
  assert.equal(held.length, 1); assert.equal(held[0].mode, "shared");
  await a.dispose();
});

test("flush failure keeps the original lease; reload failure keeps writes and tasks disabled", async () => {
  const scheduler = createScheduler(locks), data = createDataLease(locks, scheduler);
  await data.start();
  const remove = data.register({ async flush() { throw new Error("disk full"); }, async reload() { assert.fail(); } });
  await assert.rejects(data.import(async () => assert.fail()), /disk full/);
  assert.equal(data.phase, "ready"); assert.equal(scheduler.accepting, true);
  remove();
  data.register({ async flush() {}, async reload() { throw new Error("reload failure"); } });
  await assert.rejects(data.import(async () => {}), /reload failure/);
  assert.equal(data.phase, "error"); assert.equal(scheduler.accepting, false);
  await assert.rejects(data.write(async () => assert.fail()));
  await data.dispose();
});

test("import refuses a running task without cancelling it, including local admission races", async () => {
  const scheduler = createScheduler(locks), data = createDataLease(locks, scheduler);
  await data.start();
  const entered = deferred(), finish = deferred(); let signal;
  const work = scheduler.run(task(), async context => { signal = context.signal; entered.resolve(); await finish.promise; });
  await assert.rejects(data.import(async () => assert.fail()), /生成/);
  await entered.promise; assert.equal(signal.aborted, false);
  finish.resolve(); await work; await data.dispose();
});

test("disposing a startup waiting behind an import cancels the pending shared lease", async () => {
  const release = await holdLock(locks, names.dataLock, "exclusive");
  const data = createDataLease(locks, createScheduler(locks));
  const startup = data.start();
  const rejected = assert.rejects(startup, { name: "AbortError" });
  await data.dispose(); await rejected; await release();
  assert.equal(data.phase, "disposed");
  assert.equal((await locks.query()).pending.filter(l => l.name === names.dataLock).length, 0);
});

test("a foreign generation gate blocks import and the shared lease is restored", async () => {
  const data = createDataLease(locks, createScheduler(locks));
  await data.start();
  const release = await holdLock(locks, names.taskGate, "exclusive");
  await assert.rejects(data.import(async () => assert.fail()), /生成/);
  assert.equal(data.phase, "ready");
  await release(); await data.dispose();
});
