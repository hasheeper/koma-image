import test from "node:test";
import assert from "node:assert/strict";
import { systemCore, systemPreferences } from "../src/ask/prompts/index.ts";
import { constitution } from "../src/ask/prompts/constitution.ts";
import { models } from "../src/ask/prompts/models.ts";
import { createTools } from "../src/ask/tools.ts";
import { wireBody } from "../src/ask/provider.ts";
import { openaiChatProfile, anthropicMessagesProfile } from "../src/gateway/profile.ts";

const request = (adult, workspace = "image", model = "NAI Diffusion V5 Full") => ({
  model: "synthetic-reasoning", maxTokens: 1024,
  tools: [...createTools().values()].map(entry => entry.tool),
  system: [systemCore({ adult }), systemPreferences("先说结论")],
  messages: [{role: "user", content: [{type: "text", text: `<workspace_state>${JSON.stringify({workspace, model})}</workspace_state>请分析构图` }]}],
});

test("ASK prompts: adult context is opt-in, follows the invariant core, and survives both protocol conversions", () => {
  const neutral = systemCore({adult: false}), adult = systemCore({adult: true});
  assert.equal(adult, `${neutral}\n\n${constitution.adult}`);
  assert.equal(neutral.includes(constitution.adult), false);
  for (const profile of [openaiChatProfile, anthropicMessagesProfile]) {
    const extract = body => profile === openaiChatProfile ? body.messages[0].content : body.system.map(block => block.text).join("\n\n");
    const off = extract(wireBody(profile, request(false))), on = extract(wireBody(profile, request(true)));
    assert.equal(off.includes(constitution.adult), false);
    assert.equal(on.includes(constitution.adult), true);
    assert.equal(on.split(constitution.adult).length, 2);
    assert.equal(extract(wireBody(profile, request(false, "chat", "Nano Banana Pro"))), off);
    assert.equal(extract(wireBody(profile, request(false, "tags", "GPT Image 2"))), off);
    assert.equal(extract(wireBody(profile, request(false))), off, "switching adult mode off restores neutral system bytes");
  }
});

test("ASK model manuals: bodies stay out of static requests and are read only by exact local IDs", () => {
  const entry = createTools().get("get_model_manual");
  const before = JSON.stringify(request(false));
  for (const [id, manual] of Object.entries(models.manuals)) {
    assert.equal(before.includes(manual.body), false);
    const first = entry.run({id}, {}), second = entry.run({id}, {});
    assert.deepEqual(first, second, "reading manuals is deterministic and needs no workspace, network or write port");
    const value = JSON.parse(first.content[0].text.slice(7, -8));
    assert.equal(value.id, id); assert.equal(value.title, manual.title); assert.equal(value.version, models.version);
    assert.equal(value.body, manual.body.replaceAll("<", "‹"));
    assert.equal(entry.object({id}), manual.title);
  }
  for (const id of ["__proto__", "constructor", "../constitution.ts", "https://example.test/manual", "missing", ""]) {
    assert.throws(() => entry.run({id}, {}));
    assert.equal(entry.object({id}), "模型手册");
  }
  assert.throws(() => entry.run({}, {}));
  assert.equal(entry.final, undefined);
  assert.equal(JSON.stringify(request(false)), before);
});
