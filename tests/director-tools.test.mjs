import test from 'node:test';
import assert from 'node:assert/strict';
import { directorTools, directorEmotions, directorSize, directorRequest, directorCost } from '../src/domain/director-tools.ts';
import { nativeRequest } from '../src/gateway/native-protocols.ts';
import { novelaiProfile, standardProfile } from '../src/gateway/profile.ts';
import { toStandardPayload } from '../src/gateway/routes.ts';
import { supportsSourcePayload, insufficientFunds } from '../src/domain/source-funding.ts';
import { imageParameters, sourceRecipe } from '../src/domain/image-parameters.ts';
import { naiCost } from '../src/domain/nai-cost.ts';
function png(width = 1024, height = 1024) {
  const b = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a0000000d49484452','hex').copy(b); b.writeUInt32BE(width,16); b.writeUInt32BE(height,20);
  return 'data:image/png;base64,' + b.toString('base64');
}
const model = { id:'nai-diffusion-5-full-medium', profileId:novelaiProfile.id, tools:['director'] };
const request = (directorTool = 'bg-removal') => ({ model:model.id, tool:'director', directorTool, init_image:png(), width:1024, height:1024, defry:0, emotion:'neutral', prompt:'' });
test('Director has six independent operations and never sends ordinary model parameters', () => {
  for (const {id} of directorTools) {
    const payload = { ...request(id), seed:42, scale:7, steps:50, cfg_rescale:.7, max_cost:88, negative_prompt:'bad', characters:[{prompt:'girl'}] };
    const {path, body,native}=nativeRequest(novelaiProfile,payload);
    assert.equal(path,'/ai/augment-image'); assert.equal(native,true);
    assert.deepEqual(Object.keys(body).sort(), ['width','height','image','req_type',...(['colorize','emotion'].includes(id)?['defry','prompt']:[])].sort());
    assert.equal(body.req_type,id); assert.equal(body.image,png().split(',')[1]);
    assert.throws(()=>toStandardPayload(payload),/官方/);
    assert.equal(supportsSourcePayload({...model,profileId:standardProfile.id},payload),false);
    assert.equal(supportsSourcePayload(model,payload),true);
  }
});
test('all 24 Emotion choices and six reverse intensity levels map to prompt;;extra and integer defry', () => {
  for (const [emotion] of directorEmotions) for (let defry=0; defry<=5; defry++) {
    assert.deepEqual(directorRequest({...request('emotion'),emotion,defry,prompt:'blue eyes'}), {req_type:'emotion',width:1024,height:1024,image:png().split(',')[1],prompt:emotion+';;blue eyes',defry});
  }
  for (const defry of [-1,6,.5,NaN,'2']) assert.throws(()=>directorRequest({...request('colorize'),defry}),/强度/);
  assert.throws(()=>directorRequest({...request('emotion'),emotion:'made-up'}),/表情/);
  for (const patch of [{mask_image:png()},{additional_images:[png()]},{enhance:true},{width:1023},{directorTool:'pixel-snap'},{prompt:'a'.repeat(24001)}])
    assert.throws(()=>directorRequest({...request('emotion'),...patch}));
});
test('tool preparation follows official whole-image resizing without generation alignment rules', () => {
  assert.deepEqual(directorSize({width:512,height:512}),{width:1024,height:1024});
  assert.deepEqual(directorSize({width:832,height:1216}),{width:832,height:1216});
  assert.deepEqual(directorSize({width:1501,height:1001}),{width:1501,height:1001});
  const large=directorSize({width:4000,height:3000}); assert.ok(large.width*large.height<=3143728);
  assert.throws(()=>directorSize({width:1,height:40000000}));
  assert.throws(()=>directorSize({width:0,height:1}));
});
test('tool prices use 28-step V3 pricing; BG always costs three outputs plus five, no V5 entitlement', () => {
  const active={active:true,tier:3,usage:{isNegative:true,percent:0}};
  assert.equal(directorCost(request(),active).cost,65);
  assert.equal(naiCost(request('lineart'),active).cost,0);
  assert.equal(naiCost(request('lineart'),{active:false,tier:0}).cost,20);
  assert.equal(directorCost(request('lineart'),null),null);
  const quota={profile:novelaiProfile,media:{credits:{remaining:0},subscription:active}};
  assert.match(insufficientFunds(model,quota,directorCost(request(),active),request()),/Anlas/);
  assert.equal(insufficientFunds(model,quota,directorCost(request('lineart'),active),request('lineart')),null);
});
test('Director history preserves actual tool details plus a separate source recipe without image data or invented seed', () => {
  const params=imageParameters({tool:'director',directorTool:'emotion',directorGroup:'group',directorVariant:'blend',defry:4,emotion:'happy',prompt:'blue eyes',width:1024,height:1024,
    editId:'edit',sourceRecipe:{model:'nai-diffusion-4-5-full',basePrompt:'original',seed:7,cfgRescale:.5},init_image:png(),image:'secret',api_key:'secret'});
  assert.equal(params.directorTool,'emotion');assert.equal(params.defry,4);assert.equal(params.seed,undefined);
  assert.equal(sourceRecipe(params).basePrompt,'original');assert.equal(sourceRecipe(params).seed,7);
  assert.equal(params.init_image,undefined);assert.equal(params.api_key,undefined);
});
