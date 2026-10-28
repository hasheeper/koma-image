import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIds, idPattern, isPictureId } from '../src/ask/ids.ts';
import { editLabel } from '../src/domain/edit-identity.ts';
import { editPictures, editContext, freezePictureRefs, withEditPictures } from '../src/ask/edit-context.ts';
import { snapshotPictures } from '../src/ask/library.ts';
import { createTools } from '../src/ask/tools.ts';
import { inline } from '../src/ask/format.ts';

function fixture() {
  const blob = new Blob(['synthetic'], { type: 'image/png' });
  const version = (id, sequence, variant) => ({ id, sequence, recordId: `edit:board-a:${id}`, createdAt: id,
    parentId: id === 1 ? 0 : 1, sourceId: id === 1 ? 'record:source-a' : `edit:${id}`,
    ...(variant ? { director: { tool: 'bg-removal', group: 'g', variant } } : {}) });
  const a = { id: 'board-a', ref: 'eb1', boardSeq:1, name: 'A', baseId: 1, viewId: 3,
    versions: [version(1, 1), version(2, 2, 'masked'), version(3, 2, 'generated'), version(4, 2, 'blend')], directorChoices: { g: 3 } };
  const b = { ...a, id: 'board-b', ref: 'eb2', boardSeq:2, name: 'B', versions: [{ ...version(1, 1), recordId: 'edit:board-b:1' }], directorChoices: {}, viewId: 1 };
  const editor = { session: a, boards: () => [a, b], records: () => [a, b].flatMap(s => s.versions.map(v => ({
    id: v.recordId, blob, size: { width: 512, height: 512 }, createdAt: v.createdAt,
    params: { editBoardId: s.id, editVersion: v.sequence, editVariant: v.director?.variant, seed: 7 },
  }))) };
  const ids = createIds(); ids.sync([{ id: 'source-a', createdAt: 1 }], []);
  return { a, b, editor, ids, blob };
}
test('EDIT IDs parse complete local/group/qualified references without consuming invalid prefixes', () => {
  for (const id of ['#e1', '#e30', '#e3.1', '#e3.3', '#e2.3a', '#e3c']) assert.equal(isPictureId(id), true);
  for (const id of ['#e0', '#e2.0', '#e2aa', '#e2.1.2', 'eb0:#e1']) assert.equal(isPictureId(id), false);
  assert.deepEqual([...('看 #e2.1 和 #e2.3c，不是 #e2.1.4 或 #e1x').matchAll(idPattern)].map(m => m[0]), ['#e2.1', '#e2.3c']);
  assert.equal(inline('`#e2.3a`')[0].t, 'id');
});
test('EDIT snapshots freeze bare-group choice, board-local aliases, source and stable scope', () => {
  const { a, b, editor, ids } = fixture();
  const frozen = editPictures(editor, ids), refs = freezePictureRefs(frozen,{page:'page',favorites:'favs',ask:'ask',chat:'chat'});
  assert.equal(refs['#e1'].record_id, 'edit:board-a:1'); assert.equal(refs['#e2'].record_id, 'edit:board-a:3');
  assert.equal(refs['#e1.2a'].record_id, 'edit:board-a:2'); assert.equal(refs['#e2.1'].record_id, 'edit:board-b:1');
  assert.equal(editLabel(a.versions[2]), '#e2b');
  a.directorChoices.g = 4; editor.session = b;
  const next = editPictures(editor, ids), nextRefs = freezePictureRefs(next,{page:'page',favorites:'favs',ask:'ask',chat:'chat'});
  assert.equal(refs['#e2'].record_id, 'edit:board-a:3');
  assert.equal(nextRefs['#e1.2'].record_id, 'edit:board-a:4');
  assert.equal(nextRefs['#e1'].record_id, 'edit:board-b:1'); assert.equal(nextRefs['#e2'], undefined);
  const context = editContext(editor, next);
  assert.equal(context.board_seq, 2);
  assert.equal(context.boards[0].versions[0].origin, '#h1');
  assert.equal(context.boards[0].versions[1].parent, '#e1.1');
  assert.equal(context.read_only, true);
});
test('EDIT pictures merge favorite aliases and read tools use the turn snapshot, never IMAGE history', async () => {
  const { a, b, editor, ids } = fixture();
  const edits = editPictures(editor, ids);
  const favorite = { ...editor.records()[2], favoritedAt: 10, favSeq: 1 };
  const base = snapshotPictures([], [favorite], ids);
  const library = withEditPictures(base, edits);
  const picture = library.find(p => p.id === favorite.id);
  assert.ok(picture.aliases.includes('#f1')); assert.ok(picture.aliases.includes('#e2'));
  assert.equal(picture.origins.some(o => o.source === 'history'), false);
  editor.session = b; a.directorChoices.g = 4;
  const context = { library, signal: new AbortController().signal, metadataOnly: true };
  const output = await createTools().get('get_meta').run({ id: '#e2' }, context);
  assert.match(output.content[0].text, /generated/);
  const search = await createTools().get('search_history').run({ scope: 'edit', limit: 15 }, context);
  assert.ok(search.content[0].text.includes('#e1.2b'));
  assert.ok(!search.content[0].text.includes('#h'));
});

test('reference grammar distinguishes sentence punctuation and invalid extra segments', () => {
 assert.deepEqual([...('看 #c3.1. 和 #c2.1a、#c2.1.2、#e2.12b。拒绝 #e2.12.3 #e2ab #h0 #f1x eb1:#e2').matchAll(idPattern)].map(m=>m[0]),['#c3.1','#c2.1a','#c2.1.2','#e2.12b']);
});

test('removed history membership cannot resolve through a remaining favorite alias', () => {
  const ids = createIds(), row = {id:'record',createdAt:1,favSeq:7};
  ids.sync([row],[row]);
  assert.equal(ids.resolve('#h1'),'record');
  ids.sync([],[row]);
  assert.equal(ids.resolve('#h1'),null);
  assert.equal(ids.resolve('#f7'),'record');
  ids.sync([{id:'next',createdAt:2}],[row]);
  assert.equal(ids.history('next'),'#h2');
});

test('same source record in two editor boards preserves each alias board binding', () => {
  const {editor,ids,a,b} = fixture();
  b.versions[0].recordId = a.versions[0].recordId;
  const refs = freezePictureRefs(withEditPictures([],editPictures(editor,ids)),{page:'page',favorites:'favs',ask:'ask',chat:'chat'});
  assert.equal(refs['#e1.1'].scope.board_id,a.id);
  assert.equal(refs['#e2.1'].scope.board_id,b.id);
});
