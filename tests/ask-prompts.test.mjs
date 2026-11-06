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

test("ASK current-image guidance names each workspace's actual image reference", () => {
  const core = systemCore({adult: false});
  assert.match(core, /EDIT 的当前画面.*edit\.viewing_version\.id/);
  assert.match(core, /IMAGE 用 image\.current\.id.*image\.history\.latest_id/);
  assert.match(core, /不向工具传 null、空串或字段路径文字/);
  assert.match(core, /\{id:"#e1\.1",spec:"look"\}.*无需先调 get_meta 或 get_state/);
  assert.match(core, /edit\.form.*不是查看版本生成时的历史配方/);
  assert.match(core, /image_input\.enabled=false.*不调用视觉工具/);
  assert.doesNotMatch(core, /可先用 `current\.id` 或 `latest_id`/);
  assert.match(core, /EDIT 中.*整个 image 只保留画板目录.*get_state\(\{ board_id \}\)/);
  assert.match(createTools().get('get_state').tool.description, /跨区读取须传 board_id/);
});

test('annotation prompting preserves the whole-image prerequisite and separates locator from clean image',()=>{
 const core=systemCore({adult:false});assert.match(core,/批注底图 ID/);assert.match(core,/成功后再用 `annotation` 裁切/);assert.match(core,/已有有效全图查看记录时无需重复/);assert.match(core,/仅看过定位图、拼图或读过批注坐标不满足/);
 assert.doesNotMatch(constitution.body,/edit\.viewing_version\.id/);
});
