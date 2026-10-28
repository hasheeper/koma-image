import test from 'node:test';
import assert from 'node:assert/strict';
import { inpaintFocusPlan, snapFocusRect, readInpaintFocus, supportsFocusedInpaint, focusedCharacters, focusContains } from '../src/domain/inpaint-focus.ts';
import { buildEditorPayload } from '../src/domain/media.ts';
import { nativeRequest } from '../src/gateway/native-protocols.ts';
import { novelaiProfile } from '../src/gateway/profile.ts';
import { toStandardPayload, toNativePayload } from '../src/gateway/routes.ts';
import { supportsSourcePayload } from '../src/domain/source-funding.ts';
import { imageParameters } from '../src/domain/image-parameters.ts';
const ids = ['nai-diffusion-4-5-full','nai-diffusion-4-5-curated','nai-diffusion-5-full','nai-diffusion-5-full-medium'];
const model = id => ({id, upstreamId:id,profileId:novelaiProfile.id,provider:'novelai',tools:['img2img','inpaint'],operations:['generate','edit'],maxPixels:3145728,sourceMaxPixels:3145728,maxImages:1});
function png(width=1024,height=1024) {
  const h=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a0000000d49484452','hex').copy(h);h.writeUInt32BE(width,16);h.writeUInt32BE(height,20);
  return 'data:image/png;base64,'+h.toString('base64');
}
const focus=inpaintFocusPlan({width:512,height:512},{x:128,y:128,width:256,height:256});

test('focus geometry follows the official 1/8 selection and approximately 1MP sizing',()=>{
  assert.deepEqual(focus,{x:128,y:128,width:256,height:256,sourceWidth:512,sourceHeight:512,targetWidth:1024,targetHeight:1024});
  assert.deepEqual(snapFocusRect({width:512,height:512},{x:129,y:131,width:251,height:250}),{x:128,y:128,width:256,height:256});
  assert.deepEqual(snapFocusRect({width:512,height:512},{x:-9,y:500,width:60,height:80}),{x:0,y:496,width:56,height:16});
  const large=inpaintFocusPlan({width:1536,height:1536},{x:0,y:0,width:1032,height:904});
  assert.equal(large.targetWidth,1024);assert.equal(large.targetHeight,896);
  assert.equal(focusContains(focus,{x:200,y:200,width:10,height:10}),true);
  assert.equal(focusContains(focus,{x:120,y:200,width:10,height:10}),false);
  for(const rect of [{...focus,x:129},{...focus,width:512},{...focus,height:0},{...focus,x:NaN}]) assert.equal(readInpaintFocus(rect),null);
  assert.equal(readInpaintFocus({...focus,targetWidth:768}),null);
  assert.deepEqual(readInpaintFocus({...focus,secret:'omitted'}),focus);
  assert.throws(()=>inpaintFocusPlan({width:513,height:512},focus),/64/);
  assert.throws(()=>inpaintFocusPlan({width:1024,height:3072},{x:0,y:0,width:8,height:3072}),/狭长/);
});

test('four exact official sources send prepared images through ordinary infill without a focus API flag',()=>{
  for(const id of ids) {
    const m=model(id);assert.equal(supportsFocusedInpaint(m),true);
    const payload=buildEditorPayload('inpaint',m,{png:png()},{inpaintFocus:focus,prompt:'synthetic',seed:0,strength:.5,cfgRescale:.3},png());
    const {path,body}=nativeRequest(novelaiProfile,payload);
    assert.equal(path,'/ai/generate-image');assert.equal(body.action,'infill');assert.equal(body.model,id+'-inpainting');
    assert.equal(body.parameters.width,1024);assert.equal(body.parameters.height,1024);assert.equal(body.parameters.img2img.strength,.5);
    assert.equal(body.parameters.seed,0);assert.equal(body.parameters.add_original_image,false);
    assert.equal(JSON.stringify(body).includes('inpaintFocus'),false);assert.equal(body.parameters.zoomArea,undefined);
    assert.equal(supportsSourcePayload(m,payload),true);
    const saved=imageParameters({...payload,width:512,height:512,basePrompt:'raw'});
    assert.deepEqual(saved.inpaintFocus,focus);assert.equal(saved.init_image,undefined);assert.equal(saved.mask_image,undefined);
    assert.equal(supportsSourcePayload({...m,profileId:'koma-standard-v1'},payload),false);
    assert.throws(()=>toStandardPayload(payload),/官方/);assert.throws(()=>toNativePayload(payload),/官方/);
    for(const patch of [{inpaintFocus:{...focus,targetWidth:768}},{tool:'img2img'},{tool:'upscale'},{init_image:png(512,512)},{enhance:true}])
      assert.throws(()=>nativeRequest(novelaiProfile,{...payload,...patch}),/聚焦|Enhance/);
  }
});

test('focus cannot be silently lost on unsupported models, aliases, tools or mismatched source sizes',()=>{
  const m=model(ids[0]);
  for(const bad of [{...m,profileId:'koma-standard-v1'},{...m,upstreamId:'alias'},model('nai-diffusion-5-curated'),{...m,tools:['img2img']}]) {
    assert.equal(supportsFocusedInpaint(bad),false);
    assert.throws(()=>buildEditorPayload('inpaint',bad,{png:png()},{inpaintFocus:focus},png()),/聚焦|请选择/);
  }
  assert.throws(()=>buildEditorPayload('img2img',m,{png:png()},{inpaintFocus:focus}),/聚焦/);
  assert.throws(()=>buildEditorPayload('inpaint',m,{png:png(512,512)},{inpaintFocus:focus},png(512,512)),/聚焦/);
});

test('role centers transform after full-canvas positioning, leaving the original recipe unchanged',()=>{
  const roles=[{id:'c1',on:true,prompt:'girl',negative:'hat',centers:[{x:.3,y:.7},{x:0,y:1}]}], original=structuredClone(roles);
  const mapped=focusedCharacters(roles,focus);assert.deepEqual(mapped[0].centers,[{x:.09999999999999998,y:.8999999999999999},{x:0,y:1}]);assert.deepEqual(roles,original);
  const m=model(ids[0]),payload={...buildEditorPayload('inpaint',m,{png:png()},{inpaintFocus:focus},png()),characters:[roles[0]],placement:'manual'};
  const centers=nativeRequest(novelaiProfile,payload).body.parameters.v4_prompt.caption.char_captions[0].centers;
  assert.ok(Math.abs(centers[0].x-.1)<1e-10);assert.ok(Math.abs(centers[0].y-.9)<1e-10);assert.deepEqual(roles,original);
});
