import test from "node:test";
import assert from "node:assert/strict";
import { approxTokens, createSession, estimateRequest, LIMITS } from "../src/ask/session.ts";
import { run } from "../src/ask/runner.ts";
import { createTools } from "../src/ask/tools.ts";
import { ProviderError } from "../src/ask/messages.ts";
import { createPacer } from "../src/ask/pacer.ts";

const usage = { input: 100, output: 10, cacheRead: 80, cacheWrite: 0 };
const user = (text) => ({ role: "user", content: [{ type: "text", text: "<workspace_state>\n{}\n</workspace_state>" }, { type: "text", text }] });
const call = (id, name = "get_state", input = {}) => ({ type: "call", call: { type: "call", id, name, input } });
const done = (stop = "end") => ({ type: "done", stop, usage });
test('session favorite: roundtrip preserves committed tools, image provenance and usage, excluding an unfinished turn', () => {
  const s = createSession(), t = s.begin(user('收藏这一轮'));
  t.push({ role: 'assistant', content: [{ type: 'call', id: 'read', name: 'view_image', input: { id: '#a1' } }] });
  t.push({ role: 'user', content: [{ type: 'result', id: 'read', content: [{ type: 'image', mime: 'image/png', data: 'PIXELS', viewed: { ids: ['#a1'], spec: 'full', bytes: 8 } }] }] });
  t.record(usage); t.commit({ viewed: ['#a1'] });
  const pending = s.begin(user('尚未完成'));
  pending.push({ role: 'assistant', content: [{ type: 'text', text: '部分回复' }] });
  const snapshot = s.snapshot(), billed = [];
  const restored = createSession(u => billed.push(u), snapshot.turns, snapshot.usage);
  assert.deepEqual(restored.messages, s.messages);
  assert.deepEqual(restored.usage, usage);
  assert.deepEqual([...restored.viewed()], ['#a1']);
  assert.equal(restored.turns, 1);
  assert.equal(restored.busy, false);
  assert.deepEqual(billed, [], 'restoration does not bill the page again');
  assert.doesNotMatch(JSON.stringify(snapshot), /尚未完成|部分回复/);
  pending.rollback();
});
/** A scripted model: one array of events per request; records every request. */
function script(...steps) {
  const requests = [];
  return {
    requests,
    async *stream(request, signal) {
      requests.push(structuredClone(request));
      const events = steps[requests.length - 1] ?? [{ type: "text", text: "完" }, done()];
      for (const event of events) {
        signal.throwIfAborted();
        if (event === "fail") throw new ProviderError("rejected", "blocked by filter", 400);
        if (event === "hold") await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
        else yield event;
      }
    },
  };
}
function setup(model, extra = {}) {
  const session = createSession(),
    controller = new AbortController(),
    states = [];
  const turn = session.begin(user("为什么是红眼睛？"));
  const options = {
    stream: model.stream,
    request: { model: "m", tools: [...createTools().values()].map((e) => e.tool), system: ["core", ""], maxTokens: 1024 },
    turn,
    tools: extra.tools ?? createTools(),
    context: {
      signal: controller.signal,
      metadataOnly: false,
      state: () => {
        states.push(1);
        return { text: `<workspace_state>\n{"n":${states.length}}\n</workspace_state>`, images: 3 };
      },
    },
    signal: controller.signal,
  };
  return { session, turn, controller, options, states };
}
async function drain(generator) {
  const events = [];
  for await (const event of generator) events.push(event);
  return events;
}

test("session: a turn joins the history only when committed; failures leave nothing", async () => {
  const session = createSession();
  const failed = session.begin(user("a"));
  assert.throws(() => session.begin(user("b")), /上一轮尚未结束/);
  failed.push({ role: "assistant", content: [{ type: "text", text: "half" }] });
  failed.rollback();
  assert.deepEqual(session.messages, []);
  assert.throws(() => failed.push(user("late")), /该轮已结束/);
  assert.throws(() => failed.commit(), /该轮已结束/);
  const ok = session.begin(user("b"));
  ok.push({ role: "assistant", content: [{ type: "text", text: "answer" }] });
  ok.commit();
  assert.equal(session.messages.length, 2);
  assert.equal(session.turns, 1);

  // A refused turn through the runner: no partial text or calls survive.
  const { session: s, turn, options } = setup(script([{ type: "text", text: "partial" }, call("c1")], ["fail"]));
  await assert.rejects(drain(run(options)), (error) => error instanceof ProviderError && error.kind === "rejected");
  assert.equal(turn.messages().length, 3);
  turn.rollback();
  assert.deepEqual(s.messages, []);
  assert.equal(s.busy, false);
});

test("runner: text turns, tool rounds appended at the tail, and the snapshot locked for the turn", async () => {
  const model = script([{ type: "text", text: "先读状态。" }, call("c1"), done("tool")], [{ type: "text", text: "**结论**：权重冲突。" }, done()]);
  const { session, turn, options, states } = setup(model);
  const events = await drain(run(options));
  assert.deepEqual(events.map((e) => e.type), ["text", "usage", "tool-start", "tool-end", "text", "usage", "done"]);
  assert.deepEqual(events[2], { type: "tool-start", id: "c1", name: "get_state", verb: "读取", object: "工作台" });
  assert.deepEqual(events[3], { type: "tool-end", id: "c1", ok: true, stat: "3 张历史" });
  assert.equal(events.at(-1).reason, "end");
  assert.equal(states.length, 1);
  const [first, second] = model.requests;
  // The second request extends the first byte for byte; the original state block is untouched.
  assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages);
  assert.deepEqual(second.messages.slice(1).map((m) => m.role), ["assistant", "user"]);
  assert.equal(second.messages[2].content[0].content[0].text, '<workspace_state>\n{"n":1}\n</workspace_state>');
  assert.equal(first.messages[0].content[0].text, "<workspace_state>\n{}\n</workspace_state>");
  assert.deepEqual(first.tools, second.tools);
  assert.deepEqual(first.system, second.system);
  turn.commit();
  assert.equal(session.messages.length, 4);
  assert.deepEqual(session.usage, { input: 200, output: 20, cacheRead: 160, cacheWrite: 0 });
  assert.equal(turn.budget.toolCalls, 1);
  assert.equal(turn.budget.requests, 2);
});

test("runner: six tool calls at most, unknown tools answered, a model that never stops fails the turn", async () => {
  const greedy = Array.from({ length: 12 }, (_, i) => [call(`c${i}`), done("tool")]);
  const { turn, options, states } = setup(script(...greedy));
  await assert.rejects(drain(run(options)), (error) => error instanceof ProviderError && error.kind === "protocol");
  assert.equal(states.length, LIMITS.toolCalls);
  assert.equal(turn.budget.requests, LIMITS.requests + 1);
  const results = turn.messages().filter((m) => m.role === "user").slice(1).map((m) => m.content[0]);
  assert.equal(results.filter((r) => !r.error).length, 6);
  assert.match(results[6].content[0].text, /已达上限/);
  turn.rollback();

  const polite = script([call("x", "no_such_tool"), done("tool")], [call("y"), done("tool")], [{ type: "text", text: "好" }, done()]);
  const second = setup(polite);
  const events = await drain(run(second.options));
  assert.deepEqual(events.filter((e) => e.type === "tool-end").map((e) => e.ok), [false, true]);
  assert.match(polite.requests[1].messages.at(-1).content[0].content[0].text, /没有名为 no_such_tool 的工具/);
});

test("runner: a final tool ends the turn after its result; aborting stops mid-stream", async () => {
  const draft = new Map(createTools());
  draft.set("propose_draft", { tool: { name: "propose_draft", description: "", schema: {} }, verb: "准备草稿", object: () => "修改提示词", final: true, run: () => ({ content: [{ type: "text", text: "ok" }], stat: "+1 -1" }) });
  const model = script([{ type: "text", text: "改这里。" }, call("d1", "propose_draft", { x: 1 }), done("tool")]);
  const { options } = setup(model, { tools: draft });
  const events = await drain(run(options));
  assert.equal(model.requests.length, 1);
  assert.deepEqual(events.at(-1), { type: "done", reason: "final" });

  const held = setup(script([{ type: "text", text: "partial" }, "hold"]));
  const pending = drain(run(held.options));
  setTimeout(() => held.controller.abort(new DOMException("已停止", "AbortError")), 10);
  await assert.rejects(pending, (error) => error.name === "AbortError");
  held.turn.rollback();
  assert.deepEqual(held.session.messages, []);
});

test("runner: thrown, reported and unknown tool failures retain their reasons for the UI and model", async () => {
  const tools = new Map(createTools());
  const entry = (name, run) => ({ tool: { name, description: "", schema: {} }, verb: "查看", object: () => "#h2", run });
  tools.set("throwing", entry("throwing", () => { throw new Error("裁切 #h2 前请先查看全图"); }));
  tools.set("reported", entry("reported", () => ({ error: true, content: [{ type: "text", text: "本轮视觉预算已达上限" }] })));
  const model = script([call("a", "throwing"), call("b", "reported"), call("c", "missing"), call("d"), done("tool")], [{ type: "text", text: "依据已有信息回答。" }, done()]);
  const { options } = setup(model, { tools });
  const ends = (await drain(run(options))).filter(e => e.type === "tool-end");
  const reasons = ["裁切 #h2 前请先查看全图", "本轮视觉预算已达上限", "没有名为 missing 的工具。"];
  assert.deepEqual(ends.slice(0, 3).map(e => e.reason), reasons);
  assert.ok(ends.slice(0, 3).every(e => !e.ok));
  assert.equal(ends[3].ok, true);
  assert.equal(ends[3].reason, undefined);
  assert.deepEqual(model.requests[1].messages.at(-1).content.slice(0, 3).map(r => r.content[0].text), reasons);
});

test("runner: a silent final draft gets one prose-only completion, never a second tool execution", async () => {
  let writes = 0;
  const tools = new Map(createTools());
  tools.set("propose_draft", { ...tools.get("propose_draft"), run: () => {
    writes++;
    return { content: [{ type: "text", text: "草稿待确认" }], draft: { title: "新角色" } };
  } });
  const model = script([call("d1", "propose_draft"), done("tool")], [{ type: "text", text: "已按新角色改写，草稿请核对。" }, done()]);
  const { options, turn, session } = setup(model, { tools });
  const events = await drain(run(options));
  assert.equal(writes, 1);
  assert.equal(model.requests.length, 2);
  assert.equal(model.requests[0].toolChoice, undefined);
  assert.equal(model.requests[1].toolChoice, "none");
  assert.deepEqual(model.requests[1].tools, model.requests[0].tools, "past calls retain their tool definitions");
  assert.equal(model.requests[1].messages.at(-2).content[0].id, "d1");
  assert.match(model.requests[1].messages.at(-1).content[0].text, /尚未应用/);
  assert.equal(events.filter(e => e.draft).length, 1);
  assert.deepEqual(events.at(-1), { type: "done", reason: "final" });
  turn.commit();
  assert.deepEqual(session.usage, { input: 200, output: 20, cacheRead: 160, cacheWrite: 0 });
});

test("runner: completed blank post-tool endings request prose once; repeated silence cannot succeed", async () => {
  for (const empty of [[{ type: "text", text: " \n" }, done()], [done()]]) {
    const model = script([call("r1"), done("tool")], empty, [{ type: "text", text: "已读取表单，尚未看图。" }, done()]);
    const { options, turn } = setup(model);
    const events = await drain(run(options));
    assert.equal(model.requests.length, 3);
    assert.equal(model.requests[2].toolChoice, "none");
    assert.ok(turn.messages().every(m => m.content.length > 0));
    assert.ok(turn.messages().filter(m => m.role === "assistant").every(m => m.content.some(b => b.type !== "text" || b.text.trim())));
    assert.equal(events.at(-1).reason, "end");
  }
  const silent = setup(script([call("r1"), done("tool")], [done()], [done()]));
  await assert.rejects(drain(run(silent.options)), e => e.kind === "empty");
  assert.equal(silent.turn.budget.requests, 3);
  silent.turn.rollback();
  assert.deepEqual(silent.session.messages, []);
});

test("runner: prose completion failures and aborts keep transaction semantics; unexpected tools never run", async () => {
  const tools = new Map(createTools());
  tools.set("finish", { tool: { name: "finish", description: "", schema: {} }, verb: "整理", object: () => "草稿", final: true, run: () => ({ content: [] }) });
  const rejected = setup(script([call("f", "finish"), done("tool")], ["fail"]), { tools });
  await assert.rejects(drain(run(rejected.options)), e => e.kind === "rejected");
  assert.equal(rejected.turn.budget.requests, 2);
  rejected.turn.rollback();
  assert.deepEqual(rejected.session.messages, []);
  const extra = setup(script([call("f", "finish"), done("tool")], [call("again"), done("tool")]), { tools });
  await assert.rejects(drain(run(extra.options)), /补充说明时仍调用工具/);
  assert.deepEqual(extra.states, []);
  const held = setup(script([call("f", "finish"), done("tool")], ["hold"]), { tools });
  const pending = drain(run(held.options));
  setTimeout(() => held.controller.abort(new DOMException("已停止", "AbortError")), 10);
  await assert.rejects(pending, e => e.name === "AbortError");
  held.turn.rollback();
  assert.deepEqual(held.session.messages, []);
});

test("state tool: initial text is read by default; latest is explicit and invalid scopes never read", async () => {
  const entry = createTools().get("get_state"), scopes = [];
  const context = { state: scope => { scopes.push(scope); return { text: scope, images: 4 }; } };
  assert.equal((await entry.run({}, context)).content[0].text, "initial");
  assert.equal((await entry.run({ scope: "latest" }, context)).content[0].text, "latest");
  await assert.rejects(() => entry.run({ scope: "wrong" }, context), /scope/);
  assert.deepEqual(scopes, ["initial", "latest"]);
});

test("budget: local token estimate counts wide characters, tools, results and images", () => {
  assert.equal(approxTokens("abcd"), 1);
  assert.equal(approxTokens("红眼睛"), 3);
  const base = estimateRequest({ tools: [], system: ["", ""], messages: [user("x")] });
  const more = estimateRequest({
    tools: [{ name: "a", description: "b", schema: {} }],
    system: ["规则", ""],
    messages: [user("x"), { role: "assistant", content: [{ type: "call", id: "1", name: "a", input: { q: "w" } }] }, { role: "user", content: [{ type: "result", id: "1", content: [{ type: "image", mime: "image/webp", data: "" }] }] }],
  });
  assert.ok(more > base + 1000);
  assert.deepEqual(LIMITS.vision, { calls: 4, pixels: 1_500_000, bytes: 400_000 });
});

test("pacer: minimum gaps top up quick steps and never add to slow ones", async () => {
  let clock = 0;
  const waits = [],
    order = [];
  const pacer = createPacer(() => clock, async (ms) => {
    waits.push(ms);
    clock += ms;
  });
  pacer.push(() => order.push("start"));
  pacer.push(() => order.push("end"), 600);
  await pacer.settled();
  assert.deepEqual(waits, [600]);
  clock += 900;
  pacer.push(() => order.push("next"), 160);
  await pacer.settled();
  assert.deepEqual(waits, [600]);
  pacer.rush();
  pacer.push(() => order.push("rushed"), 600);
  await pacer.settled();
  assert.deepEqual(waits, [600]);
  assert.deepEqual(order, ["start", "end", "next", "rushed"]);
});

test("pacer: cancelling interrupts a pending dwell and discards queued output", async () => {
  const pacer = createPacer(), output = [];
  pacer.push(() => output.push("start"));
  pacer.push(() => output.push("late"), 600);
  await new Promise(resolve => setTimeout(resolve, 10));
  pacer.cancel();
  await pacer.settled();
  assert.deepEqual(output, ["start"]);
});

test("session: truncate and fork keep the committed prefix as last sent; viewed images follow the turns", () => {
  const page = { input: 0, output: 0 };
  const session = createSession((u) => { page.input += u.input; page.output += u.output; });
  const image = (id) => ({ type: "image", mime: "image/webp", data: `PIXELS-${id}`, viewed: { ids: [id], spec: "glance", bytes: 2048 } });
  let last;
  for (const [n, seen] of [[1, ["#h1"]], [2, ["#h1"]], [3, ["#h2"]], [4, ["#h3"]], [5, ["#h4"]]]) {
    const turn = session.begin(user(`q${n}`));
    last = turn.messages();
    turn.push({ role: "assistant", content: [{ type: "text", text: `a${n}` }] });
    turn.push({ role: "user", content: [{ type: "result", id: `r${n}`, content: seen.map(image) }] });
    turn.record(usage);
    turn.commit({ viewed: seen.filter((id) => !session.viewed().has(id)) });
  }
  assert.deepEqual([...session.viewed()], ["#h1", "#h2", "#h3", "#h4"]);
  const pixels = (messages) => JSON.stringify(messages).match(/PIXELS-#h\d/g) ?? [];
  assert.deepEqual(pixels(last), ["PIXELS-#h2", "PIXELS-#h3"], "the last request kept pixels for its two latest turns");

  const fork = session.fork(2);
  assert.equal(fork.turns, 2);
  assert.equal(fork.messages[0], session.messages[0], "message objects are shared, not copied");
  assert.deepEqual([...fork.viewed()], ["#h1"]);
  assert.deepEqual(fork.usage, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, "a fork's own usage starts at zero");
  const branched = fork.begin(user("q3'"));
  assert.deepEqual(branched.messages().slice(0, 6), last.slice(0, 6), "a fork's first request repeats the source's last-sent prefix");
  branched.record(usage);
  branched.rollback();
  assert.deepEqual(page, { input: 600, output: 60 }, "every conversation adds to the page total");
  assert.equal(session.turns, 5, "forking leaves the source alone");

  session.truncate(3);
  assert.equal(session.turns, 3);
  assert.deepEqual([...session.viewed()], ["#h1", "#h2"], "viewed is recomputed from the turns left");
  const edited = session.begin(user("q4'"));
  assert.deepEqual(edited.messages().slice(0, 9), last.slice(0, 9), "the truncated history is the prefix the last request sent");
  assert.throws(() => session.truncate(1), /运行中不能截断/);
  assert.throws(() => session.fork(1), /运行中不能分支/);
  edited.rollback();
});
