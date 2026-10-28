import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeRequest, nativeCatalog } from '../src/gateway/native-protocols.ts';
import { novelaiProfile } from '../src/gateway/profile.ts';
import { buildEditorPayload } from '../src/domain/media.ts';
import { DEFAULTS, collect, drawingPayload, reuseFields, prepareDrawingFields, readBoards } from '../src/domain/drawing.ts';
import { naiMediumNegative } from '../src/domain/nai.ts';
import { imageParameters } from '../src/domain/image-parameters.ts';
import { toStandardPayload, toNativePayload } from '../src/gateway/routes.ts';
import { parseParameters, parameterIssue } from '../src/ask/draft/parameters.ts';
import { naiVarietySigma, supportsNaiVariety } from '../src/domain/nai-parameters.ts';
import { readNaiSettings } from '../src/domain/nai.ts';

const full = 'nai-diffusion-4-5-full', v5 = 'nai-diffusion-5-full';
const samplers = ['k_euler_ancestral', 'k_euler', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m_sde', 'k_dpmpp_2m', 'k_dpmpp_sde'];
const model = id => ({ id, name: id, provider: 'novelai', profileId: 'nai-official-v1', tools: ['img2img', 'inpaint'], operations: ['generate', 'edit'], maxPixels: 3145728, sourceMaxPixels: 3145728, transparentBackground: false });
const header = Buffer.alloc(24);
Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(header);
header.writeUInt32BE(512, 16); header.writeUInt32BE(512, 20);
const png = 'data:image/png;base64,' + header.toString('base64');

test('official sampler matrix and schedules apply to generation and both edit actions', () => {
  const catalog = nativeCatalog(novelaiProfile, { active: true, tier: 3 });
  assert.deepEqual(catalog.valid_samplers, samplers);
  assert.equal(catalog.models[full].max_resolution, 3145728);
  for (const id of [full, 'nai-diffusion-4-5-curated', v5, 'nai-diffusion-5-curated']) for (const sampler of samplers) {
    const expected = id.startsWith('nai-diffusion-5-') ? 'karras' : sampler === 'k_dpmpp_2m' ? 'exponential' : 'karras';
    const generation = drawingPayload(collect({ ...DEFAULTS, model: id, sampler }, model(id), 1));
    assert.equal(nativeRequest(novelaiProfile, generation).body.parameters.noise_schedule, expected);
    for (const action of id.endsWith('5-curated') ? ['img2img'] : ['img2img', 'inpaint']) {
      const edit = buildEditorPayload(action, model(id), { png }, { sampler }, action === 'inpaint' ? png : null);
      const wire = nativeRequest(novelaiProfile, edit).body;
      assert.equal(wire.parameters.sampler, sampler);
      assert.equal(wire.parameters.noise_schedule, expected);
    }
  }
  for (const schedule of ['karras', 'exponential', 'polyexponential']) {
    const edit = buildEditorPayload('inpaint', model(full), { png }, { noiseSchedule: schedule }, png);
    assert.equal(nativeRequest(novelaiProfile, edit).body.parameters.noise_schedule, schedule);
    assert.equal(nativeRequest(novelaiProfile, { ...edit, model: v5 }).body.parameters.noise_schedule, 'karras');
  }
});

test('official requests reject invalid parameters before transport; gateway catalogs stay independent', () => {
  const source = { model: full, init_image: png, tool: 'img2img' };
  for (const sampler of ['ddim_v3', 'made-up-sampler']) {
    assert.throws(() => nativeRequest(novelaiProfile, { ...source, sampler }), /采样器/);
    assert.throws(() => buildEditorPayload('img2img', model(full), { png }, { sampler }), /采样器/);
  }
  for (const [key, value] of [['scale', NaN], ['scale', Infinity], ['scale', -1], ['steps', 51], ['steps', 1.5], ['cfg_rescale', 1.01], ['noise_schedule', 'native']])
    assert.throws(() => nativeRequest(novelaiProfile, { ...source, [key]: value }));
  for (const [strength, noise] of [[0, 0], [1, 0], [.5, 1]]) {
    assert.throws(() => nativeRequest(novelaiProfile, { ...source, strength, noise }), /强度与噪声/);
    assert.throws(() => buildEditorPayload('img2img', model(full), { png }, { strength, noise }), /参数/);
  }
  for (const strength of [.01, .99]) for (const noise of [0, .99]) {
    const wire = nativeRequest(novelaiProfile, { ...source, strength, noise }).body;
    assert.equal(wire.parameters.strength, strength); assert.equal(wire.parameters.noise, noise);
  }
  assert.throws(() => buildEditorPayload('inpaint', model(full), { png }, { strength: 0 }, png));
  const infill = nativeRequest(novelaiProfile, { ...source, tool: 'inpaint', mask_image: png, strength: 1 }).body;
  assert.equal(infill.parameters.img2img, undefined);
  const gateway = { ...model(full), profileId: 'koma-standard-v1' };
  assert.equal(buildEditorPayload('img2img', gateway, { png }, { sampler: 'gateway-only', strength: 0, noise: 1 }, null, ['gateway-only']).sampler, 'gateway-only');
  assert.throws(() => buildEditorPayload('img2img', gateway, { png }, { sampler: 'invalid' }, null, ['gateway-only']), /采样器/);
  const standard = toStandardPayload({ model: full, noiseSchedule: 'exponential', noise_schedule: 'exponential' });
  assert.equal(standard.noiseSchedule, undefined); assert.equal(standard.noise_schedule, 'karras');
  assert.equal(toNativePayload({ model: full, noise_schedule: 'exponential' }).parameters.noise_schedule, 'karras');
  // A source may change before submission: keep the user's choice internal,
  // resolve it for the actual protocol, and never leak that field to a gateway.
  const fallback = buildEditorPayload('img2img', gateway, { png }, { noiseSchedule: 'polyexponential', sampler: 'k_dpmpp_2m' });
  assert.equal(nativeRequest(novelaiProfile, fallback).body.parameters.noise_schedule, 'polyexponential');
  assert.equal(toStandardPayload(fallback).noiseSchedule, undefined);
  assert.equal(toStandardPayload(fallback).noise_schedule, 'karras');
});

test('Guidance above slider range and noise schedule survive boards, history, EDIT and ASK review', () => {
  const form = { ...DEFAULTS, model: full, sampler: 'k_dpmpp_2m', noiseSchedule: 'polyexponential', scale: 21.3 };
  const params = collect(form, model(full), 1), wire = nativeRequest(novelaiProfile, drawingPayload(params)).body;
  assert.equal(wire.parameters.scale, 21.3); assert.equal(wire.parameters.noise_schedule, 'polyexponential');
  const restored = prepareDrawingFields(reuseFields({ params: imageParameters(params) }), [model(full)], samplers).changes;
  assert.equal(restored.scale, 21.3); assert.equal(restored.noiseSchedule, 'polyexponential');
  assert.equal(prepareDrawingFields({ scale: 21.345 }, [], []).changes.scale, 21.345);
  const edit = buildEditorPayload('img2img', model(full), { png }, { ...restored, negative_prompt: restored.negative });
  assert.equal(edit.scale, 21.3); assert.equal(edit.noise_schedule, 'polyexponential');
  assert.equal(readBoards({ boards: { items: [{ id: 'b', form }], activeId: 'b' } }).items[0].form.noiseSchedule, 'polyexponential');
  assert.equal(readBoards({}).items[0].form.noiseSchedule, 'auto');
  assert.equal(parseParameters({ scale: 21.3, noiseSchedule: 'exponential' }).scale, 21.3);
  assert.equal(parameterIssue('noiseSchedule', form, model(full)), '');
  assert.match(parameterIssue('noiseSchedule', { ...form, model: v5 }, model(v5)), /噪声调度/);
});

test('Medium fixes Heavy for all actions while preserving local negative and High settings', () => {
  const id = v5 + '-medium';
  for (const prompt of ['girl', 'nsfw, girl']) for (const tool of [undefined, 'img2img', 'inpaint']) {
    const wire = nativeRequest(novelaiProfile, { model: id, prompt, negative_prompt: 'user-negative', sampler: 'ignored-high-setting', steps: 32, cfg_rescale: .9, ...(tool ? { tool, init_image: png, strength: .5 } : {}), ...(tool === 'inpaint' ? { mask_image: png } : {}) }).body;
    assert.equal(wire.parameters.steps, 14); assert.equal(wire.parameters.sampler, 'k_euler_ancestral');
    assert.equal(wire.parameters.cfg_rescale, undefined); assert.equal(wire.parameters.noise_schedule, 'karras');
    assert.equal(wire.parameters.negative_prompt, naiMediumNegative(prompt));
    assert.equal(wire.parameters.v4_negative_prompt.caption.base_caption, naiMediumNegative(prompt));
    assert.doesNotMatch(wire.parameters.negative_prompt, /user-negative/);
  }
});

test('Variety+ uses official V4.5 resolution-scaled CFG Delay across generation, editing and Enhance', () => {
  for (const id of [full, 'nai-diffusion-4-5-curated']) {
    assert.equal(supportsNaiVariety(model(id)), true);
    for (const [width, height, sigma] of [[832, 1216, 58], [1216, 832, 58], [1024, 1024, 58 * Math.sqrt(16384 / 15808)]]) {
      const payload = drawingPayload(collect({ ...DEFAULTS, model: id, width, height, varietyPlus: true }, model(id), 1));
      const wire = nativeRequest(novelaiProfile, payload).body.parameters;
      assert.equal(wire.skip_cfg_above_sigma, sigma);
      assert.equal(wire.varietyPlus, undefined); assert.equal(wire.scale, 5); assert.equal(wire.cfg_rescale, 0);
    }
    for (const tool of ['img2img', 'inpaint']) {
      const payload = buildEditorPayload(tool, model(id), { png }, { varietyPlus: true }, tool === 'inpaint' ? png : null);
      assert.equal(nativeRequest(novelaiProfile, payload).body.parameters.skip_cfg_above_sigma, 58 * Math.sqrt(4096 / 15808));
    }
    const enhanced = buildEditorPayload('img2img', model(id), { png }, { varietyPlus: true, enhance: true, enhanceScale: 2 });
    assert.equal(nativeRequest(novelaiProfile, enhanced).body.parameters.skip_cfg_above_sigma, 58 * Math.sqrt(16384 / 15808));
    assert.equal(nativeRequest(novelaiProfile, { model: id, varietyPlus: false }).body.parameters.skip_cfg_above_sigma, undefined);
  }
  for (const id of [v5, v5 + '-medium', 'nai-diffusion-5-curated']) {
    assert.equal(supportsNaiVariety(model(id)), false);
    assert.equal(nativeRequest(novelaiProfile, { model: id, varietyPlus: true, skip_cfg_above_sigma: 123 }).body.parameters.skip_cfg_above_sigma, undefined);
  }
  const internal = { model: full, varietyPlus: true, skip_cfg_above_sigma: 123, width: 832, height: 1216 };
  assert.equal(supportsNaiVariety({ ...model(full), profileId: 'koma-standard-v1' }), false);
  assert.equal(toNativePayload(internal).parameters.skip_cfg_above_sigma, undefined);
  const standard = toStandardPayload(internal);
  assert.equal(standard.varietyPlus, undefined); assert.equal(standard.skip_cfg_above_sigma, undefined);
  assert.equal(nativeRequest(novelaiProfile, internal).body.parameters.skip_cfg_above_sigma, 58);
  assert.throws(() => nativeRequest(novelaiProfile, { model: full, varietyPlus: 'true' }), /Variety/);
  assert.throws(() => naiVarietySigma(full, true, undefined, 832), /尺寸/);
});

test('Variety+ round-trips through boards, snapshots, imports and ASK without reusing raw sigma', () => {
  assert.equal(DEFAULTS.varietyPlus, false);
  const form = { ...DEFAULTS, model: full, varietyPlus: true };
  const boards = { items: [{ id: 'b', form }], activeId: 'b' };
  assert.equal(readBoards({ boards }).items[0].form.varietyPlus, true);
  delete form.varietyPlus;
  assert.equal(readBoards({ boards }).items[0].form.varietyPlus, false);
  const params = collect({ ...DEFAULTS, model: full, varietyPlus: true }, model(full), 1);
  const snapshot = imageParameters(params);
  assert.equal(snapshot.varietyPlus, true);
  assert.equal(prepareDrawingFields(reuseFields({ params: snapshot }), [model(full)], samplers).changes.varietyPlus, true);
  assert.equal(reuseFields({ params: { skip_cfg_above_sigma: 58 } }).varietyPlus, true);
  assert.equal(readNaiSettings({ varietyPlus: false, skip_cfg_above_sigma: 58 }).varietyPlus, false);
  for (const sigma of [null, 0, -1, Infinity, NaN, '58']) assert.equal(readNaiSettings({ skip_cfg_above_sigma: sigma }).varietyPlus, false);
  assert.deepEqual(parseParameters({ varietyPlus: true }), { varietyPlus: true });
  assert.throws(() => parseParameters({ varietyPlus: 1 }));
  assert.equal(parameterIssue('varietyPlus', { ...DEFAULTS, model: full, varietyPlus: true }, model(full)), '');
  assert.match(parameterIssue('varietyPlus', { ...DEFAULTS, model: v5, varietyPlus: true }, model(v5)), /Variety/);
  assert.equal(parameterIssue('varietyPlus', { ...DEFAULTS, model: v5 }, model(v5)), '');
});
