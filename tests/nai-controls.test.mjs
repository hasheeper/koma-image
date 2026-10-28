import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, collect, drawingPayload, reuseFields, prepareDrawingFields, readBoards } from "../src/domain/drawing.ts";
import { naiCapabilities, qualityTags, negativeTags, appendNaiTags, NAI_FULL, NAI_MEDIUM } from "../src/domain/nai.ts";
import { toNativePayload, toStandardPayload } from "../src/gateway/routes.ts";
import { nativeRequest } from "../src/gateway/native-protocols.ts";
import { novelaiProfile } from "../src/gateway/profile.ts";
import { validateBackupManifest } from "../src/storage/backup-schema.ts";
const model = id => ({ id, name: id, transparentBackground: naiCapabilities(id).v5 });

test("NAI presets: official model-specific quality/negative sets and unsupported selections", () => {
  assert.equal(qualityTags(NAI_FULL, "light"), "very aesthetic, amazing quality, no text");
  assert.equal(qualityTags("nai-diffusion-5-curated", "standard"), "very aesthetic, masterpiece, no text");
  assert.equal(qualityTags("nai-diffusion-4-5-full", "standard"), "location, very aesthetic, masterpiece, no text");
  assert.equal(qualityTags("nai-diffusion-4-5-curated", "standard"), "location, masterpiece, no text, -0.8::feet::, rating:general");
  assert.equal(qualityTags("nai-diffusion-4-5-full", "light"), "");
  assert.equal(negativeTags("nai-diffusion-4-5-curated", "furry"), "");
  assert.match(negativeTags(NAI_FULL, "light"), /0::ai-generated::$/);
  assert.doesNotMatch(negativeTags("nai-diffusion-4-5-full", "light"), /ai-generated/);
  assert.match(negativeTags("nai-diffusion-4-5-curated", "heavy"), /^blurry, lowres, upscaled/);
  for (const id of [NAI_FULL, "nai-diffusion-5-curated", "nai-diffusion-4-5-full", "nai-diffusion-4-5-curated"]) {
    assert.match(negativeTags(id, "human"), /mismatched pupils/);
    assert.equal(negativeTags(id, "none"), "");
  }
  assert.deepEqual(naiCapabilities(NAI_MEDIUM).negative, ["none"]);
  assert.equal(naiCapabilities("nai-diffusion-5-curated").effort, false);
});

test("NAI automatic tags preserve input, exact manual tags, weighted syntax and trailing Text", () => {
  const form = { ...DEFAULTS, prompt: 'girl, very aesthetic, 1.2::masterpiece::, Text: "Hello, world"', negative: "lowres, custom", qualityPreset: "standard", negativePreset: "light", complexity: "high", transparentBg: true };
  const before = structuredClone(form), p = collect(form, model(NAI_FULL), 1);
  assert.deepEqual(form, before);
  assert.equal(p.prompt, 'transparent background, girl, very aesthetic, 1.2::masterpiece::, high complexity, masterpiece, no text, Text: "Hello, world"');
  assert.equal(p.negative_prompt.split(", ").filter(t => t === "lowres").length, 1);
  assert.equal(p.basePrompt, form.prompt); assert.equal(p.baseNegative, form.negative);
  const restored = prepareDrawingFields(reuseFields({ params: p }), [model(NAI_FULL)], [DEFAULTS.sampler]).changes;
  assert.equal(restored.prompt, form.prompt); assert.equal(restored.negative, form.negative);
  assert.equal(restored.qualityPreset, "standard"); assert.equal(restored.negativePreset, "light");
  assert.equal(collect({ ...DEFAULTS, ...restored }, model(NAI_FULL), 1).prompt, p.prompt);
  assert.equal(appendNaiTags("High Complexity, no text", "high complexity, no text"), "High Complexity, no text");
  assert.equal(collect(form, model("nai-diffusion-4-5-full"), 1).complexity, "none");
  for (const dataset of ["fur dataset", "background dataset"]) {
    const p = collect({ ...DEFAULTS, prompt: `${dataset}, girl`, transparentBg: true, qualityPreset: "light" }, model(NAI_FULL), 1);
    assert.equal(p.prompt, `${dataset}, transparent background, girl, very aesthetic, amazing quality, no text`);
    assert.equal(p.basePrompt, `${dataset}, girl`);
  }
});

test("NAI Medium uses fixed Heavy, excludes user/role negatives and rescale, and preserves High settings", () => {
  const form = { ...DEFAULTS, model: NAI_MEDIUM, steps: 32, sampler: "k_euler", scale: 6.5, cfgRescale: 0.7, negative: "custom negative", negativePreset: "heavy", qualityPreset: "light", complexity: "ultra", characters: [{ id: "c1", on: true, prompt: "girl", negative: "custom role negative", centers: [{ x: 0.5, y: 0.5 }] }] };
  const before = structuredClone(form), p = collect(form, model(NAI_MEDIUM), 1);
  assert.equal(p.steps, 14); assert.equal(p.sampler, "k_euler_ancestral"); assert.equal(p.scale, 6.5);
  assert.equal(p.negative_prompt, 'nsfw, ' + negativeTags(NAI_FULL, 'heavy')); assert.equal(p.characters[0].negative, "");
  assert.equal(p.localCharacters[0].negative, "custom role negative");
  const wire = nativeRequest(novelaiProfile, drawingPayload(p)).body;
  assert.equal(wire.model, NAI_MEDIUM); assert.equal(wire.parameters.params_version, 4);
  assert.equal(wire.parameters.cfg, undefined); assert.equal(wire.parameters.cfg_rescale, undefined);
  assert.equal(wire.parameters.v4_negative_prompt.caption.char_captions[0].char_caption, "");
  assert.equal(wire.parameters.negative_prompt, p.negative_prompt);
  assert.equal(wire.parameters.v4_negative_prompt.caption.base_caption, p.negative_prompt);
  const nsfw = nativeRequest(novelaiProfile, { ...drawingPayload(p), prompt: 'NSFW, girl', negative_prompt: 'ignored' }).body;
  assert.equal(nsfw.parameters.negative_prompt, negativeTags(NAI_FULL, 'heavy'));
  assert.deepEqual(form, before);
  const high = collect(form, model(NAI_FULL), 1);
  assert.equal(high.steps, 32); assert.equal(high.sampler, "k_euler"); assert.equal(high.cfgRescale, 0.7);
  assert.match(high.negative_prompt, /^custom negative,/);
});

test("NAI guidance shares scale/rescale across official, native gateway and Studio without legacy cfg", () => {
  const p = drawingPayload(collect({ ...DEFAULTS, cfg: 10, scale: 5.5, cfgRescale: 0.65 }, model(NAI_FULL), 1));
  assert.equal(DEFAULTS.cfg, null);
  assert.equal(Object.hasOwn(p, "cfg"), false);
  const official = nativeRequest(novelaiProfile, { ...p, max_cost: 7 }).body;
  assert.equal(official.parameters.cfg_rescale, 0.65); assert.equal(official.parameters.scale, 5.5);
  assert.equal(official.parameters.cfg, undefined); assert.equal(official.max_cost, undefined);
  const gateway = toNativePayload({ ...p, cfg: 10, max_cost: 7 });
  assert.equal(Object.hasOwn(gateway.parameters, "cfg"), false); assert.equal(gateway.parameters.cfg_rescale, 0.65);
  assert.equal(gateway.parameters.scale, 5.5);
  assert.equal(gateway.max_cost, 7); assert.equal(gateway.parameters.params_version, 3);
  const standard = toStandardPayload({ ...p, cfg: 10, max_cost: 7 });
  assert.equal(Object.hasOwn(standard, "cfg"), false);
  assert.equal(standard.cfg_rescale, 0.65); assert.equal(standard.scale, 5.5); assert.equal(standard.max_cost, 7);
  assert.equal(Object.hasOwn(drawingPayload(collect({ ...DEFAULTS, model: NAI_MEDIUM, cfgRescale: 0.65 }, model(NAI_MEDIUM), 1)), "cfg_rescale"), false);
  assert.equal(nativeRequest(novelaiProfile, { model: NAI_FULL, cfg: 10 }).body.parameters.cfg_rescale, 0);
});

test("NAI imports reset preset expansion unless raw local metadata explicitly restores it", () => {
  const changes = prepareDrawingFields({ prompt: "girl, masterpiece, no text", negative_prompt: "lowres", cfgRescale: 0.8 }, [model(NAI_FULL)], [DEFAULTS.sampler]).changes;
  assert.equal(changes.qualityPreset, "none"); assert.equal(changes.negativePreset, "none");
  assert.equal(changes.complexity, "none"); assert.equal(changes.cfgRescale, 0.8);
  assert.equal(collect({ ...DEFAULTS, qualityPreset: "standard", negativePreset: "heavy", ...changes }, model(NAI_FULL), 1).prompt, "girl, masterpiece, no text");
  assert.equal(prepareDrawingFields({ cfgRescale: 100 }, [], []).changes.cfgRescale, 1);
});

test("NAI controls: old Koma v2 boards keep cfg and receive independent defaults; new values round-trip", () => {
  const boards = readBoards({}), legacy = structuredClone(boards);
  legacy.items[0].form.cfg = 10;
  for (const key of ["cfgRescale", "noiseSchedule", "varietyPlus", "naiMode", "complexity", "qualityPreset", "negativePreset"]) delete legacy.items[0].form[key];
  const manifest = { app: "koma-image", kind: "backup", version: 2, id: "12345678-1234-1234-1234-123456789012", createdAt: new Date(0).toISOString(), favorites: [], conversations: [], assets: [], preferences: { drawing: JSON.stringify({ boards: legacy }) } };
  const read = readBoards(JSON.parse(validateBackupManifest(manifest).preferences.drawing)).items[0].form;
  assert.equal(read.cfg, 10); assert.equal(read.cfgRescale, 0); assert.equal(read.noiseSchedule, 'auto'); assert.equal(read.qualityPreset, "none");
  assert.equal(read.varietyPlus, false);
  Object.assign(boards.items[0].form, { naiMode: "furry", cfgRescale: 0.65, noiseSchedule: 'polyexponential', varietyPlus: true, complexity: "ultra", qualityPreset: "light", negativePreset: "human", model: NAI_MEDIUM });
  manifest.preferences.drawing = JSON.stringify({ boards });
  assert.deepEqual(readBoards(JSON.parse(validateBackupManifest(manifest).preferences.drawing)), boards);
  assert.equal(boards.items[0].form.cfg, null);
  delete boards.items[0].form.cfg;
  manifest.preferences.drawing = JSON.stringify({ boards });
  assert.equal(readBoards(JSON.parse(validateBackupManifest(manifest).preferences.drawing)).items[0].form.cfg, null);
  boards.items[0].form.cfg = "10";
  manifest.preferences.drawing = JSON.stringify({ boards });
  assert.throws(() => validateBackupManifest(manifest));
});

test("NAI rescale restores both drawing and EDIT metadata, including explicit zero and missing old values", () => {
  for (const [params, expected] of [[{ cfgRescale: 0.65 }, 0.65], [{ cfg_rescale: 0.35 }, 0.35], [{ cfgRescale: 0, cfg_rescale: 0.9 }, 0], [{ cfg: 10 }, 0]]) {
    const fields = prepareDrawingFields(reuseFields({ params }), [], []).changes;
    assert.equal(fields.cfgRescale, expected);
  }
  assert.equal(prepareDrawingFields({ cfg: null }, [], []).changes.cfg, null);
});

test("NAI modes use one model ID, preserve raw tags and round-trip independently of presets/Effort", () => {
  for (const id of [NAI_FULL, NAI_MEDIUM, "nai-diffusion-5-curated", "nai-diffusion-4-5-full", "nai-diffusion-4-5-curated"]) {
    const form = { ...DEFAULTS, model: id, naiMode: "furry", prompt: 'wolf, Text: "Hi"', transparentBg: true, qualityPreset: "standard", negativePreset: "human" };
    const p = collect(form, model(id), 1);
    assert.equal(p.model, id); assert.equal(p.naiMode, "furry");
    assert.match(p.prompt, /^fur dataset, /); assert.equal(p.basePrompt, form.prompt);
    assert.equal(p.negativePreset, id === NAI_MEDIUM ? "none" : "human");
    const wire = nativeRequest(novelaiProfile, drawingPayload(p)).body;
    assert.equal(wire.input, p.prompt); assert.equal(wire.parameters.v4_prompt.caption.base_caption, p.prompt);
    assert.equal(wire.naiMode, undefined); assert.equal(wire.parameters.naiMode, undefined);
    assert.equal(toNativePayload(drawingPayload(p)).input, p.prompt);
    const restored = prepareDrawingFields(reuseFields({ params: p }), [model(id)], [DEFAULTS.sampler]).changes;
    assert.equal(restored.naiMode, "furry"); assert.equal(restored.prompt, form.prompt);
    assert.equal(collect({ ...DEFAULTS, ...restored }, model(id), 1).prompt, p.prompt);
    assert.doesNotMatch(collect({ ...form, naiMode: "anime" }, model(id), 1).prompt, /dataset/);
  }
  for (const prompt of ["fur dataset, wolf", "FUR DATASET, wolf", "background dataset, forest"]) {
    const p = collect({ ...DEFAULTS, prompt, naiMode: "furry", transparentBg: true }, model(NAI_FULL), 1);
    assert.equal(p.basePrompt, prompt); assert.match(p.prompt, /^(fur|FUR|background) [dD][aA][tT][aA][sS][eE][tT], transparent background,/);
    assert.equal(p.prompt.toLowerCase().split("dataset").length, 2);
    assert.equal(p.naiMode, prompt.startsWith("background") ? "anime" : "furry");
  }
  const duplicate = collect({ ...DEFAULTS, naiMode: "furry", prompt: 'wolf, fur dataset, fur dataset, Text: "fur dataset"' }, model(NAI_FULL), 1);
  assert.equal(duplicate.prompt, 'fur dataset, wolf, Text: "fur dataset"');
  assert.equal(duplicate.basePrompt, 'wolf, fur dataset, fur dataset, Text: "fur dataset"');
  const external = prepareDrawingFields({ prompt: "fur dataset, wolf" }, [], []).changes;
  assert.equal(external.naiMode, "anime");
  assert.equal(collect({ ...DEFAULTS, ...external }, model(NAI_FULL), 1).prompt, "fur dataset, wolf");
  assert.equal(collect({ ...DEFAULTS, naiMode: "furry", prompt: "wolf" }, model("unrelated-model"), 1).prompt, "wolf");
});
