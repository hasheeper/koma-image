import test from "node:test";
import assert from "node:assert/strict";
import { createConversations, CONVERSATION_LIMIT, titleOf, UNTITLED } from "../src/ask/conversations.ts";

const setup = (limit) => {
  const list = createConversations({ make: (id) => ({ id, title: UNTITLED, origin: null, turns: 0 }), empty: (c) => !c.turns, limit });
  const ask = () => { list.current.turns++; return list.current; };
  return { list, ask };
};

test("conversations: one empty conversation at a time, newest first", () => {
  const { list, ask } = setup();
  const first = list.current;
  assert.equal(list.fresh(), first, "an empty current conversation is reused");
  assert.equal(list.size, 1);
  ask();
  const second = list.fresh();
  assert.notEqual(second, first);
  list.select(first.id);
  assert.equal(list.fresh(), second, "the existing empty conversation is reused, not a second one");
  ask();
  const third = list.fresh();
  assert.deepEqual(list.list().map((c) => c.id), [third.id, second.id, first.id]);
  assert.equal(list.select("missing"), null);
  assert.equal(list.current, third);
});

test("conversations: the limit blocks new and forked conversations, not reuse", () => {
  const { list, ask } = setup(3);
  ask(); list.fresh(); ask(); list.fresh();
  assert.equal(list.size, 3);
  assert.equal(list.fresh(), list.current, "the third one is still empty and reused");
  ask();
  assert.equal(list.fresh(), "limit");
  assert.equal(list.fork((id) => ({ id, title: "x", origin: { conversationId: list.current.id, turnId: 1 }, turns: 1 })), "limit");
  assert.equal(CONVERSATION_LIMIT, 20);
});

test("conversations: deleting moves to the newest left, or to a new empty one", () => {
  const { list, ask } = setup();
  const a = ask(); list.fresh(); const b = ask();
  const fork = list.fork((id) => ({ id, title: b.title, origin: { conversationId: b.id, turnId: 7 }, turns: 1 }));
  assert.equal(list.current, fork);
  assert.deepEqual(fork.origin, { conversationId: b.id, turnId: 7 });
  list.select(a.id);
  assert.equal(list.remove(b.id), b);
  assert.equal(list.current, a, "removing another conversation keeps the current one");
  assert.equal(list.remove(a.id), a);
  assert.equal(list.current, fork, "the newest remaining becomes current");
  list.remove(fork.id);
  assert.equal(list.size, 1);
  assert.equal(list.current.turns, 0, "the last deletion leaves one new empty conversation");
  assert.ok(![a.id, b.id, fork.id].includes(list.current.id), "ids are never reused");
  assert.equal(list.remove("missing"), null);
});

test("conversations: titles take the first non-empty line, collapsed and capped", () => {
  assert.equal(titleOf("\n  这张的光影\t偏暖，\n换一个冷一点的"), "这张的光影 偏暖，");
  assert.equal(titleOf("x".repeat(80)).length, 60);
  assert.equal(titleOf("  ", "notes.md"), "notes.md");
  assert.equal(titleOf(""), UNTITLED);
});
