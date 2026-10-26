import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/domain/drawing.ts';
import { parseDraft, validateDraft, stateHash } from '../src/ask/draft/validate.ts';
import { receiveDraft } from '../src/bridge/protocol.ts';
import { filePreviews } from '../src/ask/draft/file-view.ts';
const base = () => ({ form: {...structuredClone(DEFAULTS),prompt:'sky',seed:'0'}, composer:'',conversationId:'chat',workspace:'image',boardId:'b',boardName:'画板',boardPresent:true,models:[],samplers:[],fileContext:{id:'directory',directory:'.koma-bridge',available:true} });
const proposal = (state,steps) => parseDraft({draft_title:'沉淀配方',base_hash:stateHash(state),steps},state,[]);
const step = {kind:'save_ref',document:'recipe'};
test('file proposals freeze safe board snapshots, memo bytes and destination; no arbitrary paths or formats',()=>{
  const state=base(),draft=proposal(state,[step,{kind:'save_ref',document:'memo',document_title:'memo',text:'  exact\n\n'}]);
  state.form.prompt='changed';const [recipe,memo]=draft.steps.map(s=>s.file);
  assert.equal(JSON.parse(recipe.text).board.form.prompt,'sky');assert.equal(JSON.parse(recipe.text).board.form.seed,'0');assert.equal(memo.text,'  exact\n\n');
  assert.equal(recipe.context.id,'directory');assert.match(recipe.filename,/\.json$/);assert.match(memo.filename,/\.md$/);
  for(const extra of [{path:'../x'},{format:'html'},{title:'reserved'},{document:'script'}])assert.throws(()=>proposal(base(),[{...step,...extra}]));
  assert.throws(()=>proposal(base(),[{kind:'save_ref',document:'memo',text:' '}]),/正文/);
});
test('internal/external drafts share file steps; directory change blocks the entire composite and never redirects to download',()=>{
  const state=base(),steps=[{kind:'prompt_patch',target:'image.prompt',mode:'append',text:', sunset'},step];
  const external=receiveDraft({schema:'koma.bridge.draft.v1',draft_id:'files',draft_title:'files',steps},{base:state,library:[],pictureScope:'scope'});
  const valid=validateDraft(external,state,{off:new Set()});assert.equal(valid.files.length,1);assert.equal(valid.changes[0].after,'sky, sunset');assert.ok(valid.steps.every(s=>s.locked));
  for(const context of [{id:null,available:false},{id:'other',available:true},{id:'directory',available:false}]){
    const invalid=validateDraft(external,{...state,fileContext:context},{off:new Set()});assert.equal(invalid.changes.length,0);assert.ok(invalid.steps.some(s=>s.issue));assert.equal(invalid.files[0].context.id,'directory');
  }
  assert.equal(validateDraft(external,state,{off:new Set(['0'])}).changes.length,0);
  const [preview]=filePreviews(valid);assert.equal(preview.target,'refs/');assert.ok(preview.text.includes('sky'));assert.ok(!JSON.stringify(preview).includes('schema'));
  const local=base();local.fileContext={id:null,directory:'',available:true};assert.equal(filePreviews(validateDraft(proposal(local,[step]),local,{off:new Set()}))[0].target,'下载');
});
