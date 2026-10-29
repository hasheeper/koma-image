import { test } from "node:test";
import assert from "node:assert/strict";

import { useNativeFixture, open, chooseNai, addReference, referencePosts, openEditorFixture, paintEditorMask, solidPng } from "./helpers/native-fixture.mjs";

useNativeFixture();

test("EDIT alignment: raw presets, actual random/zero seed, role editing and position ownership, result round-trip", async () => {
  for (const gateway of [false,true]) {
    const t=await open('nai-official-v1',true,'',undefined,'',gateway),{page}=t;
    const edits=()=>t.requests.filter(r=>r.method==='POST' && /(?:tools\/run|ai\/generate-image)$/.test(r.path));
    try {
      await page.waitForFunction(()=>drawing.snapshot().model);
      await page.evaluate(()=>drawing.patch({prompt:'drawing stays unchanged',tagSuggest:false}));
      await openEditorFixture(t,{
        model:'nai-diffusion-5-full',basePrompt:'wolf, Text: "Hello"',prompt:'obsolete expanded tags',
        baseNegative:'custom negative',negative_prompt:'obsolete negative tags',naiMode:'furry',complexity:'ultra',qualityPreset:'light',negativePreset:'human',transparentBg:true,
        scale:5.5,cfgRescale:.65,steps:31,seed:-1,sampler:'k_euler',
        localCharacters:[{id:'c3',on:true,prompt:'1girl, red coat',negative:'hat',centers:[{x:.31,y:.61}]},{id:'c8',on:false,prompt:'1boy, blue coat',negative:'cloak',centers:[{x:.72,y:.42}]}],placement:'manual',
      });
      const root=page.locator('#imageEditor');
      assert.equal(await page.locator('#editorPrompt').inputValue(),'wolf, Text: "Hello"');
      assert.equal(await page.locator('#editor-qualityPreset').getAttribute('data-value'),'light');
      assert.equal(await page.locator('#editor-effort input[value=medium]').isDisabled(),false);
      await root.getByRole('button',{name:'添加角色',exact:true}).click();
      await page.locator('#editor-char-c9-prompt').fill('1girl, green coat');
      await root.getByRole('button',{name:'删除角色 3',exact:true}).click();
      await root.getByRole('button',{name:'添加角色',exact:true}).click();
      await page.locator('#editor-char-c10-prompt').fill('1girl, green coat');
      await root.locator('[data-character-id=c10] .mc-switch').click();
      assert.equal(await root.getByRole('switch',{name:'发送角色 3',exact:true}).isChecked(),false);
      await root.getByRole('button',{name:'在画面上调整',exact:true}).click();
      assert.equal(await page.locator('#editorPositionLayer .mc-stage').isVisible(),true);
      await page.locator('#editorPositionLayer').getByRole('button',{name:'完成',exact:true}).click();
      await page.locator('#editor-parametersToggle').click();
      assert.equal(await page.locator('#editorSeed').inputValue(),'');
      await page.locator('#editor-parametersToggle').click();
      {
      const width = 1440;
        await page.setViewportSize({width,height:900});
        await page.locator('#editorModel').scrollIntoViewIfNeeded();
        }
      await page.setViewportSize({width:1440,height:900});
      await page.waitForFunction(()=>editor.snapshot().edit.canRun);
      await page.evaluate(()=>editor.run());
      assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
      let raw=JSON.parse(edits().at(-1).body),wire=gateway?raw:raw.parameters;
      assert.equal(gateway?raw.prompt:raw.input,'fur dataset, transparent background, wolf, ultra complexity, very aesthetic, amazing quality, no text, Text: "Hello"');
      assert.match(wire.negative_prompt,/^custom negative, lowres/);
      assert.ok(Number.isInteger(wire.seed)&&wire.seed>=0&&wire.seed<=4294967295);
      const params=await page.evaluate(()=>editor.session.versions.at(-1).params);
      assert.equal(params.seed,wire.seed); assert.equal(params.randomSeed,true);
      assert.equal(params.basePrompt,'wolf, Text: "Hello"'); assert.equal(params.baseNegative,'custom negative');
      assert.equal(params.localCharacters.length,3); assert.equal(params.localCharacters[2].id,'c10');
      assert.equal(params.qualityPreset,'light'); assert.equal(params.complexity,'ultra'); assert.equal(params.naiMode,'furry'); assert.equal(params.transparentBg,true);
      assert.equal(gateway?wire.characters.length:wire.v4_prompt.caption.char_captions.length,1);
      assert.equal(await page.evaluate(()=>drawing.snapshot().form.prompt),'drawing stays unchanged');
      await page.evaluate(async()=>{ const v=editor.snapshot().viewed; await editor.open('image',v.blob,v.name,{settings:v.params}); });
      assert.equal(await page.locator('#editorPrompt').inputValue(),'wolf, Text: "Hello"');
      await page.evaluate(()=>editor.patch({qualityPreset:'none',complexity:'none',negativePreset:'none',transparentBg:false,naiMode:'anime',seed:'0'}));
      await page.waitForFunction(()=>editor.snapshot().edit.canRun);
      await page.evaluate(()=>editor.run());
      raw=JSON.parse(edits().at(-1).body);wire=gateway?raw:raw.parameters;
      assert.equal(gateway?raw.prompt:raw.input,'wolf, Text: "Hello"'); assert.equal(wire.negative_prompt,'custom negative'); assert.equal(wire.seed,0);
      assert.equal(await page.evaluate(()=>editor.session.versions.at(-1).params.seed),0);
      const drawingFields=await page.evaluate(async()=> (await import('/src/domain/drawing.ts')).reuseFields(editor.records().find(r=>r.id===editor.session.versions.at(-1).recordId)));
      assert.equal(drawingFields.prompt,'wolf, Text: "Hello"');assert.equal(drawingFields.cfgRescale,.65);assert.equal(drawingFields.characters[2].on,false);
      assert.equal(await page.evaluate(()=>drawing.snapshot().history.length),0);
      await chooseNai(page,'editorModel','nai-diffusion-4-5-curated');
      assert.equal(await page.locator('#editor-complexity').count(),0);assert.equal(await page.locator('#editor-transparentBg').count(),0);
      await page.locator('#editor-qualityPreset').click();
      assert.equal(await root.locator('.nai-menu:popover-open [data-value=light]').count(),0);await page.keyboard.press('Escape');
      assert.equal(await root.getAttribute('data-active'),'true');
      assert.deepEqual(t.errors,[]);
    } finally { await t.context.close(); }
  }
});

test('EDIT references: inherited Vibe/Precise prepare only on submit, share cache, retain URLs, protect operation and persist small snapshots', async () => {
  const t=await open('nai-official-v1',true,'',undefined,'',true),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    const drawingThumb=await page.locator('.reference-thumb img').getAttribute('src');
    await openEditorFixture(t);
    const root=page.locator('#imageEditor');
    assert.equal(await page.evaluate(()=>editor.snapshot().referenceSupported),true);
    await root.getByRole('button',{name:'Vibe Transfer',exact:true}).click();
    assert.equal(await root.getByRole('switch',{name:'启用 Vibe Transfer'}).getAttribute('aria-checked'),'true');
    assert.equal(referencePosts(t).length,0);
    await page.evaluate(()=>editor.run());
    assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
    assert.deepEqual(referencePosts(t).map(r=>r.path),['/ai/encode-vibe','/ai/generate-image']);
    let body=JSON.parse(referencePosts(t).at(-1).body);
    assert.equal(body.action,'img2img');assert.equal(body.parameters.reference_image_multiple[0],'AAH+/w==');assert.ok(body.parameters.image);
    const saved=await page.evaluate(()=>editor.session.versions.at(-1).params);
    for(const key of ['referencePlan','preparedReferences','init_image','mask_image'])assert.equal(key in saved,false);
    assert.equal(saved.naiReferences.active,'vibe');assert.equal(saved.naiReferences.vibe.length,1);
    await page.evaluate(()=>editor.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,1);
    await root.getByRole('button',{name:'Precise Reference',exact:true}).click();
    await root.locator('.bottom-reference-body input[type=file]').first().setInputFiles({name:'precise.png',mimeType:'image/png',buffer:t.png});
    await page.waitForFunction(()=>editor.snapshot().session.naiReferences.precise.length===1);
    await root.getByRole('switch',{name:'启用 Precise Reference'}).click();
    assert.equal(await page.evaluate(()=>drawing.snapshot().form.naiReferences.precise.length),0);
    await page.evaluate(()=>editor.run());
    body=JSON.parse(referencePosts(t).at(-1).body);
    assert.equal(body.parameters.director_reference_images.length,1);assert.equal('reference_image_multiple' in body.parameters,false);
    assert.equal(await page.evaluate(()=>editor.snapshot().viewed.params.naiReferences.active),'precise');
    const before=referencePosts(t).length;
    await root.getByRole('button',{name:'重绘',exact:true}).click();
    assert.equal(await page.evaluate(()=>editor.snapshot().referenceProblem),'');
    assert.equal(await root.getByRole('button',{name:'Vibe Transfer',exact:true}).count(),0);
    assert.equal(await page.locator('#editorRun').isDisabled(),true);
    await page.evaluate(()=>editor.run());assert.equal(referencePosts(t).length,before);
    await paintEditorMask(page);
    await page.evaluate(()=>editor.run());
    body=JSON.parse(referencePosts(t).at(-1).body);
    assert.equal(body.action,'infill');assert.equal(body.parameters.director_reference_images.length,1);
    await page.evaluate(()=>editor.editReferences({...editor.snapshot().session.naiReferences,active:'vibe'}));
    assert.match(await page.evaluate(()=>editor.snapshot().referenceProblem),/不支持 Vibe/);
    assert.equal(await page.locator('#editorRun').isDisabled(),true);
    await page.evaluate(()=>editor.setMode('img2img'));
    await chooseNai(page,'editorModel','nai-diffusion-5-full');
    assert.equal(await page.locator('#editorRun').isDisabled(),true);
    await chooseNai(page,'editorModel','nai-diffusion-4-5-full');
    await page.evaluate(()=>editor.close());await page.evaluate(()=>location.hash='#/image');
    await page.locator('#imageEditor').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(async url=>(await fetch(url)).ok,drawingThumb),true);
    await page.evaluate(()=>drawing.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,1);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test("EDIT official: five Img2Img and four Inpaint variants, painted-area pixels, actual seed and compact",async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await openEditorFixture(t,{model:'nai-diffusion-5-full',prompt:'synthetic detail',seed:0,cfgRescale:.6});
    account.generatedImage=await solidPng(page,512,512);
    for(const model of ['nai-diffusion-4-5-full','nai-diffusion-4-5-curated','nai-diffusion-5-full','nai-diffusion-5-curated','nai-diffusion-5-full-medium']) {
      await page.evaluate(model=>{editor.setMode('img2img');editor.setBase(1);editor.setModel(model);editor.setNumber('strength',.4);editor.setNumber('noise',.2);},model);
      await page.evaluate(()=>editor.run());
      assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
      let body=JSON.parse(referencePosts(t).at(-1).body);
      assert.equal(body.model,model);assert.equal(body.action,'img2img');assert.equal(body.parameters.strength,.4);assert.equal(body.parameters.noise,.2);
      assert.equal(body.parameters.seed,0);assert.equal(body.parameters.cfg_rescale,model.endsWith('medium')?undefined:.6);
      if(model==='nai-diffusion-5-curated') {
        await page.evaluate(()=>editor.setMode('inpaint'));
        await page.locator('#editorModel').click();
        const menu=page.locator('#'+await page.locator('#editorModel').getAttribute('aria-controls'));
        assert.equal(await menu.locator('button[role="menuitemradio"]').count(),3);
        assert.equal(await menu.locator('button[data-value="nai-diffusion-5-curated"]').count(),0);
        assert.notEqual(await page.locator('#editorModel').getAttribute('data-value'),model);
        await page.keyboard.press('Escape');
        continue;
      }
      await page.evaluate(model=>{editor.setMode('inpaint');editor.setBase(1);editor.setModel(model);editor.setNumber('strength',.65);},model);
      await paintEditorMask(page);
      await page.evaluate(()=>editor.run());
      assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
      body=JSON.parse(referencePosts(t).at(-1).body);
      assert.equal(body.model,model+'-inpainting');assert.equal(body.action,'infill');
      assert.deepEqual(body.parameters.img2img,{strength:.65,color_correct:true});assert.equal(body.parameters.noise,undefined);
      const saved=await page.evaluate(async()=>{
        const v=editor.snapshot().viewed,b=await createImageBitmap(v.blob),c=new OffscreenCanvas(b.width,b.height),x=c.getContext('2d');
        x.drawImage(b,0,0);b.close();return {outside:[...x.getImageData(0,0,1,1).data],inside:[...x.getImageData(256,256,1,1).data],params:v.params};
      });
      assert.deepEqual(saved.outside,[80,65,124,255]);assert.deepEqual(saved.inside,[224,64,80,255]);
      assert.equal(saved.params.seed,0);assert.equal(saved.params.noise,0);
      for(const key of ['init_image','mask_image','preparedReferences'])assert.equal(key in saved.params,false);
    }
    await page.locator('#editor-parametersToggle').click();
    assert.equal(await page.locator('#editorNoise').count(),0);
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});
      await page.locator('#imageEditor').getByRole('button',{name:'适应窗口',exact:true}).click();
      await page.waitForTimeout(120);

    }
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('EDIT official Upscale: one menu choice, 4x ZIP/raw output, original bytes, validation, failure and cancellation never retry',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account),{page}=t;
  let release;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await openEditorFixture(t);
    account.upscaleImage=await solidPng(page,2048,2048);
    await page.locator('#editorUpscaleToggle').click();
    assert.equal(await page.getByRole('menuitemradio',{name:'外部放大',exact:true}).isDisabled(),true);
    await page.getByRole('menuitemradio',{name:'原生放大',exact:true}).click();
    assert.equal(await page.locator('#editorUpscalePop .editor-pop-item').count(),0);
    assert.equal(await page.locator('#editorUpscalePop .editor-mini-value').count(),1);
    assert.match(await page.locator('#editorUpscalePop').textContent(),/NovelAI Upscale/);
    assert.match(await page.locator('#editorUpscalePop .editor-mini-facts').textContent(),/4×.*2048×2048/);

    await page.locator('#editorUpscaleRun').click();
    await page.waitForFunction(()=>!editor.snapshot().busy&&editor.snapshot().viewed.kind==='result');
    assert.equal(await page.evaluate(()=>editor.snapshot().viewed.width),2048);
    assert.equal(await page.evaluate(()=>editor.snapshot().viewed.params.upscaleFactor),4);
    assert.match(t.requests.filter(r=>r.path==='/ai/upscale').at(-1).body,/declared_blur_sigma/);
    assert.equal(await page.evaluate(()=>editor.snapshot().viewed.blob.size),account.upscaleImage.length);
    // Re-run from the original, not the just-upscaled image.
    await page.evaluate(()=>editor.setBase(1));account.bareImage=true;
    await page.evaluate(()=>editor.run('upscale'));assert.equal(await page.evaluate(()=>editor.snapshot().runError),'');
    await page.evaluate(()=>editor.setBase(1));
    account.upscaleImage=t.png;
    const count=await page.evaluate(()=>editor.snapshot().session.versions.length);
    await page.evaluate(()=>editor.run('upscale'));
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/4×/);assert.equal(await page.evaluate(()=>editor.snapshot().session.versions.length),count);
    account.generationStatus=503;
    await page.evaluate(()=>editor.run('upscale'));
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/Synthetic generation failure/);
    account.generationStatus=undefined;account.upscaleImage=await solidPng(page,2048,2048);
    let started;
    const arrived=new Promise(resolve=>{started=resolve;});
    account.onGenerate=()=>new Promise(r=>{release=r;started();});
    const pending=page.evaluate(()=>editor.run('upscale'));
    await arrived;await page.evaluate(()=>editor.cancel());release?.();await pending;
    assert.equal(await page.evaluate(()=>editor.snapshot().session.versions.length),count);
    assert.equal(t.requests.filter(r=>r.path==='/ai/upscale').length,5);
    assert.deepEqual(t.errors,[]);
  } finally {release?.();await t.context.close();}
});

test('EDIT official Inpaint: empty masks never submit; wrong output dimensions fail without saving a partial result',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await openEditorFixture(t);
    await page.evaluate(()=>editor.setMode('inpaint'));
    assert.equal(await page.locator('#editorRun').isDisabled(),true);
    await page.evaluate(()=>editor.run());assert.equal(referencePosts(t).length,0);
    await paintEditorMask(page);account.generatedImage=await solidPng(page,256,256);
    await page.evaluate(()=>editor.run());
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/尺寸.*不一致/);
    assert.equal(await page.evaluate(()=>editor.snapshot().session.versions.length),1);
    assert.equal(referencePosts(t).length,1);assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('EDIT Medium: only an advertised gateway tool is selectable; effective constraints preserve High controls', async () => {
  const t=await open('nai-official-v1',true,'',{status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:100,purchasedTrainingSteps:0}},mediumEditor:true},'',true),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await openEditorFixture(t,{model:'nai-diffusion-5-full',prompt:'synthetic',negative_prompt:'keep this negative',steps:31,sampler:'k_euler',cfgRescale:.65,seed:-1,
      localCharacters:[{id:'c1',on:true,prompt:'1girl',negative:'hat',centers:[]}],negativePreset:'human'});
    await page.locator('#editor-effort label:has(input[value=medium])').click();
    await page.locator('#editor-parametersToggle').click();
    assert.equal(await page.locator('#editorSteps').inputValue(),'14');assert.equal(await page.locator('#editorSampler').inputValue(),'k_euler_ancestral');
    assert.equal(await page.locator('#editorSteps').isDisabled(),true);assert.equal(await page.locator('#editorCfgRescale').isDisabled(),true);
    await page.waitForFunction(()=>editor.snapshot().edit.quote);
    await page.evaluate(()=>editor.run());
    const req=t.requests.filter(r=>r.path.endsWith('/tools/run')).at(-1),body=JSON.parse(req.body);
    assert.equal(body.model,'nai-diffusion-5-full-medium');assert.equal(body.steps,14);assert.match(body.negative_prompt,/^nsfw, lowres, artistic error/);assert.equal(body.characters[0].uc,'');
    assert.equal('cfg_rescale' in body,false);
    assert.equal(await page.evaluate(()=>editor.snapshot().viewed.params.baseNegative),'keep this negative');
    await page.locator('#editor-effort label:has(input[value=high])').click();
    assert.equal(await page.locator('#editorSteps').inputValue(),'31');assert.equal(await page.locator('#editorCfgRescale').inputValue(),'0.65');
    assert.equal(await page.locator('#editorSampler').inputValue(),'k_euler');
    assert.equal(await page.evaluate(()=>editor.snapshot().session.characters[0].negative),'hat');
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('EDIT reference failures: known balance, encoding error, cancellation and key changes never lose cache or switch source', async () => {
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account,'',true),{page}=t;
  let release;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();await openEditorFixture(t);
    await page.waitForFunction(()=>editor.snapshot().edit.canRun);
    await page.evaluate(()=>editor.run());
    assert.equal(referencePosts(t).length,0);assert.match(await page.evaluate(()=>editor.snapshot().runError),/不足/);
    account.body.trainingStepsLeft.fixedTrainingStepsLeft=100;account.encodingStatus=500;
    await page.evaluate(()=>editor.refreshQuota());
    await page.waitForFunction(()=>editor.snapshot().edit.canRun);
    await page.evaluate(()=>editor.run());
    assert.deepEqual(referencePosts(t).map(r=>r.path),['/ai/encode-vibe'],await page.evaluate(()=>editor.snapshot().runError));
    assert.equal(await page.evaluate(()=>services.references.pending(editor.session.naiReferences.vibe[0],editor.snapshot().model.id)),true);
    account.encodingStatus=200;
    const held=new Promise(resolve=>{release=resolve;});
    await page.route('https://image.novelai.net/ai/generate-image',async route=>{await held;await route.abort().catch(()=>{});});
    await page.locator('#editorRun').click();
    await page.waitForFunction(()=>editor.snapshot().busy && !services.references.pending(editor.session.naiReferences.vibe[0],editor.snapshot().model.id));
    await page.locator('#editorStop').click();
    await page.waitForFunction(()=>!editor.snapshot().busy);release();
    await page.unroute('https://image.novelai.net/ai/generate-image');
    assert.equal(await page.evaluate(()=>editor.snapshot().session.versions.length),1);
    const encodes=referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length;
    await page.waitForFunction(()=>editor.snapshot().edit.canRun);
    await page.evaluate(()=>editor.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,encodes);
    assert.equal(await page.evaluate(()=>editor.snapshot().session.versions.length),2);
    await page.evaluate(()=>editor.editReferences({...editor.session.naiReferences,vibe:editor.session.naiReferences.vibe.map(r=>({...r,information:.5}))}));
    account.onEncode=async()=>page.evaluate(()=>services.connections.supplyKey('test-key','synthetic-replaced-editor-key'));
    const before=referencePosts(t).filter(r=>r.path==='/ai/generate-image').length;
    await page.waitForFunction(()=>editor.snapshot().edit.canRun);
    await page.evaluate(()=>editor.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/generate-image').length,before);
    assert.match(await page.evaluate(()=>editor.snapshot().runError),/变化|变更|失效|配置|Key/);
    assert.equal(await page.evaluate(()=>services.references.pending(editor.session.naiReferences.vibe[0],editor.snapshot().model.id)),false);
    assert.equal(t.requests.some(r=>r.path.endsWith('/tools/run')),false);
    assert.deepEqual(t.errors,[]);
  } finally {release?.();await t.context.close();}
});

test('EDIT drawer and uploads: reference selection and stale imports cannot mutate another session', async () => {
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await openEditorFixture(t,{model:'nai-diffusion-4-5-full',prompt:'synthetic'});
    const root=page.locator('#imageEditor');
    await root.getByRole('button',{name:'Vibe Transfer',exact:true}).click();
    await root.locator('.bottom-reference-body input[type=file]').first().setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:t.png});
    await page.waitForFunction(()=>editor.session.naiReferences.vibe.length===1);
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});
      await root.locator('.reference-thumb').scrollIntoViewIfNeeded();
      }
    await page.setViewportSize({width:390,height:900});
    await page.locator('#editor-parametersToggle').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#editor-parametersToggle').getAttribute('aria-expanded'),'false');
    assert.equal(await root.getAttribute('data-active'),'true');
    await root.getByRole('button',{name:'Vibe Transfer',exact:true}).click();
    await page.evaluate(()=>{
      const original=services.references.upload;
      services.references.upload=async(...args)=>{ const rows=await original(...args);await new Promise(resolve=>window.finishEditorUpload=resolve);return rows; };
    });
    await root.locator('.bottom-reference-body input[type=file]').first().setInputFiles({name:'late.png',mimeType:'image/png',buffer:t.png});
    await page.waitForFunction(()=>!!window.finishEditorUpload);
    await page.evaluate(()=>editor.createBoard());
    await page.evaluate(()=>window.finishEditorUpload());
    await page.waitForFunction(()=>ui.notices.value.some(n=>n.text.includes('来源')||n.text.includes('会话')));
    assert.equal(await page.evaluate(()=>editor.session.naiReferences.vibe.length),0);
    assert.equal(await page.evaluate(()=>drawing.snapshot().form.naiReferences.vibe.length),0);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});
