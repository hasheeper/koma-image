import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

let server, browser, origin;
before(async () => {
  await mkdir('.local/pe1', { recursive: true });
  server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } });
  await server.listen(); origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

async function setup() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], upstream = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    upstream.push(route.request().url()); return route.abort();
  });
  await page.goto(origin + "/#/image");
  await page.waitForSelector('#prompt', { state: 'attached' });
  await page.evaluate(async () => {
    const p = document.body.__vue_app__._instance.provides;
    for (const name of ['editor', 'drawing', 'ask', 'slate', 'app-shell'])
      window[name.replace('-', '_')] = p[Object.getOwnPropertySymbols(p).find(k => k.description === name)];
    window.makeImage = async (kind = 'image', w = 256, h = 384) => {
      const canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext('2d');
      if (kind !== 'alpha') { ctx.fillStyle = kind === 'image' ? '#ef3030' : kind === 'edited' ? '#3060ef' : 'black'; ctx.fillRect(0, 0, w, h); }
      if (kind !== 'empty') { ctx.fillStyle = 'white'; ctx.fillRect(0, 0, w / 2, h); }
      return canvas.convertToBlob({ type: 'image/png' });
    };
    window.original = await makeImage();
    await editor.open('image', original, 'synthetic.png', { settings: {
      model: 'nai-diffusion-4-5-full', prompt: 'synthetic source', basePrompt: 'source recipe', seed: 7,
      characters: [], localCharacters: [], width: 256, height: 384,
    } });
  });
  await page.waitForSelector('#imageEditor[data-active=true]');
  return { page, errors, upstream, context };
}

test('PE1 masks distinguish opaque grayscale from alpha, preserve undo/erase/clear and reject empty/color/mismatched masks', async () => {
  const t = await setup();
  try {
    const result = await t.page.evaluate(async () => {
      const { decodeMask } = await import('/src/native/edit-input.ts');
      const { createMaskEditor, emptyMask, withMaskBitmap } = await import('/src/native/mask-editor.ts');
      const canvas = document.createElement('canvas'), mask = createMaskEditor(canvas, () => {});
      const size = { width: 256, height: 384 };
      const opaque = await decodeMask(await makeImage('mask'), 'grayscale', size);
      const alpha = await decodeMask(await makeImage('alpha'), 'alpha', size);
      const same = opaque.bits.every((v, i) => v === alpha.bits[i]);
      const read = async () => {
        const value = mask.getMask(); if (!value) return null;
        const b = await createImageBitmap(await (await fetch(value)).blob()), c = new OffscreenCanvas(b.width, b.height), x = c.getContext('2d');
        x.drawImage(b, 0, 0); b.close();
        return [x.getImageData(20, 20, 1, 1).data[0], x.getImageData(240, 20, 1, 1).data[0]];
      };
      mask.restore(withMaskBitmap(emptyMask(256, 384), opaque));
      const imported = await read(); mask.undo(); const undone = await read(); mask.redo();
      const state = mask.snapshot();
      state.strokes.push({ points: [{ x: 20, y: 20 }], diameter: 30, erase: true, pointer: 1 }); state.position++;
      mask.restore(state); const erased = await read(); mask.undo(); const restored = await read();
      mask.clear(); const cleared = await read(); mask.undo(); const afterClearUndo = await read();
      const failures = [];
      for (const [kind, size] of [['image', {width:256,height:384}], ['empty', {width:256,height:384}], ['mask', {width:128,height:128}]]) {
        try { await decodeMask(await makeImage(kind), 'grayscale', size); } catch(e) { failures.push(e.message); }
      }
      mask.dispose();
      return { same, bytes: opaque.bits.length, imported, undone, erased, restored, cleared, afterClearUndo, failures };
    });
    assert.equal(result.same, true); assert.equal(result.bytes, 12288);
    assert.deepEqual(result.imported, [255, 0]); assert.equal(result.undone, null);
    assert.deepEqual(result.erased, [0, 0]); assert.deepEqual(result.restored, [255, 0]);
    assert.equal(result.cleared, null); assert.deepEqual(result.afterClearUndo, [255, 0]);
    assert.match(result.failures.join(' '), /彩色图.*没有重绘区域.*尺寸/);
    assert.deepEqual(t.errors, []); assert.deepEqual(t.upstream, []);
  } finally { await t.context.close(); }
});

test('PE1 all return modes, source recipe, idempotent favorite and persistent Slate delivery without generation', async () => {
  const t = await setup();
  try {
    const result = await t.page.evaluate(async () => {
      const { parseSlateEdit } = await import('/src/slate/edit.ts');
      const { assetReceipt } = await import('/src/slate/documents.ts');
      const { captionText } = await import('/src/slate/captions.ts');
      const { metadata } = await import('/src/ask/library.ts');
      editor.setMode('inpaint');
      let token = editor.beginExternalEdit();
      await editor.applyExternalEdit(token.id, { mode: 'selection', image: original, mask: await makeImage('mask'), format: 'grayscale' });
      const selection = { versions: editor.session.versions.length, mask: editor.session.mask.strokes.length, history: drawing.snapshot().history.length };
      token = editor.beginExternalEdit();
      await editor.applyExternalEdit(token.id, { mode: 'image-selection', image: await makeImage('edited'), mask: await makeImage('alpha'), format: 'alpha' });
      const combined = editor.snapshot().base;
      const combinedMask = structuredClone(editor.session.mask);
      token = editor.beginExternalEdit();
      await editor.applyExternalEdit(token.id, { mode: 'image', image: await makeImage('edited', 384, 256) });
      const image = editor.snapshot().base;
      await Promise.all([editor.saveFavorite(), editor.saveFavorite(), editor.saveFavorite()]);
      await editor.saveFavorite();
      await editor.saveFavorite();
      const current = editor.record(image.recordId);
      const library = ask.externalSnapshot().library;
      const picture = library.find(p => p.id === current.id);
      await slate.commit(parseSlateEdit({kind:'slate_edit',op:'create',slate_title:'纯修图交付',todos:[{op:'add',todo_title:'修复',status:'done',bind:{source:picture.label,caption_source:'base',caption_mode:'full'}}]},null,drawing.snapshot().form,library).change);
      const todo = slate.snapshot().todos[0], asset = await slate.asset(todo.binding.assetId);
      const receipt = assetReceipt(asset);
      editor.setBase(combined.id);
      const restored = JSON.stringify(editor.session.mask) === JSON.stringify(combinedMask);
      return { selection, combined: {parent: combined.parentId, kind: combined.kind}, image: {parent:image.parentId,mask:editor.session.versions.some(v=>Object.hasOwn(v,"mask")),params:image.params},
        history:drawing.snapshot().history.length,favorites:drawing.snapshot().favorites.length,quote:current.quote,ms:current.ms,
        restored, caption:captionText(asset,todo.binding.caption),receipt,bytesSame:await asset.blob.text() === await image.blob.text(), meta:metadata(picture) };
    });
    assert.deepEqual(result.selection, { versions: 1, mask: 1, history: 0 });
    assert.deepEqual(result.combined, { parent: 1, kind: 'manual' });
    assert.equal(result.image.parent, 2); assert.equal(result.image.mask, false);
    assert.equal(result.image.params.tool, 'manual-edit'); assert.equal(result.image.params.seed, undefined);
    assert.equal(result.image.params.sourceRecipe.seed, 7); assert.equal(result.image.params.width, 384);
    assert.equal(result.history, 0); assert.equal(result.favorites, 1); assert.equal(result.quote, undefined);
    assert.equal(result.ms, undefined);
    assert.equal(result.restored, false); assert.equal(result.caption, 'source recipe'); assert.equal(result.bytesSame, true);
    assert.equal(result.meta.source_recipe.seed, 7); assert.equal(result.meta.edit_source, 'photopea');
    assert.match(JSON.stringify(result.receipt), /manual-edit/);
    await t.page.reload(); await t.page.waitForSelector('[data-workspace-root]', {state:'attached'});
    const persisted = await t.page.evaluate(async () => {
      const p=document.body.__vue_app__._instance.provides, sl=p[Object.getOwnPropertySymbols(p).find(k=>k.description==='slate')];
      while(!sl.ready.value) await new Promise(r=>setTimeout(r,20));
      const a=await sl.asset(sl.snapshot().todos[0].binding.assetId); return {tool:a.params.tool,recipe:a.params.sourceRecipe.seed};
    });
    assert.deepEqual(persisted,{tool:'manual-edit',recipe:7});
    assert.deepEqual(t.errors, []); assert.deepEqual(t.upstream, []);
  } finally { await t.context.close(); }
});

test('PE1 stale/duplicate/cancelled returns and partial failures cannot change image or mask', async () => {
  const t = await setup();
  try {
    const result = await t.page.evaluate(async () => {
      const failures = [], snap = () => JSON.stringify({versions:editor.session.versions.map(v=>v.id),base:editor.session.baseId,mask:editor.session.mask,history:drawing.snapshot().history.length});
      const before = snap();
      for (const result of [
        {mode:'selection',image:await makeImage('edited'),mask:await makeImage('mask'),format:'grayscale'},
        {mode:'image-selection',image:await makeImage('edited'),mask:await makeImage('mask',128,128),format:'grayscale'},
        {mode:'image-selection',image:await makeImage('edited'),mask:await makeImage('empty'),format:'grayscale'},
        {mode:'image',image:new Blob(['bad'],{type:'image/png'})},
        {mode:'image',image:new Blob([new Uint8Array(8*1024*1024+1)],{type:'image/png'})},
      ]) {
        const token=editor.beginExternalEdit();
        try {await editor.applyExternalEdit(token.id,result);} catch(e){failures.push(e.message);}
        if(snap()!==before)throw new Error('partial write');
      }
      let token=editor.beginExternalEdit(); editor.cancelExternalEdit(token.id);
      try{await editor.applyExternalEdit(token.id,{mode:'image',image:original});}catch(e){failures.push(e.message);}
      token=editor.beginExternalEdit(); await editor.applyExternalEdit(token.id,{mode:'image',image:original});
      const after=snap();
      try{await editor.applyExternalEdit(token.id,{mode:'image',image:original});}catch(e){failures.push(e.message);}
      const duplicateUnchanged=after===snap();
      token=editor.beginExternalEdit(); editor.close();
      try{await editor.applyExternalEdit(token.id,{mode:'image',image:original});}catch(e){failures.push(e.message);}
      return {failures,duplicateUnchanged};
    });
    assert.equal(result.failures.length,8); assert.equal(result.duplicateUnchanged,true);
    assert.match(result.failures[0], /图像已修改/); assert.match(result.failures[1], /尺寸/);
    assert.match(result.failures[4], /8MB/); assert.deepEqual(t.errors, []); assert.deepEqual(t.upstream, []);
  } finally { await t.context.close(); }
});

test('PE1 mask import UI and compact manual actions at four widths, retain the session mask across equal-size bases', async () => {
  const t=await setup();
  try {
    await t.page.evaluate(()=>editor.setMode('inpaint'));
    const mask=Buffer.from(await t.page.evaluate(async()=>Array.from(new Uint8Array(await (await makeImage('mask')).arrayBuffer()))));
    const picker=t.page.waitForEvent('filechooser'); await t.page.getByRole('button',{name:'导入黑白蒙版',exact:true}).click();
    await (await picker).setFiles({name:'mask.png',mimeType:'image/png',buffer:mask});
    await t.page.waitForFunction(()=>editor.session.mask.strokes.length===1&&!editor.snapshot().reading);
    await t.page.getByRole('button',{name:'清空蒙版',exact:true}).click();
    await t.page.getByRole('button',{name:'撤销',exact:true}).click();
    assert.equal(await t.page.evaluate(()=>editor.session.mask.position),1);
    await t.page.evaluate(async()=>{const token=editor.beginExternalEdit();await editor.applyExternalEdit(token.id,{mode:'image',image:await makeImage('edited')});});
    await t.page.getByRole('button',{name:'收藏图片',exact:true}).click();
    await t.page.waitForFunction(()=>editor.snapshot().favorite);
    for(const width of [320,390,768,1440]) {
      await t.page.setViewportSize({width,height:900});
      await t.page.waitForFunction(()=>{
        const image=document.querySelector('#editorImage');return image?.complete && image.getBoundingClientRect().width>100;
      });
      await t.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await t.page.screenshot({path:`.local/pe1/editor-${width}-settled.png`});
      assert.equal(await t.page.evaluate(()=>document.querySelector('#imageEditor').scrollWidth<=innerWidth+1),true);
    }
    await t.page.evaluate(()=>editor.setBase(1));
    await t.page.waitForFunction(()=>editor.session.mask.position===1);
    const restored=await t.page.locator('#editorMask').evaluate(canvas=>{
      const ctx=canvas.getContext('2d');return [ctx.getImageData(20,20,1,1).data[3],ctx.getImageData(240,20,1,1).data[3]];
    });
    assert.deepEqual(restored,[255,0]); assert.deepEqual(t.errors,[]); assert.deepEqual(t.upstream,[]);
  } finally {await t.context.close();}
});

test('PE1 in-flight cancellation/session switch discard late pixels; favorite failure remains retryable; CHAT delivery stays explicit', async () => {
  const t=await setup();
  try {
    const result=await t.page.evaluate(async()=>{
      const imageBoard=editor.session.id;
      const edited=await makeImage('edited'), selection=await makeImage('mask'), errors=[];
      const blockDecode=()=>{
        const originalDecode=createImageBitmap;
        let release,started;
        const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
        window.createImageBitmap=async(...args)=>{started();await gate;return originalDecode(...args);};
        return {ready,release:()=>{window.createImageBitmap=originalDecode;release();}};
      };
      let token=editor.beginExternalEdit(), block=blockDecode();
      let work=editor.applyExternalEdit(token.id,{mode:'image-selection',image:edited,mask:selection,format:'grayscale'}).catch(e=>errors.push(e.message));
      await block.ready; editor.cancelExternalEdit(token.id); block.release(); await work;
      const cancelled=editor.session.versions.length;
      token=editor.beginExternalEdit(); block=blockDecode();
      work=editor.applyExternalEdit(token.id,{mode:'image-selection',image:edited,mask:selection,format:'grayscale'}).catch(e=>errors.push(e.message));
      await block.ready; editor.cancelExternalEdit(token.id); await editor.open('chat',original,'chat.png'); block.release(); await work;
      const switched=editor.session.versions.length, chatHistory=drawing.snapshot().history.length;
      token=editor.beginExternalEdit(); await editor.applyExternalEdit(token.id,{mode:'image',image:edited});
      const noAutoHistory=drawing.snapshot().history.length===chatHistory;
      await editor.saveFavorite();
      const explicitHistory=drawing.snapshot().history.length, explicitFavorite=drawing.snapshot().favorites.length;
      editor.switchBoard(imageBoard);
      const add=drawing.toggleFavorite; drawing.toggleFavorite=async()=>{throw new Error('synthetic disk failure');};
      token=editor.beginExternalEdit(); await editor.applyExternalEdit(token.id,{mode:'image',image:edited});
      await editor.saveFavorite();
      const failed={kind:editor.snapshot().base.kind,error:editor.snapshot().runError,history:drawing.snapshot().history.length};
      drawing.toggleFavorite=add; await editor.saveFavorite(); await editor.saveFavorite();
      const retried={history:drawing.snapshot().history.length,error:editor.snapshot().runError};
      return {cancelled,switched,errors,noAutoHistory,explicitHistory,explicitFavorite,failed,retried};
    });
    assert.equal(result.cancelled,1); assert.equal(result.switched,1); assert.equal(result.errors.length,2);
    assert.equal(result.noAutoHistory,true);assert.equal(result.explicitHistory,0);assert.equal(result.explicitFavorite,1);
    assert.equal(result.failed.kind,'manual');assert.match(result.failed.error,/synthetic disk failure/);
    assert.equal(result.failed.history,0);assert.deepEqual(result.retried,{history:0,error:''});
    assert.deepEqual(t.errors,[]);assert.deepEqual(t.upstream,[]);
  } finally {await t.context.close();}
});

test('EDIT canvas mask survives same-size source/view/base/manual changes, and never resurrects after clear or a dimension change', async () => {
  const t = await setup();
  try {
    const result = await t.page.evaluate(async () => {
      const { maskStateBitmap } = await import('/src/native/photopea-input.ts');
      const read = async () => [...(await maskStateBitmap(editor.session.mask)).bits];
      editor.setMode('inpaint');
      await editor.importMask(await makeImage('mask'), 'grayscale');
      const originalMask = await read();
      await editor.applyExternalEdit(editor.beginExternalEdit().id, {mode:'image',image:await makeImage('edited')});
      const a2 = editor.session.baseId;
      const sameSource = JSON.stringify(await read()) === JSON.stringify(originalMask);
      editor.view(1);
      const sameView = JSON.stringify(await read()) === JSON.stringify(originalMask);
      const token = editor.beginExternalEdit();
      await editor.applyExternalEdit(token.id, { mode:'selection', image:original, mask:await (async()=>{const c=new OffscreenCanvas(256,384),x=c.getContext('2d');x.fillStyle='white';x.fillRect(160,32,32,32);return c.convertToBlob({type:'image/png'});})(), format:'alpha' });
      const selectedExisting = editor.session.baseId === 1 && editor.session.versions.length === 2;
      const updatedMask=await read();
      editor.setBase(a2);
      const token2 = editor.beginExternalEdit();
      await editor.applyExternalEdit(token2.id, {mode:'image',image:await makeImage('image')});
      const sameManual = JSON.stringify(await read()) === JSON.stringify(updatedMask);
      return {sameSource,sameView,selectedExisting,sameManual,a2};
    });
    assert.equal(result.sameSource,true); assert.equal(result.sameView,true);
    assert.equal(result.selectedExisting,true); assert.equal(result.sameManual,true);
    await t.page.getByRole('button',{name:'清空蒙版',exact:true}).click();
    await t.page.evaluate(()=>editor.setBase(1));
    assert.equal(await t.page.evaluate(async()=>{const {maskStateBitmap}=await import('/src/native/photopea-input.ts');return (await maskStateBitmap(editor.session.mask)).bits.some(n=>n!==0);}),false);
    await t.page.evaluate(async()=>{
      await editor.importMask(await makeImage('mask'),'grayscale');
      await editor.applyExternalEdit(editor.beginExternalEdit().id,{mode:'image',image:await makeImage('edited',384,256)});
      editor.setBase(1);
    });
    assert.equal(await t.page.evaluate(async()=>{const {maskStateBitmap}=await import('/src/native/photopea-input.ts');return (await maskStateBitmap(editor.session.mask)).bits.some(n=>n!==0);}),false);
    assert.deepEqual(t.errors,[]); assert.deepEqual(t.upstream,[]);
  } finally {await t.context.close();}
});

test('mask-only return on a viewed version switches the base atomically with mask undo/redo', async()=>{
 const t=await setup();
 try{
  const ids=await t.page.evaluate(async()=>{
   editor.setMode('inpaint');await editor.importMask(await makeImage('mask'),'grayscale');
   await editor.applyExternalEdit(editor.beginExternalEdit().id, {mode:'image',image:await makeImage('edited')});const previous=editor.session.baseId;
   editor.view(1);const token=editor.beginExternalEdit();
   const c=new OffscreenCanvas(256,384),x=c.getContext('2d');x.fillStyle='white';x.fillRect(160,32,32,32);
   await editor.applyExternalEdit(token.id,{mode:'mask',image:original,mask:await c.convertToBlob({type:'image/png'}),format:'alpha'});
   return {previous,current:editor.session.baseId,versions:editor.session.versions.length};
  });
  assert.equal(ids.current,1);assert.equal(ids.versions,2);
  await t.page.getByRole('button',{name:'撤销',exact:true}).click();await t.page.waitForFunction(id=>editor.session.baseId===id,ids.previous);
  await t.page.getByRole('button',{name:'重做',exact:true}).click();await t.page.waitForFunction(()=>editor.session.baseId===1);
  assert.deepEqual(t.errors,[]);assert.deepEqual(t.upstream,[]);
 }finally{await t.context.close();}
});
