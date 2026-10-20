import { deflateSync, deflateRawSync } from "node:zlib";
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
import { readImageParams } from "../src/native/image-meta.ts";
import { convertToNaiPrompt } from "../src/native/prompt-converter.ts";
import { imageDimensions } from "../src/native/image-dimensions.ts";
import { decodeNativeImages } from "../src/native/native-images.ts";
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

test("prompt conversion: nested and zero weights, escaped separators, entities and line breaks keep their meaning", () => {
  assert.equal(convertToNaiPrompt("((blue_hair)), (cat:0), (dog:1)"),
    "1.21::blue hair::, 0::cat::, dog");
  assert.equal(convertToNaiPrompt("((cat:1.5)), sky\\,cloud, \\(smile\\)"),
    "1.65::cat::, sky, cloud, (smile)");
  assert.equal(convertToNaiPrompt("&lt;cat&gt;, &#x732b;\r\n\r\nblue_hair"),
    "<cat>, 猫\n\nblue hair");
  assert.equal(convertToNaiPrompt("&#1114112;, &unknown;, (unclosed"),
    "&#1114112;, &unknown;, (unclosed");
});

test("image dimensions: JPEG markers and all WebP headers, including padded metadata, preserve source sizes", () => {
  const dataUrl = (mime, bytes) => `data:image/${mime};base64,${bytes.toString("base64")}`;
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe1, 0, 5, 1, 2, 3, 0xff, 0x01,
    0xff, 0xc2, 0, 7, 8, 2, 88, 3, 32, 0xff, 0xd9,
  ]);
  assert.deepEqual(imageDimensions(dataUrl("jpeg", jpeg)), { width: 800, height: 600 });
  const chunk = (type, bytes) => {
    const out = Buffer.alloc(8 + bytes.length + bytes.length % 2);
    out.write(type, 0);
    out.writeUInt32LE(bytes.length, 4);
    out.set(bytes, 8);
    return out;
  };
  const extended = Buffer.alloc(10);
  extended.writeUIntLE(1599, 4, 3);
  extended.writeUIntLE(899, 7, 3);
  const lossless = Buffer.alloc(5);
  lossless[0] = 0x2f;
  lossless.writeUInt32LE(1599 | (899 << 14), 1);
  const lossy = Buffer.alloc(10);
  lossy.set([0x9d, 1, 0x2a], 3);
  lossy.writeUInt16LE(1600 | 0xc000, 6);
  lossy.writeUInt16LE(900 | 0xc000, 8);
  for (const [type, bytes] of [["VP8X", extended], ["VP8L", lossless], ["VP8 ", lossy]]) {
    const body = Buffer.concat([chunk("EXIF", Buffer.from([1, 2, 3])), chunk(type, bytes)]);
    const header = Buffer.alloc(12);
    header.write("RIFF", 0);
    header.writeUInt32LE(body.length + 4, 4);
    header.write("WEBP", 8);
    const webp = Buffer.concat([header, body]);
    assert.deepEqual(imageDimensions(dataUrl("webp", webp)), { width: 1600, height: 900 });
    assert.throws(() => imageDimensions(dataUrl("webp", webp.subarray(0, -2))), /无法读取图片尺寸/);
  }
  assert.throws(() => imageDimensions(dataUrl("jpeg", jpeg.subarray(0, 17))), /无法读取图片尺寸/);
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

test("metadata: compressed international text, optional character data and malformed chunks retain their existing outcomes", async () => {
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function chunk(type, bytes) {
    const out = new Uint8Array(bytes.length + 12);
    new DataView(out.buffer).setUint32(0, bytes.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(bytes, 8);
    return out;
  }
  const image = (value) => new Blob([
    signature,
    chunk("zTXt", new TextEncoder().encode("broken\0\0invalid deflate")),
    chunk("iTXt", Buffer.concat([Buffer.from("Comment\0\x01\0\0\0"), deflateSync(JSON.stringify(value))])),
    chunk("IEND", new Uint8Array()),
  ]);
  const result = await readImageParams(image({
    prompt: "  猫  ", seed: null, scale: "", steps: "25", width: "832", height: 1216,
    v4_prompt: { use_coords: true, caption: { char_captions: [
      { char_caption: "  blue hair  ", centers: [{ x: 0.5, y: 0.8 }] }, null,
    ] } },
    v4_negative_prompt: { caption: { char_captions: [{ char_caption: "bad" }] } },
  }));
  assert.deepEqual(result.fields, { prompt: "猫", width: 832, height: 1216, steps: 25, scale: 0, seed: 0 });
  assert.deepEqual(result.extras, [{ label: "角色 1 · C5", value: "blue hair" }, { label: "角色 1 排除", value: "bad" }]);
  const primitive = await readImageParams(image({ prompt: "ok", v4_prompt: "not an object" }));
  assert.deepEqual(primitive.extras, []);
  await assert.rejects(readImageParams(image({ prompt: "ok", v4_prompt: { caption: { char_captions: {} } } })),
    { name: "TypeError", message: "characters.forEach is not a function" });
  const jpeg = new Blob([new Uint8Array([255, 216, 255]), new TextEncoder().encode('{"prompt":"中文","seed":0}\0')]);
  assert.deepEqual((await readImageParams(jpeg)).fields, { prompt: "中文", seed: 0 });
});

test("native image package: deflated bytes, CRC and declared decompression bounds are preserved", async () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...new Uint8Array(2048)]);
  const stored = new Uint8Array(await (await createArchive([["image.png", new Blob([png])]])).arrayBuffer());
  const view = new DataView(stored.buffer), endAt = stored.length - 22;
  const oldDirectory = view.getUint32(endAt + 16, true);
  const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  const header = stored.slice(0, start), packed = deflateRawSync(png);
  const directory = stored.slice(oldDirectory, endAt), end = stored.slice(endAt);
  new DataView(header.buffer).setUint16(8, 8, true);
  new DataView(header.buffer).setUint32(18, packed.length, true);
  new DataView(directory.buffer).setUint16(10, 8, true);
  new DataView(directory.buffer).setUint32(20, packed.length, true);
  const directoryAt = header.length + packed.length;
  new DataView(end.buffer).setUint32(16, directoryAt, true);
  const archive = new Uint8Array(await new Blob([header, packed, directory, end]).arrayBuffer());
  assert.deepEqual(new Uint8Array(await (await decodeNativeImages(archive.buffer))[0].arrayBuffer()), png);
  for (const size of [png.length - 1, 32 * 1024 * 1024 + 1]) {
    const invalid = archive.slice();
    new DataView(invalid.buffer).setUint32(directoryAt + 24, size, true);
    await assert.rejects(decodeNativeImages(invalid.buffer), /原生图片包损坏/);
  }
  const corrupt = archive.slice();
  corrupt[directoryAt + 16] ^= 255;
  await assert.rejects(decodeNativeImages(corrupt.buffer), /原生图片包损坏/);
});
