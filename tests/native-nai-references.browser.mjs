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

test('NAI references: V4.5 Fidelity survives switching to V5, incompatible V5 settings can be repaired in the shared drawer',async()=>{
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
    assert.equal(await page.getByRole('button',{name:'Vibe Transfer',exact:true}).count(),0);
    assert.equal(await page.getByRole('slider',{name:'保真度'}).count(),0);
    const outfit=page.getByRole('switch',{name:'优先相同衣装'});
    assert.equal(await outfit.isChecked(),true);
    await outfit.uncheck();
    await page.getByRole('slider',{name:'参考强度'}).fill('3.5');
    await page.locator('#goBtn').click();
    await page.waitForFunction(()=>!drawing.snapshot().busy && drawing.snapshot().history.length===2);
    const v5=JSON.parse(referencePosts(t).at(-1).body).parameters;
    assert.deepEqual(v5.director_reference_strength_values,[3.5]);
    assert.deepEqual(v5.director_reference_secondary_strength_values,[0]);
    assert.equal(v5.director_reference_descriptions[0].caption.base_caption,'character&style_anyoutfit');
    assert.match(v5.director_reference_images_cached[0].cache_secret_key,/^[a-f0-9]{64}$/);
    await page.getByLabel('参考类型',{exact:true}).selectOption('costume');
    assert.equal(await outfit.count(),0);
    await chooseNai(page,'model','nai-diffusion-4-5-full');
    assert.equal(await page.locator('#goBtn').isDisabled(),true);
    assert.match(await page.locator('.reference-problem').textContent(),/第 1 张/);
    assert.equal(await page.getByRole('slider',{name:'保真度'}).inputValue(),'0.85');
    await page.evaluate(()=>drawing.run());assert.equal(referencePosts(t).length,before+1);
    await page.getByRole('button',{name:'此图参与参考'}).click();
    assert.equal(await page.locator('#goBtn').isDisabled(),false);
    await chooseNai(page,'model','nai-diffusion-5-full');
    assert.equal(await page.getByLabel('参考类型',{exact:true}).inputValue(),'costume');
    assert.equal(await page.getByRole('slider',{name:'参考强度'}).inputValue(),'3.5');
    await chooseNai(page,'model','nai-diffusion-4-5-full');
    await page.getByRole('button',{name:'此图参与参考'}).click();
    await page.getByLabel('参考类型',{exact:true}).selectOption('character');
    await page.getByRole('button',{name:'将强度调至 V4.5 上限 1'}).click();
    assert.equal(await page.locator('#goBtn').isDisabled(),false);
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

test('Precise preprocessing crops centered landscape and portrait markers, preserves transparent pixels and keeps V4.5 bars',async t=>{
  const f=await open('nai-official-v1'); t.after(()=>f.context.close());
  const results=await f.page.evaluate(async()=>{
    const {preciseImage,base64Blob}=await import('/src/native/reference-images.ts');
    const results=[];
    for (const [w,h] of [[1920,1080],[1080,1920],[512,512]]) {
      const c=document.createElement('canvas'); c.width=w;c.height=h;
      const ctx=c.getContext('2d');ctx.fillStyle='#00ff00';ctx.fillRect(0,0,w,h);
      ctx.fillStyle='#ff0000';
      if(w>h){ctx.fillRect(0,0,8,h);ctx.fillRect(w-8,0,8,h);}
      else if(h>w){ctx.fillRect(0,0,w,8);ctx.fillRect(0,h-8,w,8);}
      ctx.clearRect(w/2-8,h/2-8,16,16);
      const raw=await new Promise(resolve=>c.toBlob(resolve));
      for(const model of ['nai-diffusion-5-curated','nai-diffusion-4-5-full']){
        const image=await createImageBitmap(base64Blob(await preciseImage(raw,model),'image/png'));
        const dst=document.createElement('canvas');dst.width=image.width;dst.height=image.height;
        const dc=dst.getContext('2d');dc.drawImage(image,0,0);image.close();
        const pixel=(x,y)=>Array.from(dc.getImageData(x,y,1,1).data);
        results.push({size:[dst.width,dst.height],center:pixel(dst.width/2,dst.height/2),corner:pixel(0,0),opposite:pixel(dst.width-1,dst.height-1)});
      }
    }
    return results;
  });
  for (const [i,size] of [[0,[1344,768]],[2,[768,1344]],[4,[1024,1024]]]) {
    assert.deepEqual(results[i],{size,center:[0,0,0,0],corner:[0,255,0,255],opposite:[0,255,0,255]});
    assert.deepEqual(results[i+1].center,[0,0,0,255]);
    if(i!==4)assert.deepEqual(results[i+1].corner,[0,0,0,255]);
  }
});

test('V5 batch sends complete enabled references, preserves Precise JSON v1/v2, favorite and full backup',async t=>{
  const account={status:200,body:{active:true,tier:3,trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}};
  const f=await open('nai-official-v1',true,'',account,'',true),{page}=f;t.after(()=>f.context.close());
  await page.waitForFunction(()=>drawing.snapshot().model);
  await chooseNai(page,'model','nai-diffusion-5-curated');
  const configs=await page.evaluate(async png=>{
    const model=drawing.snapshot().form.model;
    const swatch=new OffscreenCanvas(64,64);
    const ctx=swatch.getContext('2d');ctx.fillStyle='lime';ctx.fillRect(0,0,64,64);
    const [row,last]=await services.references.upload([new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],'ref.png',{type:'image/png'}),
      new File([await swatch.convertToBlob()],'swatch.png',{type:'image/png'})],'precise',model);
    const old=await services.references.export([{...row,on:false}],'precise',model);
    const restore=blob=>services.references.import(new File([blob],'refs.json'),'precise',model);
    const v1=(await restore(old))[0];
    const refs={...drawing.snapshot().form.naiReferences, active:'precise',precise:[
      {...row,type:'costume',strength:3.5,fidelity:.25}, {...row,id:'disabled',on:false,type:'style'},
      {...last,type:'character',preferSameOutfit:true,strength:5}]};
    await drawing.patch({naiReferences:refs,batchCount:2});
    const v2=await services.references.export(refs.precise,'precise',model);
    const imported=await restore(v2), settings=({id,...r})=>r;
    const bad=JSON.parse(await v2.text());bad.images[1].settings.preferSameOutfit='true';
    const rejected=await restore(new Blob([JSON.stringify(bad)])).then(()=>false,()=>true);
    return {v1:JSON.parse(await old.text()).version,v1on:v1.on,hasNew:Object.hasOwn(v1,'preferSameOutfit'),
      v2:JSON.parse(await v2.text()).version,wanted:refs.precise.map(settings),imported:imported.map(settings),rejected};
  },f.png.toString('base64'));
  assert.equal(configs.v1,1);assert.equal(configs.v1on,false);assert.equal(configs.hasNew,false);
  assert.equal(configs.v2,2);assert.deepEqual(configs.imported,configs.wanted);assert.ok(configs.rejected);
  assert.equal(referencePosts(f).length,0);
  await page.evaluate(()=>drawing.run());
  assert.deepEqual(referencePosts(f).map(p=>p.path),Array(2).fill('/ai/generate-image'));
  for(const post of referencePosts(f)){
    const p=JSON.parse(post.body).parameters;
    assert.deepEqual(p.director_reference_descriptions.map(d=>d.caption.base_caption),['costume','character_mainoutfit']);
    assert.deepEqual(p.director_reference_strength_values,[3.5,5]);
    assert.deepEqual(p.director_reference_secondary_strength_values,[0,0]);
    assert.ok(p.director_reference_images_cached.every(r=>r.data.length>100 && /^[0-9a-f]{64}$/.test(r.cache_secret_key)));
    assert.equal(p.director_reference_images_cached.length,2);
    assert.notEqual(p.director_reference_images_cached[0].data,p.director_reference_images_cached[1].data);
    assert.equal('director_reference_images' in p,false);
  }
  const restored=await page.evaluate(async()=>{
    await drawing.ensureFavorite(drawing.snapshot().history[0]);
    const snap=drawing.snapshot().form.naiReferences;
    const backup=await services.backup.read((await services.backup.export()).blob);
    await drawing.editReferences({...snap,precise:[],active:null});
    await services.backup.import(backup);
    const d=drawing.snapshot();
    return {before:snap,after:d.form.naiReferences,favorite:d.favorites[0].params.naiReferences,assets:backup.referenceAssets.length,encodings:backup.vibeEncodings.length};
  });
  assert.deepEqual(restored.before,restored.after);assert.deepEqual(restored.favorite,restored.after);
  assert.equal(restored.assets,2);assert.equal(restored.encodings,0);
  account.body.trainingStepsLeft.fixedTrainingStepsLeft=9;
  await page.evaluate(()=>drawing.run());
  assert.match(await page.evaluate(()=>drawing.snapshot().error),/参考费用/);
  assert.equal(referencePosts(f).length,2);
  account.body.trainingStepsLeft.fixedTrainingStepsLeft=1000;
  account.generationStatus=500;
  await page.evaluate(()=>drawing.run());
  assert.equal(referencePosts(f).length,3);
  let submissions=0, release;
  const hold=new Promise(resolve=>{release=resolve;});
  await page.route('https://image.novelai.net/ai/generate-image',async route=>{
    submissions++;await hold;await route.abort().catch(()=>{});
  });
  try {
    const sent=page.waitForRequest(req=>req.url()==='https://image.novelai.net/ai/generate-image');
    await page.locator('#goBtn').click();await sent;
    await page.locator('#cancelBtn').click();await page.waitForFunction(()=>!drawing.snapshot().busy);
  } finally {release();}
  assert.equal(submissions,1);
  assert.equal(f.requests.some(r=>r.path.startsWith('/primary/') && r.method==='POST' && !r.path.endsWith('/estimate')),false);
  assert.deepEqual(f.errors,[]);
});
