import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseHistoryOriginals } from '../src/domain/image-history.ts';
import { snapshotPictures } from '../src/ask/library.ts';
import { createIds } from '../src/ask/ids.ts';
import { createRecipeReader } from '../src/ask/retrospect/tools.ts';
import { recipeClusters } from '../src/ask/retrospect/recipe.ts';
import { handoffImage } from '../src/ask/draft/validate.ts';
import { createVision } from '../src/ask/vision.ts';
import { DEFAULTS } from '../src/domain/drawing.ts';

const record = n => ({ id: `r${n}`, createdAt:n, entity_key:`sha256:${n}`, blob:new Blob(['original']), thumbBlob:new Blob(['thumb']), size:{width:832,height:1216}, params:{...DEFAULTS, boardId:'b1', basePrompt:`full recipe ${n}`, baseNegative:'', localCharacters:[]} });
test('history releases only unprotected originals and preserves all identities, recipes and dimensions', () => {
  const source=[4,3,2,1].map(record), output=releaseHistoryOriginals(source,1,new Set(['r2']));
  assert.deepEqual(output.map(r=>!!r.blob),[true,false,true,false]);
  assert.equal(output.length,4);assert.equal(output[1].thumbBlob,source[1].thumbBlob);
  assert.equal(output[1].params,source[1].params);assert.equal(output[1].entity_key,source[1].entity_key);
  assert.equal(output[1].size,source[1].size);assert.ok(source[1].blob,'frozen in-flight source is not mutated');
  assert.equal(releaseHistoryOriginals(output,0,new Set())[1].blob,undefined,'raising a limit never invents pixels');
  assert.equal(releaseHistoryOriginals(output,1,new Set())[2].blob,undefined,'last lease release frees an older original');
  const failed={...record(5),thumbBlob:null};assert.equal(releaseHistoryOriginals([source[0],failed],1,new Set())[1],failed,'failed thumbnail retains the only image');
  assert.deepEqual(releaseHistoryOriginals(source,0,new Set()).map(r=>!!r.blob),[true,true,true,true]);
});
test('old thumbnail records remain readable candidates with stable tags, full adjacent diffs and favorite aliases', () => {
  const ids=createIds(), records=[3,2,1].map(record);
  snapshotPictures(records,[],ids);
  const small=releaseHistoryOriginals(records,1,new Set());
  const pictures=snapshotPictures(small,[],ids);
  assert.deepEqual(pictures.map(p=>p.label),['#h3','#h2','#h1']);
  assert.equal(pictures[2].blob,records[2].thumbBlob);assert.equal(pictures[2].thumbnailOnly,true);
  const reader=createRecipeReader(()=>recipeClusters(pictures,new Set()),'b1'), evidence=reader.read({});
  assert.equal(evidence.evolution.length,3);assert.equal(evidence.clusters[0].recipe.prompt,'full recipe 1');
  assert.deepEqual(evidence.clusters[0].image_availability,{'#h1':'thumbnail_only'});
  assert.equal(reader.present({retrospect_title:'history',nodes:[{id:'v1',label:'初始',image_ids:['#h1']}],edges:[]}).nodes[0].recipe.prompt,'full recipe 1');
  const saved=snapshotPictures(small,[{...records[2],favSeq:1}],ids).find(p=>p.id==='r1');
  assert.equal(saved.thumbnailOnly,undefined);assert.equal(saved.blob,records[2].blob);assert.deepEqual(saved.aliases,['#h1','#f1']);
});
test('thumbnail-only pixels cannot be handed off or cropped but keep IMAGE recipe references', async () => {
  const p=snapshotPictures(releaseHistoryOriginals([record(2),record(1)],1,new Set()),[],createIds())[1];
  assert.throws(()=>handoffImage('#h1',{},[p]),/原图已释放/);
  assert.equal(handoffImage('#h1',{},[p],true).ref,'r1');
  const vision=createVision();
  try { await assert.rejects(vision.image(p,'crop',[0,0,50,50],{signal:new AbortController().signal,metadataOnly:false,viewed:new Set([p.entity_key]),budget:{calls:0,bytes:0,pixels:0}}),/无法精细裁切/); }
  finally {vision.dispose();}
});
