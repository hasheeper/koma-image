import { test } from "node:test";
import assert from "node:assert/strict";

import { useNativeFixture, open, bind, chooseNai, addReference, referencePosts } from "./helpers/native-fixture.mjs";

useNativeFixture();

test('NAI references: upload/edit is free, explicit generate caches binary Vibe and keeps configuration after reload',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await addReference(t);
    assert.equal(referencePosts(t).length,0);
    assert.equal(await page.getByRole('switch',{name:'启用 Vibe Transfer'}).getAttribute('aria-checked'),'false');
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    await page.locator('#goBtn').click();
    await page.waitForFunction(()=>!drawing.snapshot().busy && drawing.snapshot().history.length===1);
    const posts=referencePosts(t);
    assert.deepEqual(posts.map(r=>r.path),['/ai/encode-vibe','/ai/generate-image']);
    const encoding=JSON.parse(posts[0].body), generation=JSON.parse(posts[1].body);
    assert.equal(encoding.image,t.png.toString('base64'));
    assert.equal(encoding.information_extracted,.7);
    assert.equal(encoding.model,'nai-diffusion-4-5-full');
    assert.equal(generation.parameters.reference_image_multiple[0],'AAH+/w==');
    assert.equal('referencePlan' in generation,false);
    assert.equal('reference_information_extracted_multiple' in generation.parameters,false);
    assert.equal(await page.locator('.reference-thumb .pending').count(),0);
    await page.locator('#goBtn').click();
    await page.waitForFunction(()=>!drawing.snapshot().busy && drawing.snapshot().history.length===2);
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,1);
    await page.reload();await bind(page);
    await page.waitForFunction(()=>drawing.snapshot().model && drawing.snapshot().form.naiReferences.vibe.length===1);
    await page.getByRole('button',{name:'Vibe Transfer',exact:true}).click();
    assert.equal(await page.locator('.reference-thumb .pending').count(),0);
    assert.ok(await page.locator('.reference-thumb img').getAttribute('src'));
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('NAI references: generation failure keeps successful encodings; failed encode never generates or retries',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:100,purchasedTrainingSteps:0}},generationStatus:500};
  const t=await open('nai-official-v1',true,'',account),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    await page.evaluate(()=>drawing.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,1);
    assert.equal(await page.locator('.reference-thumb .pending').count(),0);
    account.generationStatus=0;
    await page.evaluate(()=>drawing.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,1);
    await page.getByRole('slider',{name:'信息提取量'}).fill('0.8');
    account.encodingStatus=500;
    await page.evaluate(()=>drawing.run());
    const posts=referencePosts(t);assert.equal(posts.at(-1).path,'/ai/encode-vibe');
    assert.equal(posts.filter(r=>r.path==='/ai/encode-vibe').length,2);
    assert.equal(posts.filter(r=>r.path==='/ai/generate-image').length,2);
    assert.match(await page.evaluate(()=>drawing.snapshot().error),/编码失败/);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('NAI references: Precise aspect-fit PNG, paired types and inverted Fidelity; incompatible models cannot drop refs',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t,'precise');
    await page.getByRole('slider',{name:'保真度'}).fill('0.85');
    await page.getByRole('switch',{name:'启用 Precise Reference'}).click();
    await page.evaluate(()=>drawing.run());
    const post=referencePosts(t).at(-1),wire=JSON.parse(post.body).parameters;
    assert.equal(post.path,'/ai/generate-image');
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,0);
    assert.deepEqual(wire.director_reference_descriptions,[{caption:{base_caption:'character&style',char_captions:[]},legacy_uc:false}]);
    assert.ok(Math.abs(wire.director_reference_secondary_strength_values[0]-.15)<1e-12);
    assert.deepEqual(wire.director_reference_strength_values,[1]);
    const dimensions=await page.evaluate(async b64=>{const b=await createImageBitmap(new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],{type:'image/png'}));const size=[b.width,b.height];b.close();return size;},wire.director_reference_images[0]);
    assert.deepEqual(dimensions,[1472,1472]);
    const before=referencePosts(t).length;
    await chooseNai(page,'model','nai-diffusion-5-full');
    assert.equal(await page.locator('#goBtn').isDisabled(),true);
    assert.equal(await page.locator('.reference-problem').count(),1);
    await page.evaluate(()=>drawing.run());assert.equal(referencePosts(t).length,before);
    await page.getByRole('button',{name:'停用参考',exact:true}).click();
    assert.equal(await page.locator('#goBtn').isDisabled(),false);
    assert.equal(await page.getByRole('button',{name:'Vibe Transfer',exact:true}).count(),0);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('NAI references: drawer retains original parameters; switch is beside viewed group',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t,'precise',3);
    {
      const width = 1440;
      await page.setViewportSize({width,height:900});
      await page.locator('.bottom-reference-body').waitFor({state:'visible'});
      assert.equal(await page.locator('.bottom-reference-segment.selected').innerText(),'Precise');
    }
    await page.locator('#parametersToggle').click();
    assert.equal(await page.getByRole('slider',{name:'Guidance',exact:true}).count(),1);
    assert.equal(await page.getByRole('switch',{name:'启用 Precise Reference'}).count(),0);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#parametersToggle').getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('.drawer-shell').getAttribute('inert'),'');
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('NAI references: backup and official bundle restore original bytes, paid cache and board settings without encoding',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    await page.evaluate(()=>drawing.run());
    const exported=await page.evaluate(async()=>{
      const refs=drawing.snapshot().form.naiReferences;
      const bundle=await services.references.export(refs.vibe,'vibe',drawing.snapshot().form.model);
      const bytes=new Uint8Array(await (await services.backup.export()).blob.arrayBuffer());
      window.referenceBackup=new Blob([bytes],{type:'application/zip'});
      window.referenceBundle=await bundle.text();
      const checked=await services.backup.read(referenceBackup);
      return {assets:checked.referenceAssets.length,encodings:checked.vibeEncodings.length,original:await checked.referenceAssets[0].blob.arrayBuffer().then(b=>Array.from(new Uint8Array(b))),bundle:JSON.parse(referenceBundle)};
    });
    assert.equal(exported.assets,1);assert.equal(exported.encodings,1);
    assert.deepEqual(Buffer.from(exported.original),t.png);
    assert.equal(exported.bundle.identifier,'novelai-vibe-transfer-bundle');
    assert.equal(exported.bundle.vibes[0].encodings['v4-5full'][Object.keys(exported.bundle.vibes[0].encodings['v4-5full'])[0]].encoding,'AAH+/w==');
    const before=referencePosts(t).length;
    await page.evaluate(async()=>{
      await drawing.patch({naiReferences:{active:null,normalize:false,vibe:[],precise:[]}});
      await services.data.write(async()=>{const {transactionDone}=await import('/src/storage/databases.ts');const tx=services.databases.transaction('koma-image-favorites',['referenceAssets','vibeEncodings'],'readwrite');tx.objectStore('referenceAssets').clear();tx.objectStore('vibeEncodings').clear();await transactionDone(tx);});
      const backup=await services.backup.read(referenceBackup);await services.backup.import(backup);
    });
    await page.waitForFunction(()=>drawing.snapshot().form.naiReferences.active==='vibe');
    assert.equal(referencePosts(t).length,before);
    await page.evaluate(()=>drawing.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,1);
    await page.evaluate(async()=>{
      const items=await services.references.import(new File([referenceBundle],'synthetic.naiv4vibebundle',{type:'application/json'}),'vibe','nai-diffusion-4-5-full');
      await drawing.editReferences({...drawing.snapshot().form.naiReferences,vibe:items});
    });
    await page.evaluate(()=>drawing.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,1);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('NAI references: unknown fees do not bypass known reference minimum and standard fallback cannot drop images',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account,'',true),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    await page.evaluate(()=>drawing.run());
    assert.equal(t.requests.filter(r=>r.method==='POST' && !r.path.endsWith('/estimate')).length,0);
    assert.match(await page.evaluate(()=>drawing.snapshot().error),/Anlas/);
    account.body.trainingStepsLeft.fixedTrainingStepsLeft=5;
    await page.evaluate(()=>drawing.run());
    assert.deepEqual(referencePosts(t).map(r=>r.path),['/ai/encode-vibe','/ai/generate-image']);
    assert.equal(t.requests.filter(r=>r.method==='POST' && r.path.startsWith('/primary/') && !r.path.endsWith('/estimate')).length,0);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('NAI references: paid preparation freezes board and group, keeps exact source, and escaped task encoders cannot run',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:100,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    const first=await page.evaluate(()=>drawing.snapshot().activeBoardId);
    account.onEncode=async()=>page.evaluate(async()=>{const id=await drawing.createBoard();await drawing.patch({prompt:'later board',model:'nai-diffusion-5-full'});return id;});
    await page.evaluate(()=>drawing.run());
    assert.notEqual(await page.evaluate(()=>drawing.snapshot().activeBoardId),first);
    const record=await page.evaluate(()=>drawing.snapshot().history[0]);
    assert.equal(record.params.boardId,first);assert.equal(record.params.model,'nai-diffusion-4-5-full');
    assert.equal(record.params.naiReferences.active,'vibe');
    assert.equal(JSON.parse(referencePosts(t).at(-1).body).model,'nai-diffusion-4-5-full');
    await page.evaluate(async()=>{await services.runTask({id:'capture-encoder',workspace:'image',snapshot:{}},async task=>{window.escapedEncoder=task.gateway('test').encodeVibe;});});
    const count=referencePosts(t).length;
    assert.match(await page.evaluate(()=>escapedEncoder('nai-diffusion-4-5-full','YWJj',.7,new AbortController().signal).then(()=>'',e=>e.message)),/任务已结束/);
    assert.equal(referencePosts(t).length,count);assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('NAI references: cancellation after successful encoding preserves cache and never automatically retries a submitted generation',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  let generation, release;
  const held=new Promise(resolve=>{release=resolve;});
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    await page.route('https://image.novelai.net/ai/generate-image',async route=>{generation=route;await held;await route.abort().catch(()=>{});});
    await page.locator('#goBtn').click();
    await page.waitForFunction(()=>drawing.snapshot().label.includes('生成中'));
    while(!generation)await new Promise(resolve=>setTimeout(resolve,10));
    await page.locator('#cancelBtn').click();
    await page.waitForFunction(()=>!drawing.snapshot().busy);release();
    assert.equal(await page.locator('.reference-thumb .pending').count(),0);
    await page.unroute('https://image.novelai.net/ai/generate-image');
    const encodes=referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length;
    await page.evaluate(()=>drawing.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,encodes);
    assert.equal(await page.evaluate(()=>drawing.snapshot().history.length),1);
    assert.deepEqual(t.errors,[]);
  } finally {release();await t.context.close();}
});

test('NAI references: drawer interrupt/collapse, focus, KeepAlive and binary URL lifetime remain owned',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('button',{name:'更多参考操作'}).click();
    assert.equal(await page.locator('.reference-menu:popover-open').count(),1);
    await page.evaluate(()=>location.hash='#/tags');
    await page.waitForSelector('[data-workspace-root=tags]');
    assert.equal(await page.locator('.reference-menu:popover-open').count(),0);
    await page.evaluate(()=>location.hash='#/image');
    await page.waitForSelector('.bottom-reference-body');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button',{name:'Vibe Transfer',exact:true}).getAttribute('aria-expanded'),'false');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Vibe Transfer');
    await page.getByRole('button',{name:'Vibe Transfer',exact:true}).click();
    const old=await page.locator('.reference-thumb img').getAttribute('src');
    await page.locator('#parametersToggle').click();
    assert.equal(await page.evaluate(async url=>{try{await fetch(url);return true;}catch{return false;}},old),false,'unmounted editor releases thumbnail URL');
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('NAI references: encoded-only official files lock extraction, reject corruption and reuse cache without original',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await chooseNai(page,'model','nai-diffusion-4-5-full');
    const result=await page.evaluate(async()=>{
      const {sha256}=await import('/src/native/reference-images.ts');
      const value={identifier:'novelai-vibe-transfer',version:1,type:'encoding',id:await sha256('AAH+/w=='),encodings:{'v4-5full':{unknown:{encoding:'AAH+/w==',params:{information_extracted:.7}}}},importInfo:{model:'nai-diffusion-4-5-full',information_extracted:.7,strength:.6}};
      const file=new File([JSON.stringify(value)],'synthetic.naiv4vibe',{type:'application/json'});
      const refs=await services.references.import(file,'vibe','nai-diffusion-4-5-full');
      await drawing.editReferences({active:'vibe',normalize:false,vibe:refs,precise:[]});
      const corrupt={...value,id:'b'.repeat(64)};
      const bad=await services.references.import(new File([JSON.stringify(corrupt)],'bad.naiv4vibe'),'vibe','nai-diffusion-4-5-full').then(()=>'',e=>e.message);
      const wrongModel=await services.references.import(file,'vibe','nai-diffusion-4-5-curated').then(()=>'',e=>e.message);
      return {bad,wrongModel};
    });
    assert.match(result.bad,/校验失败/);assert.match(result.wrongModel,/不包含当前模型/);
    await page.getByRole('button',{name:'Vibe Transfer',exact:true}).click();
    assert.equal(await page.getByRole('slider',{name:'信息提取量'}).isDisabled(),true);
    await page.evaluate(()=>drawing.run());
    assert.deepEqual(referencePosts(t).map(r=>r.path),['/ai/generate-image']);
    assert.equal(JSON.parse(referencePosts(t)[0].body).parameters.reference_image_multiple[0],'AAH+/w==');
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('NAI references: a connection change during paid encoding saves the receipt and prevents generation on a replacement context',async()=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:100,purchasedTrainingSteps:0}}};
  const t=await open('nai-official-v1',true,'',account),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);await addReference(t);
    await page.getByRole('switch',{name:'启用 Vibe Transfer'}).click();
    account.onEncode=async()=>page.evaluate(()=>services.connections.supplyKey('test-key','synthetic-replaced-key'));
    await page.evaluate(()=>drawing.run());
    assert.deepEqual(referencePosts(t).map(r=>r.path),['/ai/encode-vibe']);
    assert.equal(await page.locator('.reference-thumb .pending').count(),0);
    assert.match(await page.evaluate(()=>drawing.snapshot().error),/变化|变更|失效|配置|Key/);
    account.onEncode=undefined;
    await page.waitForFunction(()=>drawing.snapshot().model);
    await page.evaluate(()=>drawing.run());
    assert.deepEqual(referencePosts(t).map(r=>r.path),['/ai/encode-vibe','/ai/generate-image']);
    assert.deepEqual(t.errors,[]);
  } finally {await t.context.close();}
});

test('NAI hidden PNG imports Vibe encoding only on Apply, preserves Precise, and generates with cached bytes',async()=>{
  const t=await open('nai-official-v1'),{page}=t;
  try {
    await page.waitForFunction(()=>drawing.snapshot().model);
    await page.evaluate(async png=>{
      await drawing.patch({model:'nai-diffusion-4-5-full'});
      const rows=await services.references.upload([new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],'precise.png',{type:'image/png'})],'precise','nai-diffusion-4-5-full');
      await drawing.editReferences({...drawing.snapshot().form.naiReferences,precise:rows});
    },t.png.toString('base64'));
    const bytes=await page.evaluate(async()=>{
      const comment={model:'nai-diffusion-4-5-full',prompt:'hidden test',seed:0,width:832,height:1216,steps:23,reference_image_multiple:['AAH+/w=='],reference_strength_multiple:[.6],reference_information_extracted_multiple:[.7]};
      const gzip=new Uint8Array(await new Response(new Blob([JSON.stringify({Software:'NovelAI',Comment:JSON.stringify(comment)})]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
      const header=new Uint8Array(4);new DataView(header.buffer).setUint32(0,gzip.length*8);
      const all=new Uint8Array(19+gzip.length);all.set(new TextEncoder().encode('stealth_pngcomp'));all.set(header,15);all.set(gzip,19);
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
      const ctx=canvas.getContext('2d'),image=ctx.createImageData(128,128);image.data.fill(255);
      for(let b=0;b<all.length;b++)for(let bit=0;bit<8;bit++){const p=b*8+bit;image.data[4*(p%128*128+Math.floor(p/128))+3]=254|((all[b]>>(7-bit))&1);}
      ctx.putImageData(image,0,0);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await page.locator('#importFile').setInputFiles({name:'synthetic-hidden.png',mimeType:'image/png',buffer:Buffer.from(bytes)});
    await page.locator('#importApply').waitFor();
    assert.equal(await page.locator('input[value=pngVibes]').isChecked(),true);
    assert.equal(await page.evaluate(async()=>{const tx=services.databases.transaction('koma-image-favorites','vibeEncodings');return await new Promise(resolve=>{const r=tx.objectStore('vibeEncodings').count();r.onsuccess=()=>resolve(r.result);});}),0);
    await page.locator('#importApply').click();
    await page.waitForFunction(()=>drawing.snapshot().form.naiReferences.active==='vibe');
    const state=await page.evaluate(()=>{const refs=drawing.snapshot().form.naiReferences,r=refs.vibe[0];return{prompt:drawing.snapshot().form.prompt,precise:refs.precise.length,original:services.references.original(r.assetId),pending:services.references.pending(r,drawing.snapshot().form.model)};});
    assert.deepEqual(state,{prompt:'hidden test',precise:1,original:false,pending:false});
    await page.evaluate(()=>drawing.run());
    assert.equal(referencePosts(t).filter(r=>r.path==='/ai/encode-vibe').length,0);
    assert.deepEqual(JSON.parse(referencePosts(t).at(-1).body).parameters.reference_image_multiple,['AAH+/w==']);
    assert.deepEqual(t.errors,[]);
  }finally{await t.context.close();}
});
