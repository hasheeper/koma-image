import test from "node:test";
import assert from "node:assert/strict";
import { createCallLog, inspectCall } from "../src/ask/debug.ts";
import { wireBody } from "../src/ask/provider.ts";
import { openaiChatProfile, anthropicMessagesProfile } from "../src/gateway/profile.ts";

const info = { conversation: "conversation-1", turn: 1, step: 1, question: "检查合成图", connection: "test", protocol: "openai-chat", model: "m", promptVersion: "test" };
const request = { model: "m", tools: [{ name: "get_state", description: "状态", schema: {} }], system: ["系统\n提示词", "个人偏好"], maxTokens: 128,
  messages: [{ role: "user", content: [{ type: "text", text: "<workspace_state>{}</workspace_state>\n检查合成图" }] }] };

test("debug log retains exact dispatch JSON, bounded memory and per-call outcomes; export and clear do not affect requests", () => {
  let view;
  const log = createCallLog(v => { view = v; }, { calls: 2, bytes: 2000 });
  const body = JSON.stringify({ text: "中文\n原始字符串", image: "AAAA" });
  const first = log.start(info, body);
  assert.equal(log.get(first).body, body);
  assert.equal(view.calls[0].bytes, new TextEncoder().encode(body).length);
  assert.equal("body" in view.calls[0], false);
  const outcome = { usage: { input: 200, output: 20, cacheRead: 120, cacheWrite: 0 }, cache: { read: 120, write: null }, stop: "end" };
  log.finish(first, outcome);
  log.fail(first, false);
  assert.equal(log.get(first).status, "failed");
  assert.deepEqual(log.get(first).cache, outcome.cache);
  const second = log.start({ ...info, step: 2 }, body);
  assert.equal(log.previous(second).id, first);
  const third = log.start({ ...info, turn: 2 }, body);
  assert.equal(log.get(first), undefined);
  assert.equal(view.dropped, 1);
  log.fail(third, true);
  assert.equal(log.get(third).status, "stopped");
  assert.equal(JSON.parse(log.export(second)).calls[0].body, body);
  assert.equal(JSON.parse(log.export()).calls.length, 2);
  const oversized = log.start({ ...info, model: "other" }, JSON.stringify({ text: "x".repeat(1200) }));
  assert.equal(view.calls.length, 1);
  assert.equal(log.get(oversized).body.length > 1200, true);
  assert.equal(log.previous(oversized), undefined);
  log.clear();
  assert.deepEqual(view, { calls: [], dropped: 0 });
});

test("inspector shows exact protocol context, folds only image pixels and locates actual cache markers", () => {
  for (const profile of [openaiChatProfile, anthropicMessagesProfile]) {
    const log = createCallLog(() => {});
    const first = log.start({ ...info, protocol: profile.protocol }, JSON.stringify(wireBody(profile, request)));
    const next = { ...request, messages: [...request.messages,
      { role: "assistant", content: [{ type: "text", text: "先查看图像" }, { type: "call", id: "v1", name: "view_image", input: { id: "#h1" } }] },
      { role: "user", content: [{ type: "result", id: "v1", content: [{ type: "text", text: "图像结果" }, { type: "image", mime: "image/png", data: "AAAA" }] }] }] };
    const raw = JSON.stringify(wireBody(profile, next));
    const second = log.start({ ...info, step: 2, protocol: profile.protocol }, raw);
    const preview = inspectCall(log.get(second), log.get(first));
    assert.equal(preview.images.length, 1);
    assert.equal(preview.images[0].url, "data:image/png;base64,AAAA");
    assert.equal(preview.images[0].bytes, 3);
    assert.equal(preview.images[0].source, "tool");
    const shot = preview.parts.find(p => p.path === preview.images[0].part);
    assert.equal(shot.images, 1);
    assert.equal(shot.role, "tool");
    assert.ok(shot.text.includes("Base64 已在预览中折叠"));
    assert.equal(preview.parts.some(p => p.text.includes("AAAA")), false);
    assert.ok(shot.bytes > new TextEncoder().encode("AAAA").length);
    assert.ok(preview.parts.some(p => p.comparison === "new"));
    const toolCall = preview.parts.find(p => p.path === (profile === openaiChatProfile ? "messages[2]" : "messages[1]"));
    assert.ok(toolCall.text.includes("view_image"));
    assert.ok(toolCall.text.includes("v1"));
    assert.deepEqual([toolCall.role, toolCall.tool, toolCall.gist], ["model", "view_image", "id: #h1"]);
    if (profile === openaiChatProfile) {
      const result = preview.parts.find(p => p.path === "messages[3]");
      assert.ok(result.text.includes("tool_call_id"));
      assert.deepEqual([result.role, result.tool, result.gist], ["tool", "view_image", "图像结果"]);
      assert.equal(shot.name, "结果图片");
    } else assert.equal(shot.tool, "view_image");
    assert.deepEqual([...new Set(preview.parts.map(p => p.section))], ["tools", "system", "current"]);
    assert.equal(preview.parts.find(p => p.section === "current").gist, "检查合成图");
    assert.equal(preview.turns, 0);
    assert.ok(preview.prefix >= 3);
    assert.equal(preview.breakpoints.length, profile === anthropicMessagesProfile ? 3 : 0);
    if (profile === anthropicMessagesProfile) assert.ok(preview.breakpoints.includes("messages[2].content[0].cache_control"));
    assert.deepEqual(preview.parts.flatMap(p => p.breakpoints), preview.breakpoints);
    assert.equal(log.get(second).body, raw);
    assert.equal(JSON.parse(log.export(second)).calls[0].body, raw);
  }
});

test("inspector identifies changed system content and isolates comparisons by connection and model", () => {
  const log = createCallLog(() => {});
  const first = log.start(info, JSON.stringify(wireBody(openaiChatProfile, request)));
  const second = log.start(info, JSON.stringify(wireBody(openaiChatProfile, { ...request, system: ["changed", ""] })));
  const preview = inspectCall(log.get(second), log.previous(second));
  assert.equal(preview.prefix, 1);
  assert.equal(preview.parts[1].comparison, "changed");
  assert.equal(preview.parts.at(-1).comparison, "same");
  const other = log.start({ ...info, connection: "another" }, log.get(first).body);
  assert.equal(log.previous(other), undefined);
});

test("inspector splits history from the current turn and names memory, compaction and naming requests", () => {
  const memory = { role: "user", kind: "session_memory", content: [{ type: "text", text: "<session_memory>\n账本\n</session_memory>" }] };
  const history = [memory, { role: "assistant", content: [{ type: "text", text: "已接续。" }] },
    { role: "user", content: [{ type: "text", text: "<workspace_state>{}</workspace_state>" }, { type: "text", text: "<data>\n附件\n</data>" }, { type: "text", text: "第一问" }] },
    { role: "assistant", content: [{ type: "call", id: "g1", name: "get_meta", input: { id: "#h1" } }] },
    { role: "user", content: [{ type: "result", id: "g1", content: [{ type: "text", text: "<data>\n{\"id\":\"#h1\",\"steps\":28}\n</data>" }] }] },
    { role: "assistant", content: [{ type: "text", text: "第一答" }] }];
  for (const profile of [openaiChatProfile, anthropicMessagesProfile]) {
    const log = createCallLog(() => {});
    const asked = log.start({ ...info, turn: 2, protocol: profile.protocol }, JSON.stringify(wireBody(profile, { ...request, messages: [...history, ...request.messages] })));
    const turn = inspectCall(log.get(asked));
    assert.equal(turn.turns, 1);
    assert.deepEqual(turn.parts.filter(p => p.section === "history").map(p => [p.name, p.role]), [["会话记忆", "user"], ["回复", "model"], ["提问", "user"], ["调用", "model"], ["结果", "tool"], ["回复", "model"]]);
    assert.equal(turn.parts.find(p => p.name === "结果").gist, "id: #h1 · steps: 28");
    assert.equal(turn.parts.find(p => p.section === "history" && p.name === "提问").gist, "第一问");
    assert.equal(turn.parts.filter(p => p.section === "current").length, 1);
    const compaction = log.start({ ...info, turn: 0, question: "压缩上下文", purpose: "compaction", protocol: profile.protocol },
      JSON.stringify(wireBody(profile, { ...request, messages: [...history, { role: "user", content: [{ type: "text", text: "整理备忘录" }] }] })));
    const compact = inspectCall(log.get(compaction));
    assert.deepEqual(compact.parts.filter(p => p.section === "current").map(p => [p.name, p.gist]), [["压缩指令", "整理备忘录"]]);
    const naming = log.start({ ...info, turn: 0, question: "AI 命名 · ASK", promptVersion: "naming-1", protocol: profile.protocol },
      JSON.stringify(wireBody(profile, { model: "m", tools: [], system: ["命名", ""], maxTokens: 256, messages: [{ role: "user", content: [{ type: "text", text: "{\"kind\":\"conversation\"}" }] }] })));
    const named = inspectCall(log.get(naming));
    assert.deepEqual(named.parts.map(p => p.section), ["system", "current"]);
  }
});
