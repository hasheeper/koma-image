import test from 'node:test';
import assert from 'node:assert/strict';
import { scanRefs, refIndex, referenceSnapshot } from '../src/bridge/refs.ts';
import { composeProjectTags, parseProjectTags } from '../src/bridge/project/model.ts';
import { projectFileTree, visibleProjectTree } from '../src/bridge/project/file-tree.ts';
import { protocolDocument } from '../src/bridge/protocol-doc.ts';
const missing=()=>new DOMException('missing','NotFoundError');
function directory(name='企划') {
  const entries=new Map();
  return {name,kind:'directory',entries,async *values(){yield* entries.values()},
    async getDirectoryHandle(key){const h=entries.get(key);if(!h)throw missing();return h},
    async getFileHandle(key){const h=entries.get(key);if(!h)throw missing();return h},
    put(path,body){const parts=path.split('/'),last=parts.pop();let d=this;for(const p of parts){if(!d.entries.has(p))d.entries.set(p,directory(p));d=d.entries.get(p)}let reads=0;const h={name:last,kind:'file',get reads(){return reads},async getFile(){const f=new File([typeof body==='string'?body:JSON.stringify(body)],last,{lastModified:100});const text=f.text.bind(f);f.text=()=>{reads++;return text()};return f}};d.entries.set(last,h);return h},
  };
}
const signal=()=>new AbortController().signal;
test('published protocol examples scan as one project with separate outfits and root-relative references',async()=>{
  const root=directory();
  for(const [,path,body] of protocolDocument().matchAll(/^### ([^\n]+\.json)\n\n```json\n([\s\S]*?)\n```/gm))root.put(path,body);
  root.put('characters/guard/profile.md','# 原文\n完整档案');
  root.put('characters/guard/portrait.png','synthetic portrait');
  root.put('characters/guard/extra/weapon.png','synthetic weapon');
  root.put('references/city/night.png','synthetic city');
  root.put('lore/world.md','世界设定');
  const catalog=await scanRefs(root,signal()),project=catalog.project,guard=project.characters[0];
  assert.deepEqual(project.issues,[]);assert.deepEqual(guard.issues,[]);
  assert.equal(project.title,'夜城企划');assert.equal(guard.id,'guard');assert.equal(guard.name,'银发守卫');
  assert.equal(guard.profile,'characters/guard/profile.md');assert.equal(guard.portrait,'characters/guard/portrait.png');
  assert.equal(guard.refs[0].path,'characters/guard/extra/weapon.png');assert.equal(guard.refs[0].title,'佩剑');
  assert.equal(project.references[0].path,'references/city/night.png');assert.equal(project.references[0].category,'场景');
  assert.equal(project.references[0].title,'旧城夜景');assert.match(project.references[0].description,/透视/);
  assert.deepEqual(composeProjectTags(guard.tagContent,'uniform'),{prompt:'1girl, silver hair, red eyes, military uniform, red cape',negative:''});
  assert.deepEqual(composeProjectTags(guard.tagContent,'casual'),{prompt:'1girl, silver hair, red eyes, white shirt, black trousers',negative:'cape'});
  assert.deepEqual(composeProjectTags(guard.tagContent),{prompt:'1girl, silver hair, red eyes',negative:''});
  const index=refIndex(catalog);assert.equal(index.characters.length,1);assert.equal(index.characters[0].tags.path,'characters/guard/char.json');
  assert.equal(index.characters[0].tags.field,'tags');
});
test('project tree keeps same-named files in their folders and collapses only the selected subtree',()=>{
  const files=['lore/world.md','refs/world.md','lore/plans/phase10.md','lore/plans/phase2.md','overview.md'].map(path=>({path,title:path}));
  const tree=projectFileTree(files),all=visibleProjectTree(tree,new Set());
  assert.deepEqual(all.map(r=>r.node.path),['lore','lore/plans','lore/plans/phase2.md','lore/plans/phase10.md','lore/world.md','refs','refs/world.md','overview.md']);
  const nested=all.find(r=>r.node.path==='lore/plans/phase2.md');
  assert.equal(nested.parent,'lore/plans');assert.equal(nested.depth,2);
  assert.equal(nested.node.file,files[3],'file identity and metadata stay attached');
  const collapsed=visibleProjectTree(tree,new Set(['lore/plans']));
  assert.ok(!collapsed.some(r=>r.node.path==='lore/plans/phase2.md'));
  assert.ok(collapsed.some(r=>r.node.path==='lore/world.md'));
  assert.ok(collapsed.some(r=>r.node.path==='refs/world.md'));
  const filtered=projectFileTree([files[3]]);
  assert.deepEqual(visibleProjectTree(filtered,new Set()).map(r=>r.node.path),['lore','lore/plans','lore/plans/phase2.md']);
});
test('project conventions, manifests and root-relative references stay distinct without reading profiles',async()=>{
  const root=directory();root.put('characters/hero/brief.txt','银发守卫');const profile=root.put('characters/hero/profile.md','complete profile');const tags=root.put('characters/hero/tags.txt','silver hair');
  root.put('characters/hero/portrait.webp','image');root.put('characters/hero/refs/detail.png','one');root.put('characters/hero/extra/detail.png','two');root.put('refs/detail.png','three');root.put('lore/world.md','world');root.put('draft.inbox.json','control');root.put('PROTOCOL.md','control');root.put('original.md','root setting');root.put('unrelated/private.md','unrelated');
  const catalog=await scanRefs(root,signal()),index=refIndex(catalog),c=index.characters[0];
  assert.equal(c.id,'hero');assert.equal(c.brief,'银发守卫');assert.equal(c.tags.path,'characters/hero/tags.txt');assert.equal(c.refs.length,2);assert.equal(c.portrait,'characters/hero/portrait.webp');assert.equal(tags.reads+profile.reads,0);
  assert.ok(index.lore.some(f=>f.path==='original.md'));assert.ok(index.references.some(f=>f.path==='refs/detail.png'));assert.ok(!catalog.files.some(f=>f.path.includes('control')||f.path==='PROTOCOL.md'||f.path.startsWith('unrelated/')));
  const snapshot=referenceSnapshot(root,catalog,signal(),'mount-a');assert.throws(()=>snapshot.resolve('detail.png'),/同名/);
  const file=await snapshot.read('characters/hero/refs/detail.png',signal(),100);assert.equal(file.origin.projectId,'mount-a');assert.equal(file.file.name,'characters/hero/refs/detail.png');
});
test('project metadata overrides conventions, invalid records stay local and tags preserve originals',async()=>{
  const root=directory();root.put('project.json',{title:'企划名',paths:{characters:'cast'}});root.put('cast/hero/char.json',{name:'守卫',brief:'简述',profile:'missing.md',tags:{prompt:'1.2::silver hair::',negative:'bad',outfits:[{id:'uniform',label:'制服',prompt:'red cape'}]}});root.put('cast/hero/profile.md','must not silently replace explicit missing file');root.put('cast/broken/char.json','{bad');root.put('cast/broken/brief.md','仍可用');root.put('references/references.json',{items:[{file:'scene.png',title:'夜景',description:'光线'}]});root.put('references/scene.png','image');root.put('references/unlisted.png','image');
  const catalog=await scanRefs(root,signal()),hero=catalog.project.characters.find(c=>c.id==='hero');
  assert.equal(catalog.project.title,'企划名');assert.equal(hero.profile,null);assert.match(hero.issues.join(),/missing/);assert.equal(catalog.project.characters.find(c=>c.id==='broken').brief,'仍可用');
  assert.equal(catalog.project.references.length,2);assert.equal(refIndex(catalog).characters.find(c=>c.id==='hero').tagContent,undefined);
  assert.deepEqual(composeProjectTags(hero.tagContent,'uniform'),{prompt:'1.2::silver hair::, red cape',negative:'bad'});assert.equal(composeProjectTags(parseProjectTags(' raw,\n tag ')).prompt,' raw,\n tag ');
});
test('large character index paginates by character, not each file',async()=>{
  const root=directory();for(let i=0;i<140;i++){root.put(`characters/c${String(i).padStart(3,'0')}/brief.md`,'brief');root.put(`characters/c${String(i).padStart(3,'0')}/tags.txt`,'tags')}
  const catalog=await scanRefs(root,signal()),index=refIndex(catalog),snapshot=referenceSnapshot(root,catalog,signal());
  assert.equal(index.characters.length,128);assert.equal(index.groups.characters.total,140);assert.equal(index.groups.characters.omitted,12);
  const page=snapshot.list('characters/',128);assert.equal(page.items.length,12);assert.equal(page.next_offset,null);assert.equal(index.files.length,0);
  const filePage=snapshot.list(index.groups.all_files.path,128);assert.equal(filePage.total,280);assert.equal(filePage.next_offset,256);assert.equal(filePage.items.length,128);assert.ok(filePage.items.every(f=>f.path.startsWith('characters/')));
});
