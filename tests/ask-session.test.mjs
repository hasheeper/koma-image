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
