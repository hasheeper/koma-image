import { before, after, test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
let server,browser,origin;
before(async()=>{server=await createServer({server:{host:'127.0.0.1',port:0,open:false,hmr:false}});await server.listen();origin=`http://127.0.0.1:${server.httpServer.address().port}`;browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await server?.close();});
async function init(page){
  await page.goto(origin+'/#/image');
  await page.waitForFunction(()=>document.body.__vue_app__?._instance?.provides);
  await page.evaluate(async()=>{
    const p=document.body.__vue_app__._instance.provides;
    for(const [name,key] of [['app','application-services'],['drawing','drawing'],['editor','editor'],['chat','chat'],['ask','ask'],['slates','slate'],['shell','app-shell']]) window[name]=p[[...Object.getOwnPropertySymbols(p),...Object.getOwnPropertySymbols(document.body.__vue_app__._context.provides)].find(k=>k.description===key)];
    await app.start();while(drawing.snapshot().favoritesLoading)await new Promise(r=>setTimeout(r,10));
    await drawing.reloadFavorites();
    shell.router.closeOverlay();
    window.makeImage=async(n=1)=>{const c=new OffscreenCanvas(128,128),g=c.getContext('2d');g.fillStyle=`rgb(${n},60,80)`;g.fillRect(0,0,128,128);return c.convertToBlob({type:'image/png'});};
    window.ids=await import('/src/services/image-identities.ts');window.db=await import('/src/storage/databases.ts');window.names=(await import('/src/storage/names.ts')).names;
    window.add=async(id,n=1)=>{const blob=await makeImage(n),entity_key=await (await import('/src/domain/image-identity.ts')).imageEntity(blob);return app.data.write(async()=>{const tx=app.databases.transaction(names.databases.favorites,ids.identityStores,'readwrite'),done=db.transactionDone(tx);const row=await ids.assignFavorite(tx,{id,blob,entity_key,createdAt:n,favoritedAt:n,thumbBlob:null,params:{seed:n,prompt:id},size:{width:128,height:128}});await done;return row;});};
  });
}
async function setup(t){const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});t.after(()=>context.close());await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());const page=await context.newPage();await init(page);return {page,context};}
test('current Koma favorites backfill preserves fixed numbers and unambiguous ASK mappings, and is idempotent',async t=>{
 const {page}=await setup(t);
 const result=await page.evaluate(async()=>{
   const rows=await Promise.all(['old-a','old-b','ambiguous','fixed'].map(async(id,i)=>({id,blob:await makeImage(i+1),createdAt:i+1,favoritedAt:i+1,thumbBlob:null,params:{seed:i},size:{width:128,height:128},...(id==='fixed'?{favSeq:12}:{})})));
   await app.data.write(async()=>{
     const tx=app.databases.transaction(names.databases.favorites,ids.identityStores,'readwrite'),done=db.transactionDone(tx);
     tx.objectStore('identity').clear();tx.objectStore('favoriteTags').clear();
     for(const row of rows)tx.objectStore('favorites').put(row);
     await done;
     const askTx=app.databases.transaction(names.databases.ask,'conversations','readwrite'),askDone=db.transactionDone(askTx);
     askTx.objectStore('conversations').put({id:'old-context-a',scope:{labels:{favoriteSeqs:[{id:'old-a',seq:4},{id:'old-b',seq:7},{id:'ambiguous',seq:8}]}}});
     askTx.objectStore('conversations').put({id:'old-context-b',scope:{labels:{favoriteSeqs:[{id:'old-a',seq:4},{id:'old-b',seq:7},{id:'ambiguous',seq:9}]}}});
     await askDone;
   });
   await app.data.write(()=>ids.initializeFavoriteIdentity(app.databases));
   const first=await ids.readFavoriteIdentity(app.databases);
   await app.data.write(()=>ids.initializeFavoriteIdentity(app.databases));
   const second=await ids.readFavoriteIdentity(app.databases);
   const tx=app.databases.transaction(names.databases.favorites,'favorites'),saved=await db.idbRequest(tx.objectStore('favorites').getAll());
   return {first,second,rows:saved.map(r=>[r.id,r.favSeq]),valid:saved.every(r=>/^sha256:[a-f0-9]{64}$/.test(r.entity_key))};
 });
 assert.deepEqual(result.rows,[['ambiguous',13],['fixed',12],['old-a',4],['old-b',7]]);
 assert.equal(result.valid,true);assert.equal(result.first.state.nextFavSeq,14);assert.deepEqual(result.first,result.second);
});
test('persistent favorite numbers: deletion, undo, re-favorite, empty library and refresh',async t=>{
 const {page}=await setup(t);
 const r=await page.evaluate(async()=>{
   const a=await add('a'),b=await add('b',2),c=await add('c',3);
   const retire=id=>app.data.write(async()=>{const tx=app.databases.transaction(names.databases.favorites,ids.identityStores,'readwrite'),done=db.transactionDone(tx);await ids.retireFavorite(tx,id);await done;});
   await retire('b'); const d=await add('d',4);
   await app.data.write(async()=>{const tx=app.databases.transaction(names.databases.favorites,ids.identityStores,'readwrite'),done=db.transactionDone(tx);await ids.assignFavorite(tx,b,true);await done;});
   await drawing.reloadFavorites();const undo=drawing.snapshot().favorites.find(r=>r.id==='b').favSeq;
   await retire('b');const fresh=await add('b',2);
   for(const id of ['a','b','c','d'])await retire(id);
   const next=await add('next',8),state=await ids.readFavoriteIdentity(app.databases);
   return {numbers:[a.favSeq,b.favSeq,c.favSeq,d.favSeq],undo,fresh:fresh.favSeq,next:next.favSeq,library:state.state.libraryId};
 });
 assert.deepEqual(r.numbers,[1,2,3,4]);assert.equal(r.undo,2);assert.equal(r.fresh,5);assert.equal(r.next,6);
 await init(page);
 assert.deepEqual(await page.evaluate(()=>[drawing.snapshot().favorites[0].favSeq,ask.favoriteLabelFor('next'),drawing.favoritesScopeId]),[6,'#f6',r.library]);
});
test('IDB serializes two tabs, including duplicate record writes',async t=>{
 const {page,context}=await setup(t),other=await context.newPage();await init(other);
 const [a,b]=await Promise.all([page.evaluate(()=>add('tab-a')),other.evaluate(()=>add('tab-b',2))]);assert.notEqual(a.favSeq,b.favSeq);
 const [x,y]=await Promise.all([page.evaluate(()=>add('same',3)),other.evaluate(()=>add('same',3))]);assert.equal(x.favSeq,y.favSeq);
 assert.equal((await page.evaluate(()=>ids.readFavoriteIdentity(app.databases))).state.nextFavSeq,4);
});
test('v2 backup restores pristine library identity, merges foreign numbers and stays idempotent',async t=>{
 const {page,context}=await setup(t);
 const snapshot=await page.evaluate(async()=>{await add('one');await add('two',2);const out=await app.backup.export();const bytes=[...new Uint8Array(await out.blob.arrayBuffer())];return {bytes,identity:await ids.readFavoriteIdentity(app.databases)};});
 // A different browser storage origin is a genuinely pristine library.
 const clean=await browser.newContext();t.after(()=>clean.close());await clean.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());const target=await clean.newPage();await init(target);
 const result=await target.evaluate(async bytes=>{const checked=await app.backup.read(new Blob([new Uint8Array(bytes)]));await app.backup.import(checked);const before=await ids.readFavoriteIdentity(app.databases);await app.backup.import(checked);return {before,after:await ids.readFavoriteIdentity(app.databases),seq:drawing.snapshot().favorites.map(r=>r.favSeq).sort()};},snapshot.bytes);
 assert.equal(result.before.state.libraryId,snapshot.identity.state.libraryId);assert.deepEqual(result.seq,[1,2]);assert.deepEqual(result.before,result.after);
 const foreign=await browser.newContext();t.after(()=>foreign.close());await foreign.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());const p=await foreign.newPage();await init(p);
 const merge=await p.evaluate(async bytes=>{await add('local',9);const library=(await ids.readFavoriteIdentity(app.databases)).state.libraryId;const checked=await app.backup.read(new Blob([new Uint8Array(bytes)]));await app.backup.import(checked);await app.backup.import(checked);return {library,identity:await ids.readFavoriteIdentity(app.databases),rows:drawing.snapshot().favorites.map(r=>[r.id,r.favSeq]).sort()};},snapshot.bytes);
 assert.equal(merge.library,merge.identity.state.libraryId);assert.deepEqual(merge.rows,[['local',1],['one',2],['two',3]]);
 await context.close();
});
test('same original shares entity and favorite, recipes remain per record, vision aliases share eligibility and charge sends',async t=>{
 const {page}=await setup(t);
 const r=await page.evaluate(async()=>{
   const blob=await makeImage(),h=await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing, home:window.home}, blob,{width:128,height:128},{seed:7,prompt:'source'},null);
   await drawing.toggleFavorite(h);await editor.open('image',blob,'source.png',{sourceId:`history:${h.id}`,settings:h.params});await editor.saveFavorite();
   const snapshot=ask.externalSnapshot(),p=snapshot.library.find(p=>p.id===h.id);
   const v=(await import('/src/ask/vision.ts')).createVision(), budget={calls:0,pixels:0,bytes:0}, context={signal:new AbortController().signal,metadataOnly:false,budget,viewed:new Set()};
   const first=await v.image({...p,label:'#h1'},'glance',undefined,context);
   const same=await v.image({...p,label:'#e1.1',blob:new Blob([blob],{type:blob.type})},'glance',undefined,context);
   await v.image({...p,label:'#f1'},'crop',[20,20,10,10],context);
   await v.image(p,'look',undefined,context);const calls=budget.calls;
   await v.image(p,'look',undefined,context,true);let exceeded=false;try{await v.image(p,'crop',[10,10,20,20],context);}catch{exceeded=true;}
   let newConversation=false;try{await v.image(p,'crop',[20,20,10,10],{...context,budget:{calls:0,pixels:0,bytes:0},viewed:new Set()});}catch{newConversation=true;}
   const next=await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing, home:window.home}, blob,{width:128,height:128},{seed:9,prompt:'distinct event'},null);
   const {createTools}=await import('/src/ask/tools.ts'),lib=ask.externalSnapshot().library;
   const meta=await createTools().get('get_meta').run({id:'#h2'},{library:lib});
   const sheetContext={library:lib,vision:v,metadataOnly:false,visual:{...context,budget:{calls:0,pixels:0,bytes:0}}};
   const sheet=createTools().get('view_sheet');await sheet.run({ids:['#h1','#h2']},sheetContext);
   const repeatedSheet=await sheet.run({ids:['#h1','#h2']},sheetContext);
   v.dispose();return {aliases:p.aliases,key:h.entity_key,editKey:editor.session.versions[0].entity_key,record:editor.session.versions[0].recordId,favorites:drawing.snapshot().favorites.length,first:!!first.image,duplicate:same.duplicate,calls,final:budget.calls,exceeded,newConversation,sameEntity:h.entity_key===next.entity_key,metadata:meta.content[0].text,repeatedSheet,sheetCalls:sheetContext.visual.budget.calls};
 });
 assert.equal(r.editKey,r.key);assert.equal(r.favorites,1);assert.ok(r.aliases.includes('#e1.1'));assert.ok(r.aliases.includes('#f1'));assert.equal(r.first,true);assert.equal(r.duplicate,true);assert.equal(r.calls,3);assert.equal(r.final,4);assert.equal(r.exceeded,true);assert.equal(r.newConversation,true);assert.equal(r.sameEntity,true);assert.match(r.metadata,/"seed":9/);
 assert.equal(r.sheetCalls,1);assert.equal(r.repeatedSheet.stat,'本轮已查看');assert.match(r.repeatedSheet.content[0].text,/already_viewed_this_turn/);assert.equal(r.repeatedSheet.content.some(c=>c.type==='image'),false);
});
test('an original registered in history and EDIT retains its recipe when delivered through any alias',async t=>{
 const {page}=await setup(t);
 const r=await page.evaluate(async()=>{
   const h=await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing, home:window.home}, await makeImage(),{width:128,height:128},{seed:7,prompt:'original recipe'},null);
   await editor.open('image',h.blob,'source.png',{sourceId:`history:${h.id}`,settings:h.params});await editor.saveFavorite();
   const snap=ask.externalSnapshot(),p=snap.library.find(p=>p.id===h.id),{parseSlateEdit}=await import('/src/slate/edit.ts');
   const change=parseSlateEdit({kind:'slate_edit',op:'create',slate_title:'Original delivery',todos:[{op:'add',todo_title:'Done',status:'done',bind:{source:'#e1',caption_source:'sent',caption_mode:'full'}}]},null,drawing.snapshot().form,snap.library).change;
   await slates.commit(change);const asset=await slates.asset(slates.snapshot().todos[0].binding.assetId);
   return {params:p.params,original:h.params,key:asset.entity_key,expected:h.entity_key,source:asset.source_ref,sourceId:asset.sourceId,id:h.id};
 });
 assert.deepEqual(r.params,r.original);assert.equal(r.key,r.expected);assert.equal(r.sourceId,r.id);assert.equal(r.source.tag,'#e1');assert.equal(r.source.record_id,r.id);
});
test('backup conflicts retain separate recipes and remap CHAT record and lineage to its imported branch',async t=>{
 const {page}=await setup(t);
 const result=await page.evaluate(async()=>{
   const blob=await makeImage(), {imageEntity}=await import('/src/domain/image-identity.ts'),entity_key=await imageEntity(blob),assetId=entity_key.slice(7);
   const {chatImageId}=await import('/src/domain/image-origin.ts'), chatRecord=chatImageId('chat','turn','version',assetId);
   const conversation={id:'chat',title:'Original',prompt:'',settings:{},headId:'turn',mainId:assetId,attachments:[],keepIds:[],skipTurnIds:[],baseFollows:true,selectionRevision:1,pinned:false,renamed:false,updatedAt:1,
     turns:[{id:'turn',parentId:null,prompt:'source prompt',settings:{},snapshot:{text:'source prompt',imageIds:[],turnIds:[],parentId:null,base:null,refs:[],dropped:0},selectedVersion:0,
       versions:[{id:'version',status:'done',blocks:[{type:'image',assetId}]}]}]};
   const writeChat=async row=>app.data.write(async()=>{const tx=app.databases.transaction(names.databases.chat,['conversations','assets'],'readwrite'),done=db.transactionDone(tx);tx.objectStore('conversations').put(row);tx.objectStore('assets').put({id:assetId,blob,origin:'result',name:'synthetic.png',width:128,height:128});await done;});
   await writeChat(conversation);
   await app.data.write(async()=>{
     const tx=app.databases.transaction(names.databases.favorites,ids.identityStores,'readwrite'),done=db.transactionDone(tx);
     await ids.assignFavorite(tx,{id:chatRecord,blob,entity_key,createdAt:1,favoritedAt:1,thumbBlob:null,params:{tool:'chat',chatConversationId:'chat',chatTurnId:'turn',chatVersionId:'version',chatAssetId:assetId,prompt:'source prompt'},size:{width:128,height:128},lineage:{via:'chat'}});await done;
   });
   const original=await add('recipe',2);
   await app.data.write(async()=>{const tx=app.databases.transaction(names.databases.favorites,'favorites','readwrite'),done=db.transactionDone(tx);tx.objectStore('favorites').put({...original,lineage:{via:'edit:img2img',parent_record_id:chatRecord,parent_entity_key:entity_key,parent_ref:{tag:'#c1.1',record_id:chatRecord,entity_key,scope:{kind:'chat',id:'chat',turn_id:'turn',version_id:'version',asset_id:assetId}}}});await done;});
   const file=(await app.backup.export()).blob,checked=await app.backup.read(file);
   await writeChat({...conversation,title:'Local changes'});
   await app.data.write(async()=>{const tx=app.databases.transaction(names.databases.favorites,'favorites','readwrite'),done=db.transactionDone(tx);tx.objectStore('favorites').put({...original,params:{...original.params,seed:99}});await done;});
   const first=await app.backup.import(checked),again=await app.backup.import(checked);
   const rows=drawing.snapshot().favorites,source=rows.find(r=>r.params.chatConversationId?.startsWith('import-')),copy=rows.find(r=>r.id.startsWith('import-')&&r.params.prompt==='recipe');
   return {first,again,localSeed:rows.find(r=>r.id==='recipe').params.seed,source:{id:source.id,params:source.params},copy:{seed:copy.params.seed,entity:copy.entity_key,lineage:copy.lineage},expectedEntity:original.entity_key};
 });
 assert.deepEqual(result.first,{favorites:2,conversations:1});assert.deepEqual(result.again,{favorites:0,conversations:0});assert.equal(result.localSeed,99);assert.equal(result.copy.seed,2);assert.equal(result.copy.entity,result.expectedEntity);
 assert.equal(result.copy.lineage.parent_record_id,result.source.id);assert.equal(result.copy.lineage.parent_ref.record_id,result.source.id);assert.equal(result.copy.lineage.parent_ref.scope.id,result.source.params.chatConversationId);assert.equal(result.copy.lineage.parent_ref.scope.turn_id,result.source.params.chatTurnId);assert.equal(result.copy.lineage.parent_ref.scope.version_id,result.source.params.chatVersionId);
});

test('a frozen editor reference keeps its board and cannot silently relocate to another board using the same short code',async t=>{
 const {page}=await setup(t);
 const r=await page.evaluate(async()=>{
   await editor.open('image',await makeImage(1),'one.png');const firstBoard=editor.session.id,refs=ask.externalSnapshot().library.find(p=>p.aliases.includes('#e1')).bindings;
   const first=ask.pictureInfo('#e1',refs).url;
   await editor.open('image',await makeImage(2),'two.png');
   const current=ask.pictureInfo('#e1').url,old=ask.pictureInfo('#e1',refs).url;
   const frozenRef=refs['#e1'];editor.removeBoard(firstBoard);
   return {first,current,old,after:ask.pictureInfo('#e1',refs),board:frozenRef.scope.board_id,firstBoard};
 });
 assert.equal(r.first,r.old);assert.notEqual(r.current,r.old);assert.equal(r.after,null);assert.equal(r.board,r.firstBoard);
});
test('CHAT references keep their exact branch after a favorite alias is merged and removed',async t=>{
 const {page}=await setup(t);
 const r=await page.evaluate(async()=>{
   await chat.readStored();
   const {imageEntity}=await import('/src/domain/image-identity.ts'),blobs=[await makeImage(1),await makeImage(2)],keys=await Promise.all(blobs.map(imageEntity)),assets=keys.map(k=>k.slice(7));
   const turn=(id,parentId,assetId)=>({id,parentId,prompt:id,settings:{},snapshot:{text:id,imageIds:[],turnIds:[],parentId,base:null,refs:[],dropped:0},selectedVersion:0,versions:[{id:`v-${id}`,status:'done',completedAt:1,blocks:[{type:'image',assetId}]}]});
   const c={id:'branches',title:'Branches',prompt:'',settings:{},headId:'a',mainId:assets[0],attachments:[],keepIds:[],skipTurnIds:[],baseFollows:true,selectionRevision:1,pinned:false,renamed:false,updatedAt:1,
     turns:[turn('root',null,assets[0]),turn('a','root',assets[0]),turn('b','root',assets[1])]};
   await app.data.import(async()=>{const tx=app.databases.transaction(names.databases.chat,['conversations','assets'],'readwrite'),done=db.transactionDone(tx);tx.objectStore('conversations').put(c);assets.forEach((id,i)=>tx.objectStore('assets').put({id,blob:blobs[i],origin:'result',name:'test.png',width:128,height:128}));await done;});
   chat.locateImage(c.id,'a','v-a',assets[0]);
   const favorite=await chat.favoriteRecord(c.id,'a','v-a',assets[0]);await drawing.toggleFavorite(favorite);
   const {chatPictures}=await import('/src/ask/chat-context.ts'),{withEditPictures,freezePictureRefs}=await import('/src/ask/edit-context.ts');
   const merged=withEditPictures(ask.externalSnapshot().library,chatPictures(chat.snapshot(),chat));
   const refs=freezePictureRefs(merged,{page:ask.externalSnapshot().pictureScope,favorites:drawing.favoritesScopeId,ask:'unused',chat:c.id});
   const pixels=async info=>imageEntity(await (await fetch(info.url)).blob());
   const old=await pixels(ask.pictureInfo('#c2.1',refs));
   chat.locateImage(c.id,'b','v-b',assets[1]);const current=await pixels(ask.pictureInfo('#c2.1'));
   await drawing.toggleFavorite(favorite);const retained=await pixels(ask.pictureInfo('#c2.1',refs));
   ask.locate('#c2.1',refs);
   return {old,current,retained,scope:refs['#c2.1'].scope,head:chat.snapshot().current.headId};
 });
 assert.notEqual(r.old,r.current);assert.equal(r.retained,r.old);assert.equal(r.scope.turn_id,'a');assert.equal(r.scope.version_id,'v-a');assert.equal(r.head,'a');
});
test('compact reference picker inserts without sending, respects IME and fits four widths',async t=>{
 const {page}=await setup(t);
 await page.evaluate(async()=>{await (await import('/tests/helpers/drawing-history.mjs')).seedHistory({drawing, home:window.home}, await makeImage(),{width:128,height:128},{seed:7,prompt:'reference'},null);ask.show();});
 const input=page.locator('#askPrompt');await input.waitFor({state:'visible'});await input.fill('看 #');await page.locator('#askPictureSuggestions').waitFor();await input.press('ArrowDown');await input.press('Tab');assert.match(await input.inputValue(),/^看 #h1 /);
 assert.equal(await page.evaluate(()=>ask.running.value),false);
 await input.fill('#');await input.dispatchEvent('compositionstart');assert.equal(await page.locator('#askPictureSuggestions').count(),0);await input.dispatchEvent('compositionend');await page.locator('#askPictureSuggestions').waitFor();
 await mkdir('.local/image-identity',{recursive:true});
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await page.screenshot({path:`.local/image-identity/picker-${width}.png`});assert.equal(await page.locator('#askPictureSuggestions').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth;}),true);}
 await input.press('Escape');assert.equal(await page.locator('#askPictureSuggestions').count(),0);
 await input.fill('#');await page.locator('#askPictureSuggestions').waitFor();await input.press('Shift+Enter');assert.match(await input.inputValue(),/#\n/);assert.equal(await page.evaluate(()=>ask.running.value),false);
});
