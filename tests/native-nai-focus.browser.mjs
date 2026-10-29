import { test } from "node:test";
import assert from "node:assert/strict";

import { useNativeFixture, open, referencePosts, openEditorFixture, paintEditorMask, solidPng, drawEditorFocus, chooseInpaint } from "./helpers/native-fixture.mjs";

useNativeFixture();

test('Focused Inpaint: split entry preserves mask and rectangle, supports keyboard menus and closes with its workspace',async()=>{
  const t=await open('nai-official-v1',true,'',undefined,'',true),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await openEditorFixture(t,{model:'nai-diffusion-5-full',prompt:'synthetic'});
    assert.equal(await page.locator('.composer #editorFocus, .focus-control').count(),0);
    await chooseInpaint(page,false);
    assert.equal(await page.evaluate(()=>editor.session.mode),'inpaint');assert.equal(await page.evaluate(()=>editor.session.focus.on),false);
    await paintEditorMask(page);
    const maskBefore=await page.evaluate(()=>JSON.stringify(editor.session.mask));
    await page.locator('#editorInpaint').click();assert.equal(await page.evaluate(()=>editor.session.mode),'img2img');
    await chooseInpaint(page,true);
    assert.equal(await page.locator('#editorSelectFocus').getAttribute('aria-pressed'),'true');
    await drawEditorFocus(page);
    const rect=await page.evaluate(()=>({...editor.session.focus.rect}));
    assert.match(await page.locator('.focus-label').textContent(),/256×256 → 1024×1024/);
    await chooseInpaint(page,false);
    assert.equal(await page.locator('#editorSelectFocus').count(),0);
    assert.equal(await page.locator('#editorFocusRegion').isHidden(),true);
    assert.deepEqual(await page.evaluate(()=>editor.session.focus.rect),rect);
    assert.equal(await page.evaluate(()=>JSON.stringify(editor.session.mask)),maskBefore);
    await chooseInpaint(page,true);
    assert.equal(await page.locator('#editorSelectFocus').getAttribute('aria-pressed'),'false');
    await page.locator('#editorInpaint').click();assert.equal(await page.evaluate(()=>editor.session.mode),'img2img');
    await page.locator('#editorInpaint').click();assert.equal(await page.evaluate(()=>editor.snapshot().focusing),true);
    assert.deepEqual(await page.evaluate(()=>editor.session.focus.rect),rect);
    assert.equal(await page.locator('#editorSelectFocus').getAttribute('aria-pressed'),'false');
    await page.locator('#editorSelectFocus').click();
    await page.locator('#editorInpaintToggle').focus();await page.keyboard.press('ArrowDown');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-checked')==='true');
    await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'普通重绘');
    await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'聚焦重绘');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#editorInpaintMenu').isHidden(),true);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'editorInpaintToggle');
    assert.equal(await page.locator('#editorSelectFocus').getAttribute('aria-pressed'),'true');
    // Pointer dismissal and a second trigger click close instead of reopening the native popover.
    await page.locator('#editorInpaintToggle').click();await page.locator('#editorInpaintToggle').click();
    assert.equal(await page.locator('#editorInpaintMenu').isHidden(),true);
    await page.locator('#editorInpaintToggle').click();await page.getByRole('button',{name:'画笔',exact:true}).click();
    assert.equal(await page.locator('#editorInpaintMenu').isHidden(),true);
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});
      await page.waitForTimeout(100);
      await page.locator('#editorInpaintToggle').click();
      await page.locator('#editorInpaintMenu').waitFor({state:'visible'});
      assert.equal(await page.locator('#editorInpaintMenu .menu-item').count(),2);
      assert.equal(await page.locator('#editorInpaintMenu').isVisible(),true,`menu visible at ${width}`);
      assert.equal(await page.locator('#editorInpaintMenu').evaluate(el=>el.matches(':popover-open')),true,`menu remains open at ${width}`);
      await page.keyboard.press('Escape');
      await page.locator('.editor-info-meta').click();
    }
    const board=await page.evaluate(()=>editor.session.id);
    await page.locator('#editorInpaintToggle').click();await page.evaluate(()=>editor.createBoard());
    assert.equal(await page.locator('#editorInpaintMenu').isHidden(),true);
    await page.evaluate(id=>editor.switchBoard(id),board);
    await page.locator('#editorInpaintToggle').click();await page.evaluate(()=>location.hash='#/image');
    await page.locator('#imageEditor').waitFor({state:'hidden'});
    assert.equal(await page.locator('#editorInpaintMenu').isHidden(),true);
    await page.evaluate(()=>location.hash='#/edit');await page.locator('#imageEditor').waitFor();
    assert.deepEqual(await page.evaluate(()=>editor.session.focus.rect),rect);
    assert.equal(await page.evaluate(()=>JSON.stringify(editor.session.mask)),maskBefore);
    // A gateway still supports ordinary inpaint, but cannot silently accept the focused pipeline.
    await page.evaluate(async()=>{
      const next=structuredClone(services.connections.configuration);delete next.connections.test;delete next.links.test;
      await services.connections.save(next);
    });
    await page.waitForFunction(()=>!editor.snapshot().focusAvailable&&editor.snapshot().model?.connection==='primary');
    await page.locator('#editorInpaintToggle').click();
    assert.equal(await page.getByRole('menuitemradio',{name:'聚焦重绘',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('menuitemradio',{name:'普通重绘',exact:true}).isEnabled(),true);
    await page.getByRole('menuitemradio',{name:'普通重绘',exact:true}).click();
    assert.equal(await page.evaluate(()=>editor.session.focus.on),false);
    assert.deepEqual(await page.evaluate(()=>editor.session.focus.rect),rect);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('Focused Inpaint: manual mask and rectangle send only the enlarged crop, composite full-size pixels, preserve recipes and isolate boards',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account,'',true),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await openEditorFixture(t,{model:'nai-diffusion-5-full',prompt:'synthetic detail',seed:0,cfgRescale:.6,
      placement:'manual',localCharacters:[{id:'c1',on:true,prompt:'girl',negative:'hat',centers:[{x:.3,y:.7}]}]});
    await page.evaluate(()=>editor.setMode('inpaint'));await paintEditorMask(page);
    await chooseInpaint(page,true);
    assert.match(await page.evaluate(()=>editor.snapshot().warning),/框选/);
    assert.equal(await page.locator('#editorRun').isDisabled(),true);
    await page.evaluate(()=>editor.run());assert.equal(referencePosts(t).length,0);
    await drawEditorFocus(page);
    const plan=await page.evaluate(()=>editor.snapshot().session.focus.rect);
    assert.deepEqual(plan,{x:128,y:128,width:256,height:256});
    account.generatedImage=await solidPng(page,1024,1024);
    await page.locator('#editorRun').click();
    await page.waitForFunction(()=>!editor.snapshot().busy&&!editor.snapshot().preparing&&editor.snapshot().session.versions.length===2);
    assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
    const wire=JSON.parse(referencePosts(t).at(-1).body);
    assert.equal(referencePosts(t).length,1);assert.equal(wire.action,'infill');assert.equal(wire.model,'nai-diffusion-5-full-inpainting');
    assert.equal(referencePosts(t).at(-1).path,'/ai/generate-image');
    assert.equal(wire.parameters.width,1024);assert.equal(wire.parameters.height,1024);assert.equal(wire.parameters.seed,0);
    assert.equal(JSON.stringify(wire).includes('inpaintFocus'),false);
    assert.deepEqual(wire.parameters.v4_prompt.caption.char_captions[0].centers,[{x:.09999999999999998,y:.8999999999999999}]);
    const pixels=await page.evaluate(async()=>{
      const v=editor.snapshot().viewed,bitmap=await createImageBitmap(v.blob),c=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
      return {width:c.width,height:c.height,outside:[...ctx.getImageData(0,0,1,1).data],inside:[...ctx.getImageData(256,256,1,1).data],context:[...ctx.getImageData(140,140,1,1).data],params:v.params,record:editor.record(editor.snapshot().viewed.recordId).params};
    });
    assert.equal(pixels.width,512);assert.equal(pixels.height,512);assert.deepEqual(pixels.outside,[80,65,124,255]);
    assert.deepEqual(pixels.inside,[224,64,80,255]);assert.deepEqual(pixels.context,[196,182,255,255]);
    assert.equal(pixels.params.width,512);assert.equal(pixels.params.height,512);assert.equal(pixels.params.inpaintFocus.targetWidth,1024);
    assert.deepEqual(pixels.params.localCharacters[0].centers,[{x:.3,y:.7}]);assert.deepEqual(pixels.record.inpaintFocus,pixels.params.inpaintFocus);
    for(const key of ['init_image','mask_image','focusOriginal'])assert.equal(key in pixels.params,false);
    const board=await page.evaluate(()=>editor.snapshot().session.id);
    await page.evaluate(()=>editor.setBase(editor.snapshot().viewed.id));
    assert.deepEqual(await page.evaluate(()=>editor.snapshot().session.focus.rect),plan);
    assert.equal(await page.locator('#editorRun').isEnabled(),true);
    await page.evaluate(async()=>{const b=editor.session.versions[0].blob;await editor.addSource(b,'independent.png');});
    assert.equal(await page.evaluate(()=>editor.snapshot().session.focus.on),false);
    await page.evaluate(id=>editor.switchBoard(id),board);
    assert.deepEqual(await page.evaluate(()=>editor.snapshot().session.focus.rect),plan);
    // Switching dimensions clears only the focus/mask geometry, then returning does not resurrect it.
    await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=640;c.height=512;const blob=await new Promise(r=>c.toBlob(r));
      const start=editor.beginExternalEdit();await editor.applyExternalEdit(start.id,{mode:'image',image:blob});});
    assert.equal(await page.evaluate(()=>editor.snapshot().session.focus.rect),null);
    await page.evaluate(()=>editor.setBase(1));assert.equal(await page.evaluate(()=>editor.snapshot().session.focus.rect),null);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test("Focused Inpaint: rectangle gestures commit once, move/resize, cancel cleanly, survive pause and use compact",async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await openEditorFixture(t,{model:'nai-diffusion-5-full',prompt:'synthetic'});
    await page.evaluate(()=>editor.setMode('inpaint'));await paintEditorMask(page);await chooseInpaint(page,true);
    // Account refresh is independent of pointer gestures; finish it before counting.
    await page.waitForFunction(()=>!!editor.snapshot().quota && editor.snapshot().warning.includes('框选') && !['idle','loading'].includes(drawing.snapshot().quote.status));
    await page.evaluate(()=>{window.focusEvents=0;window.stopFocusCount=editor.subscribe(()=>window.focusEvents++);});
    const host=page.locator('#editorFocusRegion'),box=await host.boundingBox();
    await page.mouse.move(box.x+box.width*.25,box.y+box.height*.25);await page.mouse.down();
    await page.mouse.move(box.x+box.width*.75,box.y+box.height*.75,{steps:30});
    assert.equal(await page.evaluate(()=>window.focusEvents),0);assert.equal(await page.evaluate(()=>editor.session.focus.rect),null);
    await page.mouse.up();assert.ok(await page.evaluate(()=>window.focusEvents)<=3);
    const rect=await page.evaluate(()=>editor.session.focus.rect);assert.deepEqual(rect,{x:128,y:128,width:256,height:256});
    const current=await page.locator('.focus-box').boundingBox();
    await page.mouse.move(current.x+current.width/2,current.y+current.height/2);await page.mouse.down();
    await page.mouse.move(current.x+current.width/2+box.width/16,current.y+current.height/2,{steps:10});await page.mouse.up();
    assert.equal(await page.evaluate(()=>editor.session.focus.rect.x),160);
    const corner=await page.locator('.focus-handle[data-corner=se]').boundingBox();
    await page.mouse.move(corner.x+corner.width/2,corner.y+corner.height/2);await page.mouse.down();
    await page.mouse.move(corner.x+corner.width/2+box.width/16,corner.y+corner.height/2+box.height/16,{steps:10});await page.mouse.up();
    const resized=await page.evaluate(()=>editor.session.focus.rect);assert.ok(resized.width>256);assert.ok(resized.height>256);
    await page.locator('.focus-box').focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>editor.session.focus.rect.x),152);
    const before=await page.evaluate(()=>({...editor.session.focus.rect}));
    await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();await page.mouse.move(box.x+box.width*.2,box.y+box.height*.2,{steps:5});
    await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await page.evaluate(()=>editor.session.focus.rect),before);
    await page.locator('#editorSelectFocus').click();await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();await page.mouse.move(box.x+30,box.y+30);
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();assert.deepEqual(await page.evaluate(()=>editor.session.focus.rect),before);
    await page.getByRole('button',{name:'画笔',exact:true}).click();
    await page.waitForFunction(()=>editor.snapshot().edit.canRun);
    assert.equal(await page.locator('#editorRun').isEnabled(),true);
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});await page.waitForTimeout(100);
      assert.ok(await page.locator('#editorSelectFocus').isVisible());

    }
    await page.evaluate(()=>{stopFocusCount();location.hash='#/image';});await page.locator('#imageEditor').waitFor({state:'hidden'});
    await page.evaluate(()=>location.hash='#/edit');await host.waitFor();assert.deepEqual(await page.evaluate(()=>editor.session.focus.rect),before);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('Focused Inpaint: outside coverage, empty masks, failure, cancel and wrong-size output never save or retry',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account),{page}=t;let release;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await openEditorFixture(t,{model:'nai-diffusion-4-5-full',prompt:'synthetic'});
    await page.evaluate(()=>{editor.setMode('inpaint');editor.setFocus(true);editor.setFocusRect({x:128,y:128,width:256,height:256});});
    await page.evaluate(()=>editor.run());assert.equal(referencePosts(t).length,0);
    await paintEditorMask(page);
    await page.evaluate(()=>editor.setFocusRect({x:0,y:0,width:128,height:128}));await page.evaluate(()=>editor.run());
    assert.match(await page.evaluate(()=>editor.snapshot().edit.error),/全部蒙版/);assert.equal(referencePosts(t).length,0);
    await page.evaluate(()=>editor.setFocusRect({x:128,y:128,width:256,height:256}));
    account.generatedImage=await solidPng(page,512,512);await page.evaluate(()=>editor.run());
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/聚焦.*尺寸/);assert.equal(await page.evaluate(()=>editor.session.versions.length),1);
    account.generationStatus=500;await page.evaluate(()=>editor.run());assert.equal(await page.evaluate(()=>editor.session.versions.length),1);
    account.generationStatus=0;account.generatedImage=await solidPng(page,1024,1024);
    let arrived;const entered=new Promise(r=>arrived=r);account.onGenerate=async()=>{arrived();await new Promise(r=>release=r);};
    const pending=page.evaluate(()=>editor.run());await entered;await page.evaluate(()=>editor.cancel());release();await pending;
    assert.equal(await page.evaluate(()=>editor.session.versions.length),1);assert.equal(referencePosts(t).length,3);
    assert.deepEqual(t.errors,[]);
  } finally {release?.();await t.context.close();}
});
