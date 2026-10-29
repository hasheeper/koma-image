import { test } from "node:test";
import assert from "node:assert/strict";

import { useNativeFixture, open, referencePosts, openEditorFixture, solidPng } from "./helpers/native-fixture.mjs";

useNativeFixture();

test("Enhance: compact official controls, exact output, fresh Seed, recipe/history", async () => {
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account,'',true),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await openEditorFixture(t,{model:'nai-diffusion-4-5-full',prompt:'girl, Text:hello',negative_prompt:'watermark',seed:0,steps:31,cfgRescale:.3,noiseSchedule:'exponential'});
    await page.evaluate(()=>{editor.setNumber('strength',.33);editor.setNumber('noise',.04);});
    assert.equal(referencePosts(t).length,0);
    await page.locator('.enhance-toggle').click();
    assert.equal(await page.evaluate(()=>editor.snapshot().model.profileId),'nai-official-v1');
    assert.equal(await page.locator('#editorEnhance').isChecked(),true);
    assert.match(await page.locator('#editorRun').textContent(),/Enhance/);
    await page.locator('#editorEnhanceScale').selectOption('1.5');
    await page.locator('#editorEnhanceMagnitude').selectOption('5');
    assert.equal(await page.locator('#editorStrength').inputValue(),'0.7');
    await page.locator('#editor-parametersToggle').click();
    assert.equal(await page.locator('#editorSeed').isDisabled(),true);
    assert.equal(await page.locator('#editorSeed').inputValue(),'');
    assert.equal(await page.locator('#editorNoise').inputValue(),'0.1');
    await page.evaluate(()=>editor.setNumber('noise',.08));
    assert.equal(await page.locator('#editorEnhanceMagnitude').inputValue(),'0');
    await page.locator('#editor-parametersToggle').click();
    await page.locator('#editorEnhanceMagnitude').selectOption('5');
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});
      await page.locator('.enhance-control').scrollIntoViewIfNeeded();

    }
    account.generatedImage=await solidPng(page,768,768);
    await page.evaluate(()=>editor.run());
    assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
    const post=referencePosts(t).at(-1),wire=JSON.parse(post.body);
    assert.equal(new URL(post.url).hostname,'image.novelai.net');
    assert.equal(wire.action,'img2img');assert.equal(wire.parameters.width,768);assert.equal(wire.parameters.height,768);
    assert.equal(wire.parameters.strength,.7);assert.equal(wire.parameters.noise,.1);
    assert.equal(wire.parameters.noise_schedule,'exponential');assert.equal(wire.parameters.steps,31);
    assert.equal(wire.parameters.upscaled_enhance,undefined);assert.equal(wire.parameters.enhance,undefined);
    assert.match(wire.input,/-2::upscaled, blurry::,Text:hello$/);
    const result=await page.evaluate(()=>({params:editor.snapshot().viewed.params,width:editor.snapshot().viewed.width,record:editor.record(editor.snapshot().viewed.recordId).params,seed:editor.session.fields.seed}));
    assert.equal(result.width,768);assert.equal(result.params.enhance,true);assert.equal(result.params.enhanceScale,1.5);assert.equal(result.params.enhanceMagnitude,5);
    assert.equal(result.params.basePrompt,'girl, Text:hello');assert.equal(result.params.seed,wire.parameters.seed);assert.equal(result.params.randomSeed,true);
    assert.equal(result.record.enhance,true);assert.equal(result.seed,'0');
    assert.match(await page.locator('.editor-info-meta b').textContent(),/Enhance/);
    assert.equal(t.requests.some(r=>r.path.endsWith('/tools/run')),false);
    const board=await page.evaluate(()=>editor.session.id);
    await page.evaluate(()=>editor.createBoard());
    assert.equal(await page.evaluate(()=>editor.session.enhance.on),false);
    await page.evaluate(id=>editor.switchBoard(id),board);
    assert.equal(await page.locator('#editorEnhance').isChecked(),true);
    assert.equal(await page.locator('#editorEnhanceScale').inputValue(),'1.5');
    await page.evaluate(()=>{editor.setMode('inpaint');});
    assert.equal(await page.locator('#editorEnhance').count(),0);
    await page.evaluate(()=>editor.setMode('img2img'));
    assert.equal(await page.locator('#editorEnhance').isChecked(),true);
    await page.locator('.enhance-toggle').click();
    assert.equal(await page.locator('#editorStrength').inputValue(),'0.33');
    await page.locator('#editor-parametersToggle').click();
    assert.equal(await page.locator('#editorNoise').inputValue(),'0.04');assert.equal(await page.locator('#editorSeed').inputValue(),'0');
    assert.equal(await page.locator('#editorSeed').isDisabled(),false);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('Enhance: failure, wrong dimensions, cancellation and exhausted official sources cannot create results or fall back', async () => {
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account,'',true),{page}=t;
  let release;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await openEditorFixture(t,{model:'nai-diffusion-5-full-medium',prompt:'synthetic',seed:0});
    await page.evaluate(()=>{editor.setEnhance(true);editor.setEnhanceScale(1);editor.setEnhanceMagnitude(1);});
    account.generationStatus=500;
    await page.evaluate(()=>editor.run());
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/Synthetic generation failure/);
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/generate-image').length,1);
    assert.equal(await page.evaluate(()=>editor.session.versions.length),1);
    account.generationStatus=0;account.generatedImage=await solidPng(page,256,256);
    await page.evaluate(()=>editor.run());
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/尺寸/);
    assert.equal(await page.evaluate(()=>editor.session.versions.length),1);
    account.generatedImage=await solidPng(page,512,512);
    await page.evaluate(()=>editor.run());
    assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
    let wire=JSON.parse(referencePosts(t).at(-1).body);
    assert.equal(wire.parameters.steps,14);assert.equal(wire.parameters.sampler,'k_euler_ancestral');assert.equal(wire.parameters.cfg_rescale,undefined);
    assert.equal(await page.evaluate(()=>editor.snapshot().viewed.params.enhanceScale),1);
    const count=await page.evaluate(()=>editor.session.versions.length);
    const held=new Promise(resolve=>{release=resolve;});
    await page.route('https://image.novelai.net/ai/generate-image',async route=>{await held;await route.abort().catch(()=>{});});
    await page.locator('#editorRun').click();await page.waitForFunction(()=>editor.snapshot().busy);
    await page.locator('#editorStop').click();await page.waitForFunction(()=>!editor.snapshot().busy);
    release();await page.unroute('https://image.novelai.net/ai/generate-image');
    assert.equal(await page.evaluate(()=>editor.session.versions.length),count);
    account.body.trainingStepsLeft.fixedTrainingStepsLeft=0;account.body.usage={percent:0,purchasedPercent:0,isNegative:true};
    // The gateway advertises Full: its presence must still not allow a downgrade.
    await page.evaluate(()=>editor.setModel('nai-diffusion-5-full'));
    const before=referencePosts(t).length;
    await page.evaluate(()=>editor.run());
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/不足/);
    assert.equal(referencePosts(t).length,before);
    assert.equal(t.requests.some(r=>r.path.endsWith('/tools/run')),false);
    assert.deepEqual(t.errors,[]);
  } finally {release?.();await t.context.close();}
});

test('Enhance Max: V5 capability, server flag, non-aligned output, model changes and preserved history', async () => {
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account,'',true),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    t.png=await solidPng(page,832,1216);
    await openEditorFixture(t,{model:'nai-diffusion-5-full',prompt:'girl, Text:hello',negative_prompt:'watermark',seed:0});
    await page.locator('.enhance-toggle').click();
    await page.locator('#editorEnhanceScale').selectOption('max');
    await page.locator('#editorEnhanceMagnitude').selectOption('4');
    assert.match(await page.locator('.enhance-options output').textContent(),/1467×2144/);
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});
      await page.locator('.enhance-control').scrollIntoViewIfNeeded();
      // ResizeObserver and font layout can settle after Playwright's scroll step.
    }
    // A request-sized response must not be mistaken for the actual Max output.
    account.generatedImage=t.png;
    await page.evaluate(()=>editor.run());
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/尺寸/);
    assert.equal(await page.evaluate(()=>editor.session.versions.length),1);
    account.generatedImage=await solidPng(page,1467,2144);
    await page.evaluate(()=>editor.run());
    assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
    let wire=JSON.parse(referencePosts(t).at(-1).body);
    assert.equal(wire.model,'nai-diffusion-5-full');assert.equal(wire.action,'img2img');
    assert.equal(wire.parameters.upscaled_enhance,true);
    assert.equal(wire.parameters.width,832);assert.equal(wire.parameters.height,1216);
    assert.equal(wire.parameters.image,t.png.toString('base64'));
    assert.equal(wire.parameters.strength,.6);assert.equal(wire.parameters.noise,0);
    assert.equal(wire.input,'girl, Text:hello');assert.equal(wire.parameters.v4_prompt.caption.base_caption,wire.input);
    const result=await page.evaluate(()=>({params:editor.snapshot().viewed.params,width:editor.snapshot().viewed.width,height:editor.snapshot().viewed.height,record:editor.record(editor.snapshot().viewed.recordId).params}));
    assert.equal(result.width,1467);assert.equal(result.height,2144);
    assert.equal(result.params.width,1467);assert.equal(result.params.height,2144);
    assert.equal(result.params.enhanceScale,'max');assert.equal(result.params.enhanceMagnitude,4);
    assert.equal(result.record.enhanceScale,'max');assert.equal(result.record.seed,wire.parameters.seed);
    assert.equal(result.params.basePrompt,'girl, Text:hello');
    assert.match(await page.locator('.editor-info-meta b').textContent(),/Enhance Max/);
    const board=await page.evaluate(()=>editor.session.id);
    await page.evaluate(()=>editor.createBoard());
    assert.equal(await page.evaluate(()=>editor.session.enhance.on),false);
    await page.evaluate(id=>editor.switchBoard(id),board);
    assert.equal(await page.locator('#editorEnhanceScale').inputValue(),'max');
    await page.evaluate(()=>editor.setModel('nai-diffusion-4-5-full'));
    assert.equal(await page.locator('#editorEnhanceScale option[value=max]').isDisabled(),true);
    assert.equal(await page.locator('#editorRun').isDisabled(),true);
    const posts=referencePosts(t).length;
    await page.evaluate(()=>editor.run());
    assert.equal(referencePosts(t).length,posts);
    assert.equal(await page.evaluate(()=>editor.session.enhance.scale),'max');
    await page.evaluate(()=>editor.setModel('nai-diffusion-5-full-medium'));
    assert.equal(await page.locator('#editorEnhanceScale option[value=max]').isDisabled(),false);
    await page.evaluate(()=>editor.run());
    assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
    wire=JSON.parse(referencePosts(t).at(-1).body);
    assert.equal(wire.parameters.upscaled_enhance,true);assert.equal(wire.parameters.steps,14);
    assert.equal(wire.parameters.sampler,'k_euler_ancestral');assert.equal(wire.parameters.cfg_rescale,undefined);
    assert.equal(wire.input,'girl, Text:hello');
    assert.equal(t.requests.some(r=>r.path.endsWith('/tools/run')),false);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});
