import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
let server, browser, origin;
before(async () => {
  await mkdir('.local/hm2', {recursive:true});
  server = await createServer({server:{host:'127.0.0.1',port:0,open:false}}); await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`; browser = await chromium.launch({headless:true});
});
after(async () => { await browser?.close(); await server?.close(); });
async function bind(page) {
  await page.waitForSelector('[data-workspace-root]');
  await page.evaluate(async () => {
    const p = document.body.__vue_app__._instance.provides;
    for (const name of ['drawing','chat','home','editor','ask','slate','bridge','app-shell']) window[name.replace('-','_')] = p[Object.getOwnPropertySymbols(p).find(k=>k.description===name)];
    await home.ready;
  });
}
async function setup({seed=true,connection=true,path='/',width=1440}={}) {
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}), page=await context.newPage(), errors=[], requests=[];
  page.on('pageerror', e=>errors.push(e.message)); page.setDefaultTimeout(10000);
  await context.addInitScript(connection=>{
    const NativeObserver=window.ResizeObserver;
    window.homeObservers=new Set();
    window.ResizeObserver=class extends NativeObserver {
      observe(target,options){if(target.matches?.('.home-page'))homeObservers.add(this);return super.observe(target,options);}
      disconnect(){homeObservers.delete(this);return super.disconnect();}
    };
    if (connection && !localStorage.getItem('koma.routing.v1')) {
      localStorage.setItem('koma.routing.v1',JSON.stringify({version:1,links:{},connections:{image:{id:'image',name:'测试图像',baseUrl:'https://home.example.test',profileId:'koma-standard-v1',credentialRef:'test-key',revision:'r1'}}}));
      sessionStorage.setItem('koma.session.keys',JSON.stringify({'test-key':'synthetic'}));
      localStorage.setItem('koma.prefs.v1',JSON.stringify({tagSuggest:false}));
    }
    FileSystemHandle.prototype.queryPermission=async()=>'granted';
    FileSystemHandle.prototype.requestPermission=async()=>'granted';
    window.showDirectoryPicker=async()=>{const root=await navigator.storage.getDirectory();return root.getDirectoryHandle('home-collab',{create:true});};
  },connection);
  await context.route('**/*',route=>{
    const u=new URL(route.request().url()); if(u.origin===origin)return route.continue(); requests.push(u.pathname);
    if(u.hostname==='home.example.test') {
      if(u.pathname.endsWith('/image/models'))return route.fulfill({json:{studio_features:{version:2,max_cost:true},valid_samplers:['k_euler_ancestral'],models:{'nai-diffusion-4-5-full':{name:'NAI 4.5',provider:'novelai',max_resolution:2200000,quota_group:'novelai'}}}});
      if(u.pathname.endsWith('/media/quota'))return route.fulfill({json:{credits:{remaining:100},images:{novelai:{remaining:100,limit:100}}}});
      if(u.pathname.endsWith('/token_stats_data'))return route.fulfill({json:{}});
      if(u.pathname.includes('cost')||u.pathname.endsWith('/image/estimate'))return route.fulfill({json:{cost:1}});
    }
    errors.push(`Unexpected request ${u}`);return route.abort();
  });
  await page.goto(origin+path); await bind(page);
  if(seed) await page.evaluate(async()=>{
    window.art = async(w,h,index=0)=>{
      const canvas=new OffscreenCanvas(w,h),x=canvas.getContext('2d');
      const palettes=[['#8aaaba','#eee0b9','#2b4c5c'],['#a5a3b5','#f5c8a0','#39394e'],['#9fb09b','#e9d8a3','#2d4540'],['#cc9f9a','#ffe8b3','#503f4d']];
      const p=palettes[index%palettes.length];x.fillStyle=p[0];x.fillRect(0,0,w,h);
      x.fillStyle=p[1];x.beginPath();x.arc(w*.72,h*.26,Math.min(w,h)*.13,0,Math.PI*2);x.fill();
      x.fillStyle=p[2];x.beginPath();x.moveTo(0,h*.65);x.lineTo(w*.28,h*.3);x.lineTo(w*.58,h*.7);x.lineTo(w*.82,h*.48);x.lineTo(w,h*.66);x.lineTo(w,h);x.lineTo(0,h);x.fill();
      x.fillStyle=p[1];x.fillRect(w*.2,h*.72,w*.15,h*.14);x.fillStyle=p[0];x.fillRect(w*.26,h*.78,w*.035,h*.08);
      return canvas.convertToBlob({type:'image/png'});
    };
    window.boardA=drawing.snapshot().activeBoardId; await drawing.renameBoard(boardA,'雨后的山间小屋');
    const boardB=await drawing.createBoard(); await drawing.renameBoard(boardB,'月夜海岸'); await drawing.switchBoard(boardA);
    for(const [i,r] of [2.4,.684,1,1.8,.75,1.4,.55,2,.8].entries()){
      const w=Math.round(420*r),h=420,boardId=i===0||i>4?boardB:boardA;
      const item=await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing, home:window.home}, await art(w,h,i),{width:w,height:h},{boardId,model:'nai-diffusion-4-5-full',prompt:'synthetic rendered prompt',basePrompt:'synthetic base prompt',width:w,height:h,seed:100+i,scale:5,steps:28},null);
      await drawing.toggleFavorite(item);
    }
    const {parseSlateEdit}=await import('/src/slate/edit.ts');
    await slate.commit(parseSlateEdit({kind:'slate_edit',op:'create',slate_title:'小屋与海岸',todos:[{op:'add',todo_title:'雨后小屋',status:'in_progress'},{op:'add',todo_title:'海岸夜景'}]},null,drawing.snapshot().form,ask.externalSnapshot().library).change);
    await home.store.flush();
  });
  return {page,context,errors,requests};
}
function clean(t){assert.deepEqual(t.errors,[]);assert.ok(!t.requests.some(p=>/generate|\/edit$|upscale|chat\/completions/.test(p)));return t.context.close();}

test('HOME default and unknown routes, first-use head, settings overlay and existing deep links',async()=>{
  const t=await setup({seed:false,connection:false});const {page}=t;
  try {
    assert.match(page.url(),/#\/home\/settings\/connections$/);await page.locator('#settingsPanel .set-back').click();
    await page.waitForURL('**/#/home'); assert.equal(await page.locator('.home-section').count(),0);assert.equal(await page.locator('.topbar:visible').count(),0);
    await page.goto(origin+'/?cold=1#/unknown');await bind(page);await page.waitForURL(/#\/home\/settings\/connections$/);
    await page.goto(origin+'/#/image/settings/backup');await page.waitForSelector('#settingsPanel[open]');assert.match(page.url(),/#\/image\/settings\/backup$/);
    await page.goto(origin+'/#/home/editor');await bind(page);await page.waitForSelector('#imageEditor[data-active=true]');
    await page.evaluate(()=>app_shell.router.switchWorkspace('home'));await page.waitForURL('**/#/home');
    assert.equal(await page.locator('.home-page').count(),1);
  } finally {await clean(t);}
});

test('HOME empty state uses the selected full-page glow and preserves ASK versus background image paste',async()=>{
  const t=await setup({seed:false});const {page}=t;
  try {
    await page.waitForSelector('.home-welcome');
    assert.equal(await page.evaluate(()=>home.snapshot().loaded),true);
    assert.equal(await page.locator('.home-welcome h2').innerText(),'这里还空着呢');
    assert.equal(await page.locator('.home-welcome p').innerText(),'有个想法？快去试试吧。');
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      const geometry=await page.evaluate(()=>{
        const card=document.querySelector('.home-welcome'),form=document.querySelector('.home-ask'),brand=document.querySelector('.home-brand');
        const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height};};
        return {card:rect(card),form:rect(form),brand:rect(brand),art:rect(card.querySelector('img')),width:innerWidth,scroll:document.documentElement.scrollWidth,
          background:getComputedStyle(document.querySelector('.home-shell'),'::before').backgroundImage,cardBackground:getComputedStyle(card).backgroundImage,
          entries:[...document.querySelectorAll('.home-entries button')].map(b=>b.getBoundingClientRect().top)};
      });
      assert.ok(geometry.scroll<=width+1,`empty state overflow at ${width}`);
      assert.equal(geometry.art.width,80);assert.equal(geometry.card.height,width<=860?160:176);
      assert.ok(Math.abs(geometry.card.width-geometry.form.width)<1);
      assert.ok(Math.abs((geometry.brand.left+geometry.brand.right)/2-width/2)<1);
      assert.equal(new Set(geometry.entries).size,1,'all four entries stay on one row');
      assert.match(geometry.background,/radial-gradient/);assert.equal(geometry.cardBackground,'none');
      await page.screenshot({path:`.local/hm2/home-empty-${width}.png`,fullPage:true});
    }
    await page.evaluate(async()=>{
      const canvas=new OffscreenCanvas(64,96),g=canvas.getContext('2d');g.fillStyle='#667788';g.fillRect(0,0,64,96);
      window.pastedImage=new File([await canvas.convertToBlob({type:'image/png'})],'empty-home.png',{type:'image/png'});
      const data=new DataTransfer();data.items.add(pastedImage);
      document.querySelector('.home-ask textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    });
    await page.waitForSelector('#askIsland[data-home="half"]');
    assert.equal(await page.evaluate(()=>editor.boards().filter(b=>b.versions.length).length),0,'ASK paste must not open EDIT');
    await page.evaluate(()=>ask.hide());await page.waitForSelector('.home-welcome');
    await page.evaluate(()=>{
      const data=new DataTransfer();data.items.add(pastedImage);
      document.querySelector('.home-page').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    });
    await page.waitForSelector('#imageEditor[data-active=true]');
    assert.equal(await page.evaluate(()=>editor.boards().filter(b=>b.versions.length).length),1);
    await page.evaluate(()=>app_shell.router.switchWorkspace('home'));await page.waitForSelector('.home-face img');
    assert.equal(await page.locator('.home-welcome').count(),0);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.home-shell'),'::before').opacity),'0');
    await page.evaluate(()=>app_shell.router.switchWorkspace('image'));await page.waitForSelector('#prompt');
    const boards=await page.evaluate(()=>editor.boards().length);
    await page.evaluate(()=>{
      const data=new DataTransfer();data.items.add(pastedImage);
      document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    });
    assert.equal(await page.evaluate(()=>editor.boards().length),boards,'deactivated HOME must release its paste listener');
  } finally {await clean(t);}
});

test('HOME never flashes the empty card while restoring existing pictures',async()=>{
  const t=await setup();const {page}=t;
  try {
    await page.context().addInitScript(()=>{
      window.emptyCardSeen=false;
      new MutationObserver(()=>{if(document.querySelector('.home-welcome'))emptyCardSeen=true;}).observe(document,{subtree:true,childList:true});
    });
    await page.reload();await bind(page);await page.waitForSelector('.home-print');
    assert.equal(await page.evaluate(()=>home.snapshot().loaded),true);
    assert.equal(await page.evaluate(()=>emptyCardSeen),false);
    assert.equal(await page.locator('.home-welcome').count(),0);
  } finally {await clean(t);}
});

test('real directory, three layouts and responsive prints at 320/390/768/1440',async()=>{
  const t=await setup();const {page}=t;
  try {
    await page.getByRole('button',{name:'挂载协同目录',exact:true}).first().click();
    await page.waitForFunction(()=>bridge.phase.value==='active');assert.equal(await page.locator('.home-settings .directory-chip span').innerText(),'home-collab');
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});await page.waitForFunction(w=>Math.abs(document.querySelector('.home-page').clientWidth-(w<=860?w-32:Math.min(w*.84,1080)))<2,width);
      assert.equal(await page.locator('.home-finals').getAttribute('data-layout'),width<=860?'cols':'rows');
      for(const [name,mode] of [['行对齐','rows'],['列对齐','cols'],['拼图','mosaic']]) {
        await page.getByRole('button',{name,exact:true}).click();await page.waitForFunction(mode=>document.querySelector('.home-finals').dataset.layout===mode,mode);
        const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,prints:[...document.querySelectorAll('.home-print')].map(b=>{const r=b.getBoundingClientRect(),img=b.querySelector('img');return {w:r.width,h:r.height,right:r.right,left:r.left,ratio:img.naturalWidth/img.naturalHeight};})}));
        assert.ok(geometry.scroll<=width+1,`overflow at ${width} ${mode}`);
        for(const p of geometry.prints){assert.ok(p.left>=-1&&p.right<=width+1);assert.ok(Math.abs(p.w/p.h-p.ratio)<.01);}
        await page.screenshot({path:`.local/hm2/home-${width}-${mode}.png`,fullPage:true});
      }
      await page.evaluate(()=>home.store.setLayout(null));
    }
    await page.getByRole('button',{name:'拼图',exact:true}).click();await page.waitForFunction(()=>home.snapshot().preferences.layout==='mosaic');await page.evaluate(()=>home.store.flush());await page.reload();await bind(page);
    await page.waitForFunction(()=>document.querySelector('.home-finals').dataset.layout==='mosaic');assert.equal(await page.locator('.home-print').count(),9);
    assert.equal(await page.evaluate(()=>drawing.snapshot().history.length),0);
    assert.equal(await page.evaluate(()=>home.snapshot().current.face.kind),'preview');
    await page.locator('.home-continue').click();await page.waitForSelector('#prompt');assert.equal(await page.evaluate(()=>drawing.snapshot().current),null);
  } finally {await clean(t);}
});

test('HOME navigation preserves KeepAlive drafts, scroll and EDIT session; shortcuts ignore controls and IME',async()=>{
  const t=await setup();const {page}=t;
  try {
    await page.locator('.home-continue').click();await page.waitForSelector('#prompt');
    await page.locator('#prompt').fill('preserved workspace draft');const node=await page.locator('#prompt').elementHandle();
    await page.keyboard.press('g');assert.match(page.url(),/#\/image$/);assert.match(await page.locator('#prompt').inputValue(),/g$/);
    await page.locator('#prompt').fill('preserved workspace draft');await page.locator('#prompt').blur();await page.keyboard.press('g');await page.waitForURL('**/#/home');
    await page.locator('.home-ask textarea').fill('shared ASK draft');await page.keyboard.press('g');assert.match(page.url(),/#\/home$/);await page.locator('.home-ask textarea').blur();
    await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'g',isComposing:true,bubbles:true})));assert.match(page.url(),/#\/home$/);
    await page.evaluate(()=>window.scrollTo(0,500));const scroll=await page.evaluate(()=>scrollY);
    await page.keyboard.press('g');await page.waitForURL('**/#/image');assert.equal(await page.locator('#prompt').inputValue(),'preserved workspace draft');assert.ok(await node.evaluate(n=>n===document.getElementById('prompt')));
    await page.keyboard.press('g');await page.waitForURL('**/#/home');await page.waitForFunction(y=>Math.abs(scrollY-y)<2,scroll);
    await page.evaluate(()=>document.querySelector('.home-page').focus());await page.keyboard.press('Enter');await page.waitForURL('**/#/image');
    await page.evaluate(async()=>{await editor.open('image',await art(256,384),'local.png');editor.patch({prompt:'kept editor fields'});});
    await page.waitForSelector('#imageEditor[data-active=true]');const editorNode=await page.locator('#imageEditor').elementHandle();
    const id=await page.evaluate(()=>editor.session.id);await page.evaluate(()=>app_shell.router.switchWorkspace('home'));await page.waitForURL('**/#/home');
    await page.locator('.home-continue').click();await page.waitForSelector('#imageEditor[data-active=true]');assert.equal(await page.evaluate(()=>editor.session.id),id);assert.equal(await page.evaluate(()=>editor.session.fields.prompt),'kept editor fields');assert.ok(await editorNode.evaluate(n=>n===document.getElementById('imageEditor')));
    await page.evaluate(()=>app_shell.router.switchWorkspace('image'));await page.waitForSelector('#imageEditor',{state:'hidden'});
    await page.locator('.switcher:visible').click();assert.equal(await page.locator('.switch-menu:popover-open a').first().getAttribute('href'),'#/home');
  } finally {await clean(t);}
});

test('finals reuse the real cover/favorite/recipe/delivery paths and the shared ASK input',async()=>{
  const t=await setup();const {page}=t;
  try {
    await page.locator('.home-ask textarea').fill('same conversation text\nsecond line');await page.getByRole('button',{name:'打开 ASK',exact:true}).click();await page.waitForSelector('#askPrompt',{state:'visible'});assert.equal(await page.locator('#askPrompt').inputValue(),'same conversation text\nsecond line');
    await page.evaluate(()=>ask.hide());await page.locator('.home-print').first().click();await page.waitForSelector('.home-viewer[open]');
    await page.getByRole('button',{name:'设为封面',exact:true}).click();await page.getByRole('button',{name:'恢复最近图片为封面',exact:true}).waitFor();assert.equal(await page.evaluate(()=>Object.keys(home.snapshot().preferences.covers).length),1);
    await page.getByRole('button',{name:'交付到任务',exact:true}).click();await page.getByRole('menuitem',{name:'雨后小屋',exact:true}).click();await page.waitForSelector('.slate-delivery[open]');assert.ok(await page.locator('.delivery-pictures [aria-pressed="true"]').count());
    await page.getByRole('combobox',{name:'标注来源'}).selectOption('base');await page.getByRole('button',{name:'交付到任务',exact:true}).last().click();await page.waitForFunction(()=>!!slate.snapshot().todos[0].binding);
    await page.getByRole('button',{name:'读取参数到绘图',exact:true}).click();await page.waitForURL('**/#/image');assert.equal(await page.locator('#prompt').inputValue(),'synthetic base prompt');
    await page.evaluate(()=>app_shell.router.switchWorkspace('home'));await page.waitForSelector('.home-page');await page.locator('.home-print').first().click();await page.getByRole('button',{name:'取消收藏',exact:true}).click();await page.waitForFunction(()=>drawing.snapshot().favorites.length===8);assert.equal(await page.locator('.home-print').count(),8);assert.equal(await page.evaluate(()=>Object.keys(home.snapshot().preferences.covers).length),0);
  } finally {await clean(t);}
});


test('CHAT lines locate their actual version; CHAT finals keep recipes disabled and hand off original bytes',async()=>{
  const t=await setup();const {page}=t;
  try {
    await page.evaluate(async()=>{
      const {beginTurn,beginVersion,completeVersion,contextSnapshot}=await import('/src/domain/conversation.ts');
      const a=await chat.assets.add(await art(420,420,1),'chat-a.png',{width:420,height:420});
      const b=await chat.assets.add(await art(420,420,2),'chat-b.png',{width:420,height:420});
      chat.mutate(c=>{
        c.title='合成对话';const {turn,version}=beginTurn(c,contextSnapshot(c,'test',1),'first',c.settings);
        completeVersion(c,turn,version,[{type:'image',assetId:a.id}],null,c.selectionRevision);
        version.completedAt=Date.now()-1000;
        const next=beginVersion(turn);completeVersion(c,turn,next,[{type:'image',assetId:b.id}],null,c.selectionRevision);
        window.chatTurnId=turn.id;window.chatVersionId=next.id;window.chatAssetId=b.id;
      },true);
      await chat.flush();await home.store.remember('chat');
      const c=chat.snapshot().current;
      await drawing.toggleFavorite(await chat.favoriteRecord(c.id,chatTurnId,chatVersionId,chatAssetId));
    });
    await page.getByRole('button',{name:'查看最近图片 1',exact:true}).click();await page.waitForURL(/#\/chat$/);
    assert.equal(await page.evaluate(()=>chat.snapshot().current.turns[0].selectedVersion),0);
    await page.evaluate(()=>app_shell.router.switchWorkspace('home'));await page.locator('.home-print').first().click();
    assert.match(await page.locator('.home-viewer header').innerText(),/#f/);
    assert.equal(await page.getByRole('button',{name:'读取参数到绘图'}).count(),0);
    const before=await page.evaluate(async()=>[...new Uint8Array(await drawing.snapshot().favorites[0].blob.arrayBuffer())]);
    await page.getByRole('button',{name:'送去对话',exact:true}).click();await page.waitForURL(/#\/chat$/);
    await page.waitForFunction(()=>!!chat.snapshot().current.mainId||chat.snapshot().current.attachments.length>0);
    const bytes=await page.evaluate(async()=>{const c=chat.snapshot().current,id=c.mainId||c.attachments[0];return [...new Uint8Array(await chat.assets.get(id).blob.arrayBuffer())];});
    assert.deepEqual(bytes,before);
    await page.evaluate(async()=>{
      app_shell.router.switchWorkspace('home');await home.store.remember('image');
      const c=chat.snapshot().current;
      await editor.open('chat',chat.assets.get(c.mainId||c.attachments[0]).blob,'local.png',{conversationId:c.id});
    });
    await page.waitForSelector('#imageEditor[data-active=true]');await page.evaluate(()=>app_shell.router.switchWorkspace('home'));
    await page.waitForFunction(()=>app_shell.router.route.value.overlay===null && home.snapshot().preferences.lastLocation.workspace==='edit');
    assert.equal(await page.locator('.home-continue').innerText().then(t=>t.trim()),'继续编辑');
  } finally {await clean(t);}
});


test('HOME observers pause during repeated KeepAlive exits; native image state and menu nodes stay owned',async()=>{
  const t=await setup();const {page}=t;
  try {
    const node=await page.locator('.home-page').elementHandle();
    for(let i=0;i<6;i++) {
      await page.evaluate(()=>app_shell.router.switchWorkspace('image'));await page.waitForSelector('#prompt');
      assert.equal(await page.evaluate(()=>homeObservers.size),0);
      await page.evaluate(()=>app_shell.router.switchWorkspace('home'));await page.waitForSelector('.home-page');
      assert.equal(await page.evaluate(()=>homeObservers.size),1);
      assert.ok(await node.evaluate(n=>n===document.querySelector('.home-page')));
    }
    await page.getByRole('button',{name:'挂载协同目录',exact:true}).first().click();await page.waitForFunction(()=>bridge.phase.value==='active');
    await page.locator('.home-settings .directory-chip').click();await page.getByRole('menu',{name:'协同目录',exact:true}).waitFor();
    await page.evaluate(()=>app_shell.router.switchWorkspace('image'));await page.waitForSelector('#prompt');
    assert.equal(await page.getByRole('menu',{name:'协同目录',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>homeObservers.size),0);
  } finally {await clean(t);}
});
