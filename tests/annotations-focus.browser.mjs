import {test} from 'node:test';
import assert from 'node:assert/strict';
import {useNativeFixture,open,openEditorFixture} from './helpers/native-fixture.mjs';
useNativeFixture();
test('annotation geometry feeds existing NAI focused mask and 8px crop without changing its native pipeline',async()=>{
 const t=await open('nai-official-v1');try{
  await openEditorFixture(t,{model:'nai-diffusion-4-5-full'});
  const result=await t.page.evaluate(async()=>{
   const v=editor.snapshot().base,s=editor.session;
   const snapshot={image:{tag:'#e1',entity_key:v.entity_key,record_id:v.recordId,scope:{kind:'page',id:'test'}},width:v.width,height:v.height,edges:{dilate:.006,feather:.003},regions:[{key:'r1',shape:'ellipse',bbox:{x:.251,y:.251,w:.24,h:.24},comment:'blue eye'}]};
   await editor.applyAnnotations({boardId:s.id,versionId:v.id},snapshot,false,true);
   const {maskStateBitmap}=await import('/src/native/photopea-input.ts');const bitmap=await maskStateBitmap(s.mask);
   return {on:s.focus.on,rect:s.focus.rect,mode:s.mode,covered:bitmap.bits.some(b=>b>0),chosen:s.chosen.inpaint,base:s.baseId,source:v.id};
  });assert.equal(result.on,true);assert.equal(result.mode,'inpaint');assert.equal(result.covered,true);assert.equal(result.base,result.source);assert.equal(result.chosen,'nai-diffusion-4-5-full');for(const value of Object.values(result.rect))assert.equal(value%8,0);assert.deepEqual(t.errors,[]);
 }finally{await t.context.close();}
});
