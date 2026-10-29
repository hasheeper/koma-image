import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from './helpers/vite.mjs';
import { chromium } from 'playwright';
let server, browser, origin;
before(async () => {
  await mkdir('.local/edit-workspace', { recursive: true });
  server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false, hmr: false } });
  await server.listen(); origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });
async function setup(t) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
  await page.goto(origin + '/#/edit'); await page.waitForSelector('#imageEditor');
  await page.evaluate(async () => {
    const p = document.body.__vue_app__._instance.provides;
    for (const name of ['editor', 'drawing', 'chat', 'ask', 'home', 'app-shell'])
      window[name.replace('-', '_')] = p[Object.getOwnPropertySymbols(p).find(k => k.description === name)];
    app_shell.router.switchWorkspace('edit');
    window.makeImage = async (color = '#335577', w = 512, h = 512) => {
      const c = new OffscreenCanvas(w,h), x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0,0,w,h);
      return c.convertToBlob({type:'image/png'});
    };
    window.a = await makeImage();
    await editor.open('image', a, 'A.png', {sourceId:'history:a', settings:{prompt:'A original', seed:7, boardId:'source-a'}});
    window.boardA = editor.session.id;
  });
  return {page, errors};
}
test('EDIT boards isolate same-size masks, fields and versions; reopen restores the existing board and HOME resumes it', {timeout:45000}, async t => {
  const {page, errors} = await setup(t);
  await page.evaluate(async () => {
    editor.setMode('inpaint'); editor.patch({prompt:'A edited', scale:8});
    const c = new OffscreenCanvas(512,512), x = c.getContext('2d'); x.fillStyle='white'; x.fillRect(64,64,128,128);
    await editor.importMask(await c.convertToBlob({type:'image/png'}),'alpha');
    window.maskA = JSON.stringify(editor.session.mask);
    const token = editor.beginExternalEdit(); await editor.applyExternalEdit(token.id, {mode:'image',image:await makeImage('#884466')});
    window.aView = editor.session.viewId;
    await editor.open('image', await makeImage('#227744'), 'B.png', {sourceId:'history:b',settings:{prompt:'B',seed:9}});
    window.boardB = editor.session.id;
  });
  assert.deepEqual(await page.evaluate(() => [editor.boards().length,editor.session.versions.length,editor.session.fields.prompt,editor.session.mask.position]), [2,1,'B',0]);
  await page.evaluate(async () => {
    await editor.open('image', new Blob([a],{type:'image/png'}), 'A again.png', {sourceId:'favorite:a',settings:{prompt:'must not overwrite'}});
  });
  assert.deepEqual(await page.evaluate(() => [editor.session.id===boardA,editor.session.viewId===aView,editor.session.versions.length,editor.session.fields.prompt,editor.session.fields.scale,JSON.stringify(editor.session.mask)===maskA]),[true,true,2,'A edited',8,true]);
  await page.evaluate(() => app_shell.router.switchWorkspace('home'));
  await page.waitForSelector('.home-continue');
  assert.equal(await page.locator('.home-continue').innerText().then(v=>v.includes('继续编辑')), true);
  await page.locator('.home-continue').click(); await page.waitForURL('**/#/edit');
  assert.equal(await page.evaluate(() => editor.session.id===boardA),true);
  assert.equal(await page.locator('#askIsland').isVisible(),true);
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await page.screenshot({path:'.local/edit-workspace/edit-'+width+'.png'});
    assert.equal(await page.locator('#imageEditor').evaluate(e=>e.scrollWidth<=innerWidth),true);
    await page.getByRole('button',{name:'切换编辑画板',exact:true}).click();
    assert.equal(await page.locator('#editBoardMenu').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),true);
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => { editor.switchBoard(boardB); editor.removeBoard(boardA); });
  assert.equal(await page.evaluate(() => editor.boards().length),1);
  assert.deepEqual(errors,[]);
});
test('independent route, settings return and viewport survive workspace navigation', {timeout:30000}, async t => {
  const {page,errors}=await setup(t);
  await page.locator('#editorViewport').click(); await page.keyboard.press('Control+1');
  const zoom=await page.locator('#editorZoomValue').innerText();
  await page.evaluate(()=>app_shell.router.switchWorkspace('image'));
  await page.evaluate(()=>app_shell.router.switchWorkspace('edit'));
  assert.equal(await page.locator('#editorZoomValue').innerText(),zoom);
  await page.evaluate(()=>app_shell.router.openOverlay('settings'));
  await page.waitForSelector('#settingsPanel[open]');
  assert.match(page.url(),/#\/edit\/settings/);
  await page.keyboard.press('Escape'); await page.waitForURL('**/#/edit');
  assert.equal(await page.evaluate(()=>editor.session.id===boardA),true);
  assert.deepEqual(errors,[]);
});

test('EDIT identities survive board switches, trimming, removed versions and direct Slate delivery without #h', {timeout:60000}, async t => {
  const {page, errors} = await setup(t);
  const result = await page.evaluate(async () => {
    const { freezePictureRefs } = await import('/src/ask/edit-context.ts');
    const { parseSlateEdit } = await import('/src/slate/edit.ts');
    const p = document.body.__vue_app__._instance.provides;
    const slates = p[Object.getOwnPropertySymbols(p).find(k => k.description === 'slate')];
    while (!slates.ready.value) await new Promise(r => setTimeout(r, 10));
    const firstScope = ask.externalSnapshot().pictureScope;
    for (let i = 0; i < 3; i++) {
      const token = editor.beginExternalEdit();
      await editor.applyExternalEdit(token.id, {mode:'image', image:await makeImage(`rgb(${100+i},50,70)`)});
    }
    const original = editor.session.versions[0], second = editor.session.versions[1];
    const firstLibrary = ask.externalSnapshot().library, refs = freezePictureRefs(firstLibrary,{page:firstScope,favorites:drawing.favoritesScopeId,ask:'test',chat:'test'});
    await editor.saveFavorite();
    const before = editor.snapshot().viewed;
    await editor.open('edit', await makeImage('#447799'), 'B.png');
    const secondScope = ask.externalSnapshot().pictureScope;
    const oldInfo = ask.pictureInfo('#e2', refs), currentInfo = ask.pictureInfo('#e1');
    const localMissing = ask.pictureInfo('#e2') === null;
    const qualified = ask.pictureInfo('#e1.2');
    const oldCorrect = !!oldInfo && oldInfo.url === qualified.url && oldInfo.url !== currentInfo.url;
    editor.switchBoard(boardA);
    editor.remove(1); const protectedSource = editor.session.versions.includes(original);
    editor.remove(second.id); const removedMissing = ask.pictureInfo('#e2', refs) === null;
    for (let i = 4; i < 37; i++) {
      const token = editor.beginExternalEdit();
      await editor.applyExternalEdit(token.id, {mode:'image', image:await makeImage(`rgb(${100+i},50,70)`)});
    }
    const snapshot = ask.externalSnapshot(), current = editor.snapshot().viewed;
    const picture = snapshot.library.find(p => p.id === current.recordId);
    const change = parseSlateEdit({kind:'slate_edit',op:'create',slate_title:'EDIT direct',todos:[{op:'add',todo_title:'deliver',status:'done',bind:{source:picture.label,caption_source:'base',caption_mode:'full'}}]}, null, drawing.snapshot().form, snapshot.library).change;
    await slates.commit(change);
    const asset = await slates.asset(slates.snapshot().todos[0].binding.assetId);
    const labels = editor.session.versions.map(v => editor.label(v));
    return {firstScope,secondScope,localMissing,oldCorrect,protectedSource,removedMissing,
      history:drawing.snapshot().history.length,current:drawing.snapshot().current,
      size:editor.session.versions.length,first:labels[0],last:labels.at(-1),unique:new Set(labels).size,
      delivered:asset.sourceId===current.recordId && await asset.blob.text()===await current.blob.text(),
      editBoardId:asset.params.editBoardId,originId:asset.params.editOriginId,
      favoriteId:before.recordId,favorites:drawing.snapshot().favorites.map(f=>f.id),
      eInHistory:snapshot.library.some(p=>p.origins.some(o=>o.source==='history'))};
  });
  assert.equal(result.firstScope,result.secondScope);
  for (const key of ['localMissing','oldCorrect','protectedSource','removedMissing','delivered']) assert.equal(result[key],true,key);
  assert.equal(result.history,0); assert.equal(result.current,null); assert.equal(result.eInHistory,false);
  assert.equal(result.size,35); assert.equal(result.unique,35); assert.equal(result.first,'#e1'); assert.equal(result.last,'#e37');
  assert.ok(result.favorites.includes(result.favoriteId)); assert.equal(result.editBoardId,await page.evaluate(()=>boardA)); assert.equal(result.originId,'record:a');
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    await page.screenshot({path:`.local/edit-workspace/identity-${width}.png`});
    assert.equal(await page.locator('#imageEditor').evaluate(e=>e.scrollWidth<=innerWidth),true);
    assert.ok((await page.locator('.editor-rail .tile-id').allTextContents()).includes('#e1'));
  }
  assert.deepEqual(errors,[]);
});

test('general retention settings commit complete values, trim each EDIT board and persist independently', {timeout:60000}, async t => {
  const {page, errors} = await setup(t);
  await page.evaluate(async () => {
    for (let board = 0; board < 2; board++) {
      if (board) await editor.open('edit', await makeImage('#663344'), 'B.png');
      for (let i = 0; i < 6; i++) {
        const token = editor.beginExternalEdit();
        await editor.applyExternalEdit(token.id, {mode:'image', image:await makeImage(`rgb(${100+i},60,90)`,128,128)});
      }
    }
    window.removedUrl = editor.session.versions[1].url;
    app_shell.router.openOverlay('settings', 'general');
  });
  await page.waitForSelector('#editorHistoryLimit');
  assert.equal(await page.locator('#historyLimit').inputValue(), '35');
  assert.equal(await page.locator('#editorHistoryLimit').inputValue(), '35');
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    await page.waitForFunction(() => {
      const r = document.querySelector('#editorHistoryLimit').getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth;
    });
    assert.equal(await page.locator('.history-limit').evaluateAll(fields=>fields.every(field=>{
      const input=field.querySelector('input').getBoundingClientRect(), unit=field.querySelector('span').getBoundingClientRect();
      return unit.left>=input.right && unit.top>=input.top && unit.bottom<=input.bottom;
    })),true,'quantity and unit remain on the same line');
    await page.screenshot({path:`.local/edit-workspace/general-retention-${width}.png`});
  }
  const input = page.locator('#editorHistoryLimit');
  for (const invalid of ['', '-1', '1.5']) {
    await input.fill(invalid); await input.press('Tab');
    assert.equal(await input.inputValue(),'35');
  }
  await input.fill('1');
  assert.deepEqual(await page.evaluate(() => editor.boards().map(s=>s.versions.length)),[7,7], 'typing must not evict intermediate values');
  await input.fill('4'); await input.press('Enter');
  await page.waitForFunction(() => editor.boards().every(s=>s.versions.length===4));
  assert.deepEqual(await page.evaluate(() => editor.boards().map(s=>s.versions.map(v=>v.sequence))),[[1,5,6,7],[1,5,6,7]]);
  assert.equal(await page.evaluate(async()=>{try{await fetch(removedUrl);return false;}catch{return true;}}),true,'evicted original URL is released');
  await page.locator('#historyLimit').fill('3'); await page.locator('#historyLimit').press('Tab');
  await input.fill('0'); await input.press('Tab');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('koma.prefs.v1')).editorHistoryLimit===0);
  await page.keyboard.press('Escape');
  await page.evaluate(async()=>{
    for(let i=0;i<36;i++) {
      const token=editor.beginExternalEdit();
      await editor.applyExternalEdit(token.id,{mode:'image',image:await makeImage(`rgb(${160+i},60,90)`,128,128)});
    }
  });
  assert.equal(await page.evaluate(()=>editor.session.versions.length),40,'zero disables the cap');
  const other=await page.context().newPage();
  await other.goto(origin+'/#/edit/settings/general');
  await other.waitForSelector('#editorHistoryLimit');
  assert.equal(await other.locator('#historyLimit').inputValue(),'3');
  assert.equal(await other.locator('#editorHistoryLimit').inputValue(),'0');
  await other.locator('#editorHistoryLimit').fill('6'); await other.locator('#editorHistoryLimit').press('Tab');
  await page.waitForFunction(()=>drawing.snapshot().form.editorHistoryLimit===6 && editor.session.versions.length===6);
  await page.reload();
  await page.evaluate(()=>location.hash='#/edit/settings/general');
  await page.waitForSelector('#editorHistoryLimit');
  assert.equal(await page.locator('#editorHistoryLimit').inputValue(),'6');
  assert.equal(await page.locator('#historyLimit').inputValue(),'3');
  assert.deepEqual(errors,[]);
});
