import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
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
  assert.equal(await page.locator('#askIsland').isVisible(),false);
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
