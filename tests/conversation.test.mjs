import { test } from "node:test";
import assert from "node:assert/strict";
import * as c from "../src/domain/conversation.js";
import {
  buildChatPayload,
  buildEditorPayload,
  validateEditorSource,
  editorModels,
} from "../src/domain/media.js";
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
