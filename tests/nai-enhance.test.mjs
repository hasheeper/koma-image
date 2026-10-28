import test from 'node:test';
import assert from 'node:assert/strict';
import { naiEnhanceSize, availableEnhanceScales, naiEnhanceMagnitudes, naiEnhancePrompt } from '../src/domain/nai-enhance.ts';
import { buildEditorPayload } from '../src/domain/media.ts';
import { nativeRequest } from '../src/gateway/native-protocols.ts';
import { novelaiProfile } from '../src/gateway/profile.ts';
import { toStandardPayload, toNativePayload } from '../src/gateway/routes.ts';
import { supportsSourcePayload } from '../src/domain/source-funding.ts';
import { imageParameters } from '../src/domain/image-parameters.ts';

const ids = ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-5-full', 'nai-diffusion-5-curated', 'nai-diffusion-5-full-medium'];
const model = id => ({ id, upstreamId: id, profileId: novelaiProfile.id, provider: 'novelai', tools: ['img2img', 'inpaint'], operations: ['generate', 'edit'], maxPixels: 3145728, sourceMaxPixels: 3145728, maxImages: 1, transparentBackground: true });
function png(width = 512, height = 512) {
  const h = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(h);
  h.writeUInt32BE(width, 16); h.writeUInt32BE(height, 20); return 'data:image/png;base64,' + h.toString('base64');
}

test('ordinary Enhance preserves the source and maps five presets to official img2img on all five models', () => {
  for (const id of ids) for (const enhanceScale of [1, 1.5, 2]) for (const [i, magnitude] of naiEnhanceMagnitudes.entries()) {
    const source = png(), payload = buildEditorPayload('img2img', model(id), { png: source }, {
      prompt: 'girl, Text:hello', negative_prompt: 'watermark', enhance: true, enhanceScale, enhanceMagnitude: i + 1, ...magnitude, seed: 42,
    });
    const { path, body } = nativeRequest(novelaiProfile, payload);
    assert.equal(path, '/ai/generate-image'); assert.equal(body.action, 'img2img'); assert.equal(body.model, id);
    assert.equal(body.parameters.image, source.split(',')[1]);
    assert.equal(body.parameters.width, 512 * enhanceScale); assert.equal(body.parameters.height, 512 * enhanceScale);
    assert.equal(body.parameters.strength, magnitude.strength); assert.equal(body.parameters.noise, magnitude.noise);
    assert.equal(body.parameters.seed, 42); assert.equal(body.parameters.extra_noise_seed, 41);
    assert.match(body.input, /-2::upscaled, blurry::,Text:hello$/);
    assert.equal(body.parameters.v4_prompt.caption.base_caption, body.input);
    for (const key of ['enhance', 'enhanceScale', 'enhanceMagnitude', 'upscaled_enhance', 'mask', 'cfg', 'max_cost']) assert.equal(body.parameters[key], undefined);
    if (id.endsWith('medium')) { assert.equal(body.parameters.steps, 14); assert.equal(body.parameters.cfg_rescale, undefined); }
  }
});

test('Enhance sizes filter by exact alignment and area; standard 832×1216 snaps as the official client', () => {
  assert.deepEqual(availableEnhanceScales({ width: 512, height: 512 }), [2, 1.5, 1]);
  assert.deepEqual(availableEnhanceScales({ width: 832, height: 1216 }), [1.5, 1]);
  assert.deepEqual(naiEnhanceSize({ width: 832, height: 1216 }, 1.5), { width: 1280, height: 1856 });
  assert.deepEqual(naiEnhanceSize({ width: 1216, height: 832 }, 1.5), { width: 1856, height: 1280 });
  assert.deepEqual(availableEnhanceScales({ width: 1536, height: 2048 }), [1]);
  assert.deepEqual(availableEnhanceScales({ width: 576, height: 640 }), [2, 1]);
  for (const scale of ['max', 0, 3, Infinity, NaN]) assert.throws(() => naiEnhanceSize({ width: 512, height: 512 }, scale), /尚未接入|仅支持/);
  assert.throws(() => naiEnhanceSize({ width: 1536, height: 2048 }, 2), /尺寸范围/);
  assert.throws(() => naiEnhanceSize({ width: 513, height: 512 }, 1), /64/);
});

test('Enhance cannot degrade into a gateway request, infill, upscale, mismatched output, or unsupported Max', () => {
  const m = model(ids[0]), gateway = { ...m, profileId: 'koma-standard-v1' };
  const payload = buildEditorPayload('img2img', m, { png: png() }, { enhance: true, enhanceScale: 2 });
  assert.equal(supportsSourcePayload(m, payload), true);
  assert.equal(supportsSourcePayload(gateway, payload), false);
  assert.equal(supportsSourcePayload({ ...m, upstreamId: 'custom-alias' }, payload), false);
  assert.throws(() => toStandardPayload(payload), /Enhance/);
  assert.throws(() => toNativePayload(payload), /Enhance/);
  assert.throws(() => buildEditorPayload('img2img', gateway, { png: png() }, { enhance: true, enhanceScale: 2 }), /官方/);
  assert.throws(() => buildEditorPayload('inpaint', m, { png: png() }, { enhance: true, enhanceScale: 1 }, png()), /图生图/);
  assert.throws(() => nativeRequest(novelaiProfile, { ...payload, width: 512 }), /不一致/);
  assert.throws(() => nativeRequest(novelaiProfile, { ...payload, enhanceScale: 'max' }), /Max/);
  assert.throws(() => nativeRequest(novelaiProfile, { ...payload, upscaled_enhance: true }), /Max/);
});

test('V5 Max keeps nominal source dimensions, sets the server flag and skips ordinary Enhance prompt correction', () => {
  for (const id of ids.filter(id => id.startsWith('nai-diffusion-5-'))) for (const [i, magnitude] of naiEnhanceMagnitudes.entries()) {
    const source = png(832, 1216), prompt = 'girl, Text:hello';
    const payload = buildEditorPayload('img2img', model(id), { png: source }, {
      prompt, enhance: true, enhanceScale: 'max', enhanceMagnitude: i + 1, ...magnitude, seed: 0,
    });
    assert.equal(supportsSourcePayload(model(id), payload), true);
    const { path, body } = nativeRequest(novelaiProfile, payload);
    assert.equal(path, '/ai/generate-image'); assert.equal(body.action, 'img2img'); assert.equal(body.model, id);
    assert.equal(body.parameters.image, source.split(',')[1]);
    assert.equal(body.parameters.width, 832); assert.equal(body.parameters.height, 1216);
    assert.equal(body.parameters.upscaled_enhance, true);
    assert.equal(body.parameters.strength, magnitude.strength); assert.equal(body.parameters.noise, magnitude.noise);
    assert.equal(body.parameters.seed, 0); assert.equal(body.parameters.extra_noise_seed, 0xffffffff);
    assert.equal(body.input, prompt); assert.equal(body.parameters.v4_prompt.caption.base_caption, prompt);
    assert.equal(body.parameters.enhanceScale, undefined); assert.equal(body.parameters.enhanceMagnitude, undefined);
    const recipe = imageParameters({ ...payload, width: 1467, height: 2144, basePrompt: prompt });
    assert.equal(recipe.enhanceScale, 'max'); assert.equal(recipe.width, 1467); assert.equal(recipe.height, 2144);
    assert.throws(() => nativeRequest(novelaiProfile, { ...payload, width: 1467, height: 2144 }), /不一致/);
    if (id.endsWith('medium')) { assert.equal(body.parameters.steps, 14); assert.equal(body.parameters.cfg_rescale, undefined); }
  }
});

test('Max availability follows the V5 and source-area boundary; actual output is not rounded to 64px', () => {
  const id = 'nai-diffusion-5-full';
  for (const [source, expected] of [
    [{ width: 512, height: 512 }, { width: 1024, height: 1024 }],
    [{ width: 832, height: 1216 }, { width: 1467, height: 2144 }],
    [{ width: 1216, height: 832 }, { width: 2144, height: 1467 }],
    [{ width: 1024, height: 1024 }, { width: 1773, height: 1773 }],
    [{ width: 1536, height: 1600 }, { width: 1737, height: 1810 }],
  ]) assert.deepEqual(naiEnhanceSize(source, 'max', id), expected);
  assert.deepEqual(availableEnhanceScales({ width: 512, height: 512 }, id), ['max', 2, 1.5, 1]);
  assert.deepEqual(availableEnhanceScales({ width: 832, height: 1216 }, id), ['max', 1.5, 1]);
  assert.deepEqual(availableEnhanceScales({ width: 1600, height: 1600 }, id), [1]);
  assert.deepEqual(availableEnhanceScales({ width: 512, height: 512 }, ids[0]), [2, 1.5, 1]);
  assert.throws(() => naiEnhanceSize({ width: 1600, height: 1600 }, 'max', id), /不适用/);
  assert.throws(() => naiEnhanceSize({ width: 512, height: 512 }, 'max', ids[0]), /V5/);
  const gateway = { ...model(id), profileId: 'koma-standard-v1' };
  assert.throws(() => buildEditorPayload('img2img', gateway, { png: png() }, { enhance: true, enhanceScale: 'max' }), /官方/);
});

test('Enhance stores effective prompt and controls without losing the raw recipe or polluting ordinary img2img', () => {
  const m = model(ids[2]), prompt = 'fur dataset, girl, Text:hello';
  const settings = { prompt, negative_prompt: 'watermark', enhance: true, enhanceScale: 1.5, enhanceMagnitude: null, strength: .37, noise: .09 };
  const payload = buildEditorPayload('img2img', m, { png: png() }, settings);
  assert.equal(payload.strength, .37); assert.equal(payload.noise, .09);
  const recipe = imageParameters({ ...payload, basePrompt: prompt, baseNegative: settings.negative_prompt });
  assert.equal(recipe.basePrompt, prompt); assert.equal(recipe.enhance, true); assert.equal(recipe.enhanceScale, 1.5); assert.equal(recipe.enhanceMagnitude, null);
  assert.equal(recipe.init_image, undefined);
  assert.equal(naiEnhancePrompt(naiEnhancePrompt(prompt)), naiEnhancePrompt(prompt));
  const plain = nativeRequest(novelaiProfile, buildEditorPayload('img2img', m, { png: png() }, { ...settings, enhance: false })).body;
  assert.equal(plain.input, prompt); assert.equal(plain.parameters.width, 512); assert.equal(plain.parameters.height, 512);
});
