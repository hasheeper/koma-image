import { deflateSync } from "node:zlib";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS,
  sizes,
  presetMatch,
  closestShape,
  snap,
  sizeProblem,
  collect,
  batchParams,
  drawingPayload,
  imageFileName,
} from "../src/domain/drawing.ts";
import { MODELS } from "../src/domain/models.ts";
import { readImageParams } from "../src/native/image-meta.js";
import { convertToNaiPrompt } from "../src/native/prompt-converter.js";
import { decodeNativeImages } from "../src/native/native-images.js";
import { createArchive } from "../src/storage/backup-archive.ts";
const model = { ...MODELS[0], transparentBackground: true };
test("drawing: original per-tier geometry, custom closest match, snapping only on commit and area guard", () => {
  assert.deepEqual(sizes("m")["2:3"], [832, 1216]);
  assert.deepEqual(sizes("l")["1:1"], [1472, 1472]);
  assert.deepEqual(presetMatch(1792, 1024), { tier: "l", shape: "16:9" });
  assert.equal(presetMatch(800, 1200), null);
  assert.equal(closestShape(800, 1200, "m"), "2:3");
  assert.equal(snap(801), 832);
  assert.equal(snap(9), 64);
  assert.equal(snap(9999), 2048);
  assert.equal(snap(""), null);
  assert.equal(sizeProblem(832, 1216).fatal, false);
  assert.equal(sizeProblem(2048, 2048).fatal, true);
});
test("drawing: original defaults, blank prompt, explicit zero, uint32 wrap and strict wire field allowlist", () => {
  const base = collect({ ...DEFAULTS, seed: "0" }, model, 3);
  assert.equal(base.seed, 0);
  assert.equal(base.randomSeed, false);
  assert.equal(drawingPayload(base).prompt, "best quality");
  assert.equal(batchParams({ ...base, seed: 4294967295 }, 1).seed, 0);
  assert.deepEqual(
    Object.keys(drawingPayload(base)).sort(),
    [
      "prompt",
      "negative_prompt",
      "model",
      "width",
      "height",
      "steps",
      "sampler",
      "scale",
      "cfg",
      "seed",
      "optimize",
      "cache",
      "transform_prompt",
      "transform_mode",
    ].sort(),
  );
  assert.equal(
    collect(
      {
        ...DEFAULTS,
        prompt: "  x, y  ",
        negative: "  bad  ",
        transparentBg: true,
      },
      model,
      1,
    ).prompt,
    "transparent background, x, y",
  );
  assert.equal(
    collect(
      { ...DEFAULTS, prompt: "Transparent Background", transparentBg: true },
      model,
      1,
    ).prompt,
    "Transparent Background",
  );
  assert.equal(
    collect(
      { ...DEFAULTS, transparentBg: true },
      { ...model, transparentBackground: false },
      1,
    ).transparentBg,
    false,
  );
  assert.equal(
    imageFileName({
      params: { model: "nai/test", seed: 0 },
      blob: new Blob([], { type: "image/jpeg" }),
    }),
    "nai-test-0.jpg",
  );
});
test("drawing: reviewed prompt cleaning is explicit; metadata reader refuses oversized and unsupported files", async () => {
  assert.equal(
    convertToNaiPrompt("&lt;test&gt;, blue_hair"),
    " <test>, blue hair".trim(),
  );
  await assert.rejects(
    readImageParams(new Blob([new Uint8Array(40 * 1024 * 1024 + 1)])),
  );
  await assert.rejects(readImageParams(new Blob(["not an image"])));
});
test("native image package: stored ZIP validates CRC, malformed archive and non-image data never become results", async () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const archive = await createArchive([["image.png", new Blob([png])]]);
  assert.deepEqual(
    new Uint8Array(
      await (
        await decodeNativeImages(await archive.arrayBuffer())
      )[0].arrayBuffer(),
    ),
    png,
  );
  const bytes = new Uint8Array(await archive.arrayBuffer());
  bytes[40] ^= 255;
  await assert.rejects(decodeNativeImages(bytes.buffer));
  await assert.rejects(decodeNativeImages(new Uint8Array([1, 2, 3]).buffer));
});

test("metadata preserves NAI/WebUI meanings: compressed text, sampler map, seed zero, CFG rescale remains view-only", async () => {
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function chunk(type, bytes) {
    const out = new Uint8Array(bytes.length + 12);
    new DataView(out.buffer).setUint32(0, bytes.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(bytes, 8);
    return out;
  }
  const text = (key, value) => new TextEncoder().encode(key + "\0" + value);
  const nai = await readImageParams(
    new Blob([
      signature,
      chunk(
        "tEXt",
        text(
          "Comment",
          JSON.stringify({
            model_name: "NovelAI Diffusion V5",
            prompt: "猫, blue_hair",
            uc: "blurry",
            width: 832,
            height: 1216,
            steps: 25,
            sampler: "k_euler_ancestral",
            scale: 5,
            cfg_rescale: 0.7,
            seed: 0,
          }),
        ),
      ),
      chunk("IEND", new Uint8Array()),
    ]),
  );
  assert.equal(nai.fields.seed, 0);
  assert.equal(nai.fields.model, "nai-diffusion-5-full");
  assert.equal(nai.fields.cfg, undefined);
  assert.ok(nai.extras.some((e) => e.label === "CFG Rescale"));
  assert.equal(nai.fields.prompt, "猫, blue_hair");
  const webui =
    "blue hair\nNegative prompt: blurry\nSteps: 20, Sampler: Euler a, CFG scale: 7, Seed: 0, Size: 512x768, Model: unknown";
  const z = Buffer.concat([Buffer.from("parameters\0\0"), deflateSync(webui)]);
  const parsed = await readImageParams(
    new Blob([signature, chunk("zTXt", z), chunk("IEND", new Uint8Array())]),
  );
  assert.equal(parsed.fields.sampler, "k_euler_ancestral");
  assert.equal(parsed.fields.scale, 7);
  assert.equal(parsed.fields.cfg, undefined);
  assert.equal(parsed.fields.negative_prompt, "blurry");
  assert.equal(parsed.fields.seed, 0);
});
