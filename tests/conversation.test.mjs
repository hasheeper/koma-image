import { test } from "node:test";
import assert from "node:assert/strict";
import * as c from "../src/domain/conversation.ts";
import {
  buildChatPayload,
  buildEditorPayload,
  buildNAIEditPayload,
  buildUpscalePayload,
  validateEditorSource,
  editorModels,
} from "../src/domain/media.ts";
const model = {
  id: "gemini-3-pro-image",
  provider: "gemini",
  family: "gemini",
  operations: ["generate", "edit"],
  tools: ["image-edit"],
  maxImages: 2,
  fields: { image_size: { options: ["1K", "2K"], default: "1K" } },
  maxPixels: 1048576,
  sourceMaxPixels: 32000000,
};
function done(con, prompt, id) {
  con.prompt = prompt;
  const { turn, version } = c.beginTurn(
    con,
    c.contextSnapshot(con),
    prompt,
    con.settings,
  );
  c.completeVersion(
    con,
    turn,
    version,
    [{ type: "image", assetId: id }],
    { cost: 0 },
    con.selectionRevision,
  );
  return turn;
}
test("chat: context cap, upload consumption on failure, held base, branches and selection revision preserve exact source semantics", () => {
  const con = c.newConversation({ model: model.id });
  c.attachUpload(con, "upload-a");
  c.attachUpload(con, "upload-b");
  con.prompt = "first";
  const snapshot = c.contextSnapshot(con, con.prompt, 1);
  assert.deepEqual(snapshot.imageIds, ["upload-a"]);
  assert.deepEqual(snapshot.dropped, ["upload-b"]);
  const { version } = c.beginTurn(con, snapshot, con.prompt, con.settings);
  version.status = "error";
  assert.deepEqual(con.attachments, ["upload-b"]);
  assert.deepEqual(con.keepIds, ["upload-a", "upload-b"]);
  const t = done(con, "second", "result");
  assert.equal(con.mainId, "result");
  con.baseFollows = false;
  done(con, "third", "result2");
  assert.equal(con.mainId, "result");
  c.selectSource(con, t, "result");
  assert.deepEqual(
    c.branchTurns(con).map((t) => t.prompt),
    ["second"],
  );
  con.skipTurnIds = [t.id];
  assert.equal(c.contextSnapshot(con, "next").text, "next");
  con.skipTurnIds = [];
  assert.equal(
    c.contextSnapshot(con, "next").text,
    "此前的绘图要求（按顺序）：\n1. second\n\n本轮要求（以本轮修改为准）：\nnext",
  );
  const next = c.beginTurn(con, c.contextSnapshot(con), "next", con.settings),
    revision = con.selectionRevision;
  con.selectionRevision++;
  c.completeVersion(
    con,
    next.turn,
    next.version,
    [{ type: "image", assetId: "late" }],
    { cost: 0 },
    revision,
  );
  assert.equal(con.headId, t.id);
  c.forgetImage(con, "result");
  assert.equal(con.baseFollows, true);
  assert.equal(con.mainId, null);
});
test("chat: duplicate remaps ancestry/version IDs, preserves shared assets, drops draft; interrupted restore stays cancelled", () => {
  const con = c.newConversation();
  const first = done(con, "a", "img");
  const second = done(con, "b", "img2");
  con.prompt = "unsent";
  c.attachUpload(con, "draft-image");
  con.pinned = true;
  c.renameConversation(con, "  Name   here  ");
  const copy = c.duplicateConversation(con);
  assert.equal(copy.prompt, "");
  assert.deepEqual(copy.attachments, []);
  assert.notEqual(copy.turns[0].id, first.id);
  assert.equal(copy.turns[1].parentId, copy.turns[0].id);
  assert.notEqual(copy.headId, second.id);
  assert.equal(copy.pinned, false);
  assert.deepEqual(copy.turns[0].versions[0].blocks, [
    { type: "image", assetId: "img" },
  ]);
  c.beginVersion(second);
  const revived = c.reviveConversation(
    structuredClone(con),
    (id) => id !== "draft-image",
  );
  assert.equal(revived.turns[1].versions[1].status, "cancelled");
  assert.equal(revived.attachments.length, 0);
});

test("chat: stable pin order, missing branch references and result completion keep original state rules", () => {
  const con = c.newConversation(), peer = c.newConversation();
  con.updatedAt = peer.updatedAt = 100;
  assert.deepEqual(c.sortConversations([con, peer]), [con, peer]);
  peer.pinned = true;
  const rows = [con, peer];
  assert.deepEqual(c.sortConversations(rows), [peer, con]);
  assert.deepEqual(rows, [con, peer]);

  const { turn, version } = c.beginTurn(con, c.contextSnapshot(con, "next"), "next", {});
  const before = structuredClone(con);
  assert.throws(() => c.completeVersion(con, turn, version, [{ type: "text", text: "no image" }], null, 0), /结果没有图片/);
  assert.deepEqual(con, before);
  const blocks = [{ type: "text", text: "result" }, { type: "image", assetId: "first" }, { type: "image", assetId: "second" }];
  assert.equal(c.completeVersion(con, turn, version, blocks, null, 0), true);
  assert.equal(con.mainId, "first");
  assert.equal(version.quote, null);
  assert.deepEqual(version.blocks, blocks);
  assert.equal(c.completeVersion(con, turn, version, [], { cost: 0 }, 0), false);
  assert.deepEqual([...c.assetRefs([con])], ["first", "second"]);

  turn.parentId = turn.snapshot.parentId = "missing";
  turn.snapshot.turnIds = [turn.id, "missing"];
  con.skipTurnIds = [turn.id, "missing"];
  const copy = c.duplicateConversation(con);
  assert.equal(copy.turns[0].parentId, null);
  assert.equal(copy.turns[0].snapshot.parentId, null);
  assert.deepEqual(copy.turns[0].snapshot.turnIds, [copy.turns[0].id, "missing"]);
  assert.deepEqual(copy.skipTurnIds, [copy.turns[0].id]);
  assert.deepEqual(c.ancestry(con).map((t) => t.id), [turn.id]);
  turn.parentId = turn.id;
  assert.throws(() => c.ancestry(con), /会话分支无效/);
});
test("chat: list sections follow local days, search covers every prompt, cover follows the branch on screen", () => {
  const now = new Date(2026, 9, 20, 9, 30).getTime(),
    period = (...d) => c.conversationPeriod(new Date(...d).getTime(), now);
  assert.equal(period(2026, 9, 20, 0, 0), "today");
  assert.equal(period(2026, 9, 19, 23, 59), "yesterday");
  assert.equal(period(2026, 9, 19, 0, 0), "yesterday");
  assert.equal(period(2026, 9, 14, 0, 0), "week");
  assert.equal(period(2026, 9, 13, 23, 59), "earlier");

  const con = c.newConversation();
  assert.equal(c.coverImage(con), null);
  c.attachUpload(con, "staged");
  assert.equal(c.coverImage(con), "staged");
  const first = done(con, "蓝色森林", "a");
  const second = done(con, "加一只 Cat", "b");
  assert.equal(c.matchesQuery(con, "  "), true);
  assert.equal(c.matchesQuery(con, "森林"), true);
  assert.equal(c.matchesQuery(con, "cat"), true);
  assert.equal(c.matchesQuery(con, "狗"), false);
  assert.equal(c.coverImage(con), "b");
  c.beginVersion(second);
  assert.equal(c.coverImage(con), "b");
  con.headId = first.id;
  assert.equal(c.coverImage(con), "a");
});
test("media: generation/edit fields, Gemini output_size and strict count/text limits", () => {
  assert.equal(buildChatPayload(model, "word", {}, []).tool, undefined);
  const p = buildChatPayload(model, "exact text", { image_size: "2K" }, [
    "a",
    "b",
  ]);
  assert.equal(p.tool, "image-edit");
  assert.equal(p.init_image, "a");
  assert.deepEqual(p.additional_images, ["b"]);
  assert.deepEqual(p.image_options, { output_size: "2k" });
  assert.equal(p.transform_prompt, false);
  assert.throws(
    () => buildChatPayload(model, "a", {}, ["a", "b", "c"]),
    /最多/,
  );
  assert.throws(() => buildChatPayload(model, "a".repeat(24001), {}), /上下文/);
});
function png(w, h) {
  const b = Buffer.alloc(32);
  b.set([137, 80, 78, 71, 13, 10, 26, 10]);
  b.write("IHDR", 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return "data:image/png;base64," + b.toString("base64");
}
test("editor: source/mask dimensions, seed zero, per-mode payload allowlist, dedicated upscale detail independence", () => {
  const nai = {
    ...model,
    id: "nai-diffusion-5-full",
    provider: "novelai",
    family: "novelai",
    tools: ["upscale", "img2img", "inpaint"],
  };
  const source = { png: png(256, 256), original: png(512, 512) };
  const p = buildEditorPayload("img2img", nai, source, {
    prompt: "  exact  ",
    seed: 0,
    strength: 0.35,
    noise: 0.1,
  });
  assert.equal(p.prompt, "  exact  ");
  assert.equal(p.seed, 0);
  assert.equal(p.strength, 0.35);
  assert.equal(p.noise, 0.1);
  assert.equal(p.init_image, source.png);
  assert.equal(p.cache, false);
  assert.equal(p.mask_image, undefined);
  assert.throws(
    () => buildEditorPayload("inpaint", nai, source, {}, null),
    /涂抹/,
  );
  assert.throws(
    () => buildEditorPayload("inpaint", nai, source, {}, png(128, 128)),
    /尺寸/,
  );
  assert.equal(
    buildEditorPayload("inpaint", nai, source, {}, source.png).strength,
    1,
  );
  const upscale = {
    ...model,
    id: "fal-upscale",
    name: "Upscale",
    provider: "fal",
    tools: ["image-edit"],
  };
  const up = buildEditorPayload("upscale", upscale, source, {
    prompt: "never send edit prompt",
    detail: "detail only",
  });
  assert.equal(up.prompt, "detail only");
  assert.equal(up.init_image, source.original);
  assert.equal(up.strength, undefined);
  assert.equal(up.tool, "image-edit");
  assert.match(
    validateEditorSource("upscale", nai, { width: 2048, height: 2048 }),
    /上限/,
  );
  assert.equal(editorModels({ models: [nai, upscale] }, "upscale").length, 2);
});

test("media: numeric validation order, defaults and mode-specific output fields survive type narrowing", () => {
  const nai = { ...model, id: "nai-diffusion-5-full", provider: "novelai", tools: ["img2img", "inpaint", "upscale"] };
  const image = png(256, 256);
  const p = buildNAIEditPayload(nai, "img2img", image, {
    prompt: "  ", seed: 0, steps: "25", scale: 0, strength: 0, noise: 0,
    max_cost: 100, cache: true, transform_prompt: true, unused: "drop",
  });
  assert.equal(p.prompt, "best quality");
  assert.equal(p.steps, 25);
  for (const key of ["seed", "scale", "strength", "noise"]) assert.equal(p[key], 0);
  assert.deepEqual(Object.keys(p), [
    "model", "tool", "init_image", "prompt", "negative_prompt", "cache", "transform_prompt", "transform_mode",
    "noise_schedule", "cfg_rescale", "steps", "scale", "seed", "strength", "noise", "sampler",
  ]);
  assert.equal(p.cache, false);
  assert.equal(p.transform_prompt, false);
  const defaults = buildNAIEditPayload(nai, "img2img", image, { seed: null, strength: undefined });
  assert.equal(defaults.seed, -1);
  assert.equal(defaults.strength, 0.5);
  const masked = buildNAIEditPayload(nai, "inpaint", image, {}, image);
  assert.equal(masked.strength, 1);
  assert.equal(masked.mask_image, image);
  assert.throws(() => buildNAIEditPayload(nai, "img2img", image, { steps: 0, seed: -2 }), /参数 steps 超出范围/);
  for (const [key, value] of [["steps", 1.5], ["scale", 21], ["seed", 4294967296], ["strength", -0.1], ["noise", Infinity]]) {
    assert.throws(() => buildNAIEditPayload(nai, "img2img", image, { [key]: value }), new RegExp(`参数 ${key} 超出范围`));
  }
  assert.throws(() => buildNAIEditPayload(nai, "img2img", image, {}, image), /图生图不接受蒙版/);
  assert.throws(() => buildEditorPayload("img2img", nai, { original: image }), /底图须为/);
  assert.throws(() => buildEditorPayload("upscale", nai, { png: image }), /仅接受/);

  const native = buildUpscalePayload(nai, image, { ignored: "option" }, "  keep  ");
  assert.equal(native.prompt, "  keep  ");
  assert.equal(native.tool, "upscale");
  assert.equal(Object.hasOwn(native, "image_options"), false);
  const dedicated = { ...model, id: "fal-upscale", provider: "fal", name: "Upscale", tools: ["image-edit"] };
  const up = buildUpscalePayload(dedicated, image);
  assert.equal(up.tool, "image-edit");
  assert.deepEqual(up.image_options, { image_size: "1K" });
  assert.equal(up.prompt, "Upscale the image while preserving the original composition, colors and details.");
  assert.throws(() => buildUpscalePayload(dedicated, image, { image_size: "4K" }), /参数 image_size 不受模型支持/);
});
