import test from 'node:test';
import assert from 'node:assert/strict';
import { scanRefs, refIndex, referenceSnapshot, refPath, REF_LIMITS } from '../src/bridge/refs.ts';
import { recipeDocument, memoDocument, exportFilename, writeReference } from '../src/bridge/export.ts';
import { createReferenceReader } from '../src/ask/read-ref.ts';
import { createAttachments, prepareAttachment } from '../src/ask/attachments.ts';
import { archiveTurn, restoreTurn, getTurn } from '../src/ask/compact/archive.ts';
import { DEFAULTS } from '../src/domain/drawing.ts';
const signal = () => new AbortController().signal;
const missing = () => new DOMException('missing','NotFoundError');
function directory(name='root') {
  const entries=new Map();let reads=0,fail=false;
  return {name,kind:'directory',entries,get reads(){return reads},set fail(v){fail=v},async *values(){yield* entries.values()},
    async getDirectoryHandle(key,{create=false}={}) {if(!entries.has(key)&&create)entries.set(key,directory(key));const e=entries.get(key);if(!e)throw missing();if(e.kind!=='directory')throw new DOMException('type','TypeMismatchError');return e},
    async getFileHandle(key,{create=false}={}) {if(!entries.has(key)&&create)this.file(key,'');const e=entries.get(key);if(!e)throw missing();if(e.kind!=='file')throw new DOMException('type','TypeMismatchError');return e},
    file(key,text){let body=text;const item={name:key,kind:'file',async getFile(){const f=new File([body],key,{lastModified:100});const read=f.arrayBuffer.bind(f);f.arrayBuffer=()=>{reads++;return read()};return f},async createWritable(){if(fail)throw new DOMException('denied','NotAllowedError');let draft;return{async write(v){draft=v},async close(){body=draft},async abort(){}}}};entries.set(key,item);return item},
  };
}
async function fixture(){const root=directory(),refs=await root.getDirectoryHandle('refs',{create:true});return {root,refs};}
test('B2 directory metadata is bounded, relative, excludes hidden/unsupported/credential files and never reads bodies',async()=>{
  const {root,refs}=await fixture();refs.file('memo.md','secret body');refs.file('.env','key');refs.file('credentials.json','key');refs.file('secrets.yaml','key');refs.file('script.js','code');refs.file('vector.svg','svg');
  const nested=await refs.getDirectoryHandle('design',{create:true});nested.file('memo.md','nested');
  const scan=await scanRefs(root,signal());assert.deepEqual(scan.files.map(f=>f.path),['design/memo.md','memo.md']);assert.equal(refs.reads+nested.reads,0);assert.doesNotMatch(JSON.stringify(refIndex(scan)),/secret body/);
  for(const path of ['../x.md','/x.md','C:/x.md','a\\x.md','a//x.md','a/../x.md','.private/x.md','secrets.json'])assert.throws(()=>refPath(path));
  for(let i=0;i<600;i++)refs.file(`file${i}.md`,'x');
  const large=await scanRefs(root,signal()),index=refIndex(large);assert.equal(large.files.length,REF_LIMITS.files);assert.equal(index.files.length,48);assert.equal(index.omitted,464);assert.equal(index.limited,true);assert.equal(refs.reads,0);
  assert.deepEqual(await scanRefs(directory(),signal()),{files:[],limited:false});
});
test('B2 snapshot resolves only captured catalog, rejects ambiguity/absence, freezes bytes and aborts on mount lifetime',async()=>{
  const {root,refs}=await fixture();refs.file('memo.md','old');const nested=await refs.getDirectoryHandle('nested',{create:true});nested.file('memo.md','nested');nested.file('unique.md','one');
  const lifetime=new AbortController(),snap=referenceSnapshot(root,await scanRefs(root,signal()),lifetime.signal);
  // Exact root-relative match takes precedence; a basename with two nested matches is ambiguous.
  const other=await refs.getDirectoryHandle('other',{create:true});other.file('unique.md','two');
  const updated=referenceSnapshot(root,await scanRefs(root,signal()),lifetime.signal);assert.throws(()=>updated.resolve('unique.md'),/同名/);assert.equal(snap.resolve('unique.md'),'nested/unique.md');
  const read=await snap.read('memo.md',signal(),100);refs.file('memo.md','new');assert.equal(await read.file.text(),'old');assert.match(read.origin.version,/^[a-f0-9]{64}$/);
  assert.notEqual((await snap.read('memo.md',signal(),100)).origin.version,read.origin.version);
  await assert.rejects(snap.read('memo.md',signal(),1),/大小/);refs.file('new.md','new');assert.throws(()=>snap.resolve('new.md'),/清单/);
  refs.entries.delete('memo.md');await assert.rejects(snap.read('memo.md',signal(),100),/移除/);
  lifetime.abort();await assert.rejects(snap.read('nested/unique.md',signal(),100),{name:'AbortError'});
});
async function readerFixture(limits={chars:50000,totalChars:100000}) {
  const {root,refs}=await fixture();for(let i=0;i<6;i++)refs.file(`${i}.md`,i===0?'a'.repeat(8000)+'original-tail':'body');
  const pool=createAttachments(),attached=[],catalog=await scanRefs(root,signal());
  const visual={signal:signal(),metadataOnly:false,budget:{calls:0,pixels:0,bytes:0},viewed:new Set()};
  const deps={source:referenceSnapshot(root,catalog,signal()),pool,attached,limits,pageBytes:()=>pool.bytes,visual,vision:{},added(){}};
  return {root,refs,pool,attached,deps,read:createReferenceReader(deps)};
}
test('B2 text pages freeze one version per turn, persist real content, and archive/restore preserves exact page boundaries',async()=>{
  const f=await readerFixture(),first=await f.read({path:'0.md'});assert.doesNotMatch(first.content[0].text,/original-tail/);assert.match(first.content[0].text,/'?next_offset"?:8000/);
  f.refs.file('0.md','replacement');const second=await f.read({path:'0.md',offset:8000});assert.match(second.content[0].text,/original-tail/);assert.equal(f.attached.length,1);
  const item=f.attached[0];assert.equal(item.toolRead,true);assert.equal(item.origin.path,'0.md');
  const turn={turnId:'T1',attachments:[item.id],question:'read',messages:[{role:'tool',content:[{type:'result',id:'r',name:'read_ref',content:second.content}]}]};
  const archived=archiveTurn(turn,f.pool.get);assert.doesNotMatch(JSON.stringify(archived),/original-tail/);assert.deepEqual(restoreTurn(archived,f.pool.get),turn);
  const saved=f.pool.snapshot([item.id]),restored=createAttachments();restored.restore(saved,[item.id]);assert.equal(getTurn({attachments:[item.id],offset:8000},[turn],restored.get).attachments[0].text,'original-tail');
  const fresh=createReferenceReader({...f.deps,attached:[]});assert.match((await fresh({path:'0.md'})).content[0].text,/replacement/);
  await assert.rejects(f.read({path:'0.md',offset:90000}),/正文长度/);await assert.rejects(f.read({path:'0.md',offset:-1}),/非负/);f.pool.dispose();restored.dispose();
});
test('B2 manual and tool text attachments share count, character and page limits; failed reads leave no pooled data',async()=>{
  const f=await readerFixture();const manual=f.pool.add(await prepareAttachment(new File(['manual'],'manual.txt')));f.attached.push(manual);
  for(const path of ['1.md','2.md','3.md'])await f.read({path});await assert.rejects(f.read({path:'4.md'}),/4/);assert.equal(f.pool.size,4);
  const small=await readerFixture({chars:10,totalChars:10});await assert.rejects(small.read({path:'0.md'}),/大小/);await small.read({path:'1.md'});await small.read({path:'2.md'});await assert.rejects(small.read({path:'3.md'}),/10/);assert.equal(small.pool.size,2);
  const full=createReferenceReader({...f.deps,attached:[],pageBytes:()=>200*1024*1024});await assert.rejects(full({path:'5.md'}),/大小/);
  const failed=await readerFixture();await assert.rejects(failed.read({path:'0.md',offset:99999}),/正文长度/);assert.equal(failed.pool.size,0);
  const noMount=createReferenceReader({...f.deps,source:null});await assert.rejects(noMount({path:'1.md'}),/挂载/);
  f.pool.dispose();small.pool.dispose();failed.pool.dispose();
});
test('B2 recipe preserves complete form/roles/seed zero without hidden config; memo exports only selected body',()=>{
  const form={...structuredClone(DEFAULTS),seed:'0',cfgRescale:.3,naiMode:'furry',complexity:'high',qualityPreset:'light',negativePreset:'light',transparentBg:true,characters:[{id:'c9',on:false,prompt:'hero',negative:'none',centers:[{x:.2,y:.8}]}],apiKey:'secret'};
  const board={id:'b',name:'雨夜',color:'blue',nextCharacterId:10,form},doc=recipeDocument(board,form,'time'),recipe=JSON.parse(doc.formats.json);
  for(const key of ['seed','cfgRescale','naiMode','complexity','qualityPreset','negativePreset','transparentBg','characters','naiReferences'])assert.deepEqual(recipe.board.form[key],form[key]);
  assert.equal(recipe.kind,'board-form');assert.equal(recipe.board.nextCharacterId,10);assert.doesNotMatch(doc.formats.json,/apiKey|secret/);assert.ok(doc.formats.md.includes(doc.formats.json));
  assert.equal(memoDocument('title','  selected\n\n').formats.md,'  selected\n\n');assert.throws(()=>memoDocument('t',' '));
  for(const name of ['../escape','.hidden',' a','a/dir','a.','x'.repeat(101)])assert.throws(()=>exportFilename(name,'md'));
});
test('B2 export writes new names, preserves existing bytes, and rejects aborted/failed/path escaping writes',async()=>{
  const {root,refs}=await fixture();refs.file('memo.md','original');assert.equal(await writeReference(root,'memo.md','new',signal()),'refs/memo-2.md');assert.equal(await(await refs.getFileHandle('memo.md')).getFile().then(f=>f.text()),'original');
  const cancelled=new AbortController();cancelled.abort();const empty=directory();await assert.rejects(writeReference(empty,'a.md','x',cancelled.signal));assert.equal(empty.entries.size,0);
  await assert.rejects(writeReference(root,'../x.md','x',signal()));refs.fail=true;await assert.rejects(writeReference(root,'no.md','x',signal()),{name:'NotAllowedError'});
});
