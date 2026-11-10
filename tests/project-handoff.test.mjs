import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttachments, attachmentPictures } from '../src/ask/attachments.ts';
import { createProjectImages, prepareProjectHandoffs, remapProjectDraft } from '../src/ask/project-images.ts';
import { parseDraft, stateHash, validateDraft } from '../src/ask/draft/validate.ts';
import { DEFAULTS } from '../src/domain/drawing.ts';
import { imageParameters } from '../src/domain/image-parameters.ts';

test('project handoffs bind frozen scoped images, reject generic attachments and restore pending identity', async () => {
  const pool=createAttachments(), scopes=new Map([['old',pool]]), images=createProjectImages(id=>scopes.get(id));
  const data={kind:'image',blob:new Blob(['original']),name:'portrait.png',bytes:8,mime:'image/png',size:{width:512,height:768},sentSize:{width:512,height:768},sentBytes:8,params:null,sent:{type:'image',mime:'image/png',data:'mock'}};
  const project=pool.add({...data,origin:{projectId:'A',path:'characters/hero/portrait.png',version:'hash',modified:1}}),generic=pool.add(data);
  const library=attachmentPictures(pool.read([project.id,generic.id]),'old');
  const base={form:{...DEFAULTS},composer:'',conversationId:'chat',workspace:'image',models:[],samplers:[],chatModel:{id:'model',name:'model',maxImages:4,writable:{}}};
  const input={draft_title:'交接立绘',base_hash:stateHash(base),steps:[{kind:'chat_handoff',images:['characters/hero/portrait.png'],options:{},text:'expression sheet'}]};
  const calls=[],prepared=await prepareProjectHandoffs(input,async path=>{calls.push(path);return project.id});
  assert.deepEqual(calls,['characters/hero/portrait.png']);assert.equal(input.steps[0].images[0],'characters/hero/portrait.png');
  const draft=parseDraft(prepared,base,library),plan=validateDraft(draft,base,{off:new Set(),has:i=>!!images.get(i.ref)});
  assert.equal(plan.handoff.images[0].source,'project');assert.equal(plan.handoff.images[0].ref,'old/#a1');
  assert.throws(()=>parseDraft({...input,steps:[{...input.steps[0],images:[generic.id]}]},base,library),/附件/);
  images.retain([plan]);pool.release([project.id]);assert.equal(await images.get('old/#a1').blob.text(),'original','undo/redo owns the frozen original independently of the turn');
  const restored=createAttachments();restored.restore(pool.snapshot([project.id]),[project.id]);scopes.set('new',restored);
  const fresh=remapProjectDraft(draft,'old','new');assert.equal(fresh.steps[0].images[0].ref,'new/#a1');assert.equal(await images.get('new/#a1').blob.text(),'original');
  images.retain([]);assert.equal(images.get('old/#a1'),null);assert.equal(images.get('new/#a1').origin.projectId,'A');
  const provenance={projectId:'A',path:'characters/hero/portrait.png',version:'hash'};
  assert.deepEqual(imageParameters({projectSource:{...provenance,handle:'not provenance',key:'not provenance'}}).projectSource,provenance,'EDIT parameter snapshots preserve only source identity fields');
  pool.dispose();restored.dispose();
});
