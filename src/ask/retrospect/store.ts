import { shallowRef } from 'vue';
import type { PictureRefs } from '../edit-context.ts';
import type { Retrospect } from './model.ts';
import { MAX_EVOLUTION_NODES, selectRetrospectSample, remapSampleBases } from './model.ts';
import { effectiveSignature, recipeOf, pictureTarget } from './recipe.ts';
import { recipeDiff } from './diff.ts';
import type { Recipe } from './recipe.ts';
import type { Picture } from '../library.ts';
import { editNotes, nodeNoteKey, edgeNoteKey } from './annotations.ts';
import type { ReviewNotes } from './annotations.ts';
import type { NodeLayout, ContinuationAnchor, GraphCamera } from './view.ts';

export type ReviewStatus = 'active' | 'ended';
export interface ReviewOwner { conversationId: string; turnId: number; boardId: string | null; boardName: string }
export interface EvolutionCursor { nodeId: string; imageId: string }
export interface EvolutionChange {
  id: string; boardId: string; epoch: number;
  before: { cursor: EvolutionCursor; key: string };
  after: { cursor: EvolutionCursor; key: string };
}
export interface ReviewRecord extends ReviewOwner {
  id: string; value: Retrospect; pictureRefs: PictureRefs; status: ReviewStatus;
  createdAt: number; activatedAt: number; endedAt: number | null; revision: number; notes: ReviewNotes;
  cursor: EvolutionCursor | null; cursorKey: string; epoch: number; nextVersion: number;
  final: EvolutionCursor | null; sources: readonly Pick<ReviewOwner, 'conversationId' | 'turnId'>[];
  /** Viewing state only; never changes the ASK revision or draft base. */
  newNodes: readonly string[];
  nodeLayout: NodeLayout;
  continuationAnchor: ContinuationAnchor | null;
  graphCamera: GraphCamera | null;
}
interface GenerationBinding {
  id: string; epoch: number; cursor: EvolutionCursor; key: string; recipe: Recipe;
  recordId: string; advance: boolean;
  firstRecord?: string;
  capacityNotified?: boolean;
}
const key = () => crypto.randomUUID();
const sample = (r: ReviewRecord, cursor: EvolutionCursor) => {
  const node = r.value.nodes.find(n => n.id === cursor.nodeId);
  return node?.image_ids.includes(cursor.imageId) ? selectRetrospectSample(node, cursor.imageId) : null;
};
function summary(a: Recipe, b: Recipe) {
  const diff = recipeDiff(a, b);
  const texts = diff.texts.filter(t => t.changed);
  const areas = [
    ...(texts.some(t => !t.key.startsWith('c')) ? ['词文'] : []),
    ...([...texts, ...diff.parameters].some(p => /^c\d+:/.test(p.key)) ? ['角色'] : []),
    ...(diff.parameters.some(p => !/^c\d+:/.test(p.key)) ? ['参数'] : []),
  ];
  return { label: `${areas.join('、') || '配方'}调整`, description: [...diff.parameters.map(p => p.key.endsWith(':centers') || p.key === 'naiReferences' ? `${p.label}调整` : `${p.label} ${p.before}→${p.after}`), ...texts.map(t => `${t.label}调整`)].join(' · ').slice(0, 160) || '配方调整' };
}
/** Page-owned active trees; message cards remain immutable snapshots. No image bytes are retained. */
export function createRetrospects(onEnded?: (record: ReviewRecord, undo: () => void) => void) {
  const records = shallowRef<readonly ReviewRecord[]>([]);
  const opened = shallowRef<{ id: string; initialVersion?: string; key: number } | null>(null);
  const host = shallowRef<HTMLElement | null>(null);
  let sequence = 0, opening = 0;
  const get = (id: string) => records.value.find(r => r.id === id);
  const put = (r: ReviewRecord) => { records.value = records.value.map(old => old.id === r.id ? r : old); };
  const source = (conversationId: string, turnId: number) => records.value.find(r => r.sources.some(s => s.conversationId === conversationId && s.turnId === turnId));
  const activeForBoard = (boardId: string) => records.value.find(r => r.boardId === boardId && r.status === 'active') ?? null;
  function setStatus(id: string, status: ReviewStatus, revision?: number, quiet = false) {
    const before = get(id);
    if (!before || revision !== undefined && before.revision !== revision) return false;
    if (before.status === status) return true;
    if (status === 'active') {
      if (!before.boardId || !before.cursor) throw new Error('历史演进没有可继续跟踪的画板基底');
      for (const r of records.value) if (r.id !== id && r.boardId === before.boardId && r.status === 'active') setStatus(r.id, 'ended', undefined, true);
    }
    const after = { ...before, status, epoch: before.epoch + 1, cursorKey: key(), revision: before.revision + 1,
      final: status === 'active' ? null : before.final, activatedAt: status === 'active' ? Date.now() : before.activatedAt, endedAt: status === 'ended' ? Date.now() : null };
    put(after);
    if (status === 'ended' && !quiet) onEnded?.(after, () => { setStatus(id, 'active', after.revision); });
    return true;
  }
  function register(value: Retrospect, pictureRefs: PictureRefs, owner: ReviewOwner, status: ReviewStatus = 'active', pictures: readonly Picture[] = []) {
    const existing = source(owner.conversationId, owner.turnId);
    if (existing) return existing;
    if (status === 'active' && owner.boardId) {
      const old = activeForBoard(owner.boardId); if (old) setStatus(old.id, 'ended', undefined, true);
    }
    const samples = value.nodes.flatMap(n => n.image_ids.map(imageId => ({ nodeId: n.id, imageId })));
    const latest = [...samples].sort((a, b) => {
      const time = (c: EvolutionCursor) => pictures.find(p => p.id === pictureRefs[c.imageId]?.record_id)?.createdAt ?? samples.indexOf(c);
      return time(a) - time(b);
    }).at(-1) ?? null;
    const now = Date.now();
    const record: ReviewRecord = { ...owner, id: `r${++sequence}`, value, pictureRefs, status, createdAt: now, activatedAt: now,
      endedAt: status === 'ended' ? now : null, revision: 0, notes: {}, cursor: latest, cursorKey: key(), epoch: 0, final: null,
      nextVersion: Math.max(0, ...value.nodes.map(n => Number(n.id.slice(1)))) + 1,
      newNodes: status === 'active' ? value.nodes.map(n => n.id) : [], nodeLayout: {}, continuationAnchor: null, graphCamera: null,
      sources: [{ conversationId: owner.conversationId, turnId: owner.turnId }] };
    records.value = [...records.value, record]; return record;
  }
  function locate(r: ReviewRecord, recordId: string): EvolutionCursor | null {
    for (const n of r.value.nodes) for (const imageId of n.image_ids) if (r.pictureRefs[imageId]?.record_id === recordId) return { nodeId: n.id, imageId };
    return null;
  }
  function prepareMove(boardId: string, recordId: string): EvolutionChange {
    const r = activeForBoard(boardId), after = r && locate(r, recordId);
    if (!r?.cursor || !after) throw new Error('回退图片不在当前画板正在跟踪的版本演进中');
    return { id: r.id, boardId, epoch: r.epoch, before: { cursor: r.cursor, key: r.cursorKey }, after: { cursor: after, key: key() } };
  }
  function moveIssue(change: EvolutionChange, undo = false) {
    const r = get(change.id), expected = undo ? change.after : change.before;
    return !r || r.status !== 'active' || r.epoch !== change.epoch || r.cursorKey !== expected.key ||
      !sample(r, undo ? change.before.cursor : change.after.cursor) ? '演进基底或跟踪状态已变化，请重新提议' : '';
  }
  function commitMove(change: EvolutionChange, undo = false) {
    const issue = moveIssue(change, undo); if (issue) throw new Error(issue);
    const r = get(change.id)!, target = undo ? change.before : change.after;
    put({ ...r, cursor: target.cursor, cursorKey: target.key, revision: r.revision + 1 });
  }
  function begin(boardId: string, parentRecordId?: string | null, advance = true): GenerationBinding | null {
    const r = activeForBoard(boardId), cursor = r && parentRecordId !== undefined ? parentRecordId ? locate(r, parentRecordId) : null : r?.cursor;
    const base = r && cursor && sample(r, cursor);
    return r && cursor && base ? { id: r.id, epoch: r.epoch, cursor, recordId:r.pictureRefs[cursor.imageId].record_id, advance, key: r.cursorKey, recipe: base.recipe } : null;
  }
  function land(binding: GenerationBinding | null, p: Picture, refs: PictureRefs): string | null {
    if (!binding || p.params.isComparison) return null;
    const r = get(binding.id);
    if (!r || r.status !== 'active' || r.epoch !== binding.epoch || r.boardId !== pictureTarget(p, r.boardId)) return null;
    if (locate(r, p.id)) return null;
    const baseRecord = binding.recordId;
    const parent = baseRecord ? locate(r, baseRecord) : null;
    if (!parent) return '版本演进基底已变化，请 ASK 重新整理';
    const recipe = recipeOf(p.params), same = effectiveSignature(recipe) === effectiveSignature(binding.recipe);
    const previousBatch = binding.firstRecord ? locate(r, binding.firstRecord) : null;
    const repeat = recipe.input && [...r.value.nodes].reverse().find(n => n.image_ids.some(id => effectiveSignature(selectRetrospectSample(n, id).recipe) === effectiveSignature(recipe)));
    let nodeId = previousBatch?.nodeId ?? (same ? parent.nodeId : repeat?.id ?? '');
    const created = !nodeId;
    let nodes = [...r.value.nodes], edges = [...r.value.edges];
    if (!nodeId) {
      if (nodes.length >= MAX_EVOLUTION_NODES) {
        if (binding.capacityNotified) return null;
        binding.capacityNotified = true;
        return '版本演进已达 80 个节点，请 ASK 合并归纳阶段；本次图片已保留在历史中';
      }
      nodeId = `v${r.nextVersion}`;
      const heading = summary(binding.recipe, recipe);
      nodes.push({ id: nodeId, ...heading, image_ids: [], cover: p.label, recipe, recipes: {} });
      edges.push({ from: parent.nodeId, to: nodeId, summary: heading.description.slice(0, 100) });
    }
    nodes = nodes.map(n => n.id === nodeId ? { ...n, image_ids: [...n.image_ids, p.label], recipes: { ...(n.recipes ?? Object.fromEntries(n.image_ids.map(id => [id, n.recipe]))), [p.label]: recipe } } : n);
    binding.firstRecord ??= p.id;
    put({ ...r, value: { ...r.value, nodes, edges, sampleBases: { ...r.value.sampleBases, [p.label]: parent.imageId } }, pictureRefs: { ...r.pictureRefs, ...refs }, revision: r.revision + 1,
      nodeLayout: created && r.cursorKey === binding.key && r.continuationAnchor?.nodeId === parent.nodeId
        ? { ...r.nodeLayout, [nodeId]: { x: r.continuationAnchor.x, cy: r.continuationAnchor.cy, z: r.continuationAnchor.z } } : r.nodeLayout,
      nextVersion: Math.max(r.nextVersion, Number(nodeId.slice(1)) + 1),
      newNodes: created ? [...r.newNodes, nodeId] : r.newNodes,
      continuationAnchor: created && !binding.advance ? null : r.continuationAnchor,
      cursor: r.cursorKey === binding.key && binding.advance ? { nodeId, imageId: p.label } : r.cursor });
    return null;
  }
  function update(id: string, revision: number, value: Retrospect, refs: PictureRefs, owner: ReviewOwner) {
    const r = get(id); if (!r || r.revision !== revision) throw new Error('版本演进已变化，请重新读取后整理');
    const allRefs = { ...r.pictureRefs, ...refs };
    value = { ...value, sampleBases: remapSampleBases(r, value.nodes, imageId => allRefs[imageId]?.record_id) };
    for (const old of r.value.nodes) {
      const reused = value.nodes.find(n => n.id === old.id);
      if (reused && !reused.image_ids.some(id => old.image_ids.some(previous => allRefs[id]?.record_id === r.pictureRefs[previous]?.record_id))) throw new Error('已有版本编号不能改指完全不同的样本，请保留节点身份');
    }
    const mapped = (old: EvolutionCursor | null) => {
      if (!old) return null;
      const recordId = r.pictureRefs[old.imageId]?.record_id;
      for (const n of value.nodes) for (const imageId of n.image_ids) if (recordId && allRefs[imageId]?.record_id === recordId) return { nodeId: n.id, imageId };
      throw new Error('整理不能丢弃当前基底或定稿样本');
    };
    const cursor = mapped(r.cursor), final = mapped(r.final), notes: Record<string, string> = {};
    const mapping = new Map<string, string>();
    for (const old of r.value.nodes) {
      const target = value.nodes.filter(n => old.image_ids.some(imageId => n.image_ids.some(id => allRefs[id]?.record_id === r.pictureRefs[imageId]?.record_id)));
      if (target.length === 1) mapping.set(old.id, target[0].id);
    }
    for (const [noteKey, text] of Object.entries(r.notes)) {
      const parts = noteKey.split(':'), from = mapping.get(parts[1]), to = mapping.get(parts[2]);
      const target = parts[0] === 'node' && from ? nodeNoteKey(from) : from && to && value.edges.some(e => e.from === from && e.to === to) ? edgeNoteKey({ from, to, summary: '' }) : null;
      if (!target) throw new Error('整理会丢失已有批注，请保留相应节点与连线或先处理批注');
      notes[target] = notes[target] && notes[target] !== text ? `${notes[target]}\n${text}` : text;
      if (notes[target].length > 2000) throw new Error('合并后的批注超过 2000 字，请先整理批注');
    }
    const after = { ...r, value, pictureRefs: allRefs, cursor, final, notes, revision: r.revision + 1,
      nodeLayout: Object.fromEntries(Object.entries(r.nodeLayout).filter(([id]) => value.nodes.some(n => n.id === id))),
      nextVersion: Math.max(r.nextVersion, ...value.nodes.map(n => Number(n.id.slice(1)) + 1)),
      newNodes: value.nodes.filter(n => r.newNodes.includes(n.id) || !r.value.nodes.some(old => old.id === n.id)).map(n => n.id),
      sources: [...r.sources, { conversationId: owner.conversationId, turnId: owner.turnId }] };
    put(after); return after;
  }
  function finalize(id: string, nodeId: string, imageId: string, revision: number) {
    const r = get(id);
    if (!r || r.revision !== revision || r.status !== 'active' || !sample(r, { nodeId, imageId })) throw new Error('版本演进已变化，请重新选择定稿');
    put({ ...r, final: { nodeId, imageId }, status: 'ended', endedAt: Date.now(), epoch: r.epoch + 1, revision: r.revision + 1 });
  }
  function acknowledgeOpened() {
    const r = opened.value && get(opened.value.id);
    if (r?.newNodes.length) put({ ...r, newNodes: [] });
  }
  return {
    records, opened, host, get, source, register, setStatus, activeForBoard, prepareMove, moveIssue, commitMove, begin, land, update, finalize,
    transfer(target: string, recordId: string, boardName: string) {
      const r=records.value.find(r=>r.status==='active'&&locate(r,recordId));
      if(!r||r.boardId===target)return false;
      const other=activeForBoard(target);if(other)setStatus(other.id,'ended',undefined,true);
      put({...r,boardId:target,boardName,cursor:locate(r,recordId),cursorKey:key(),epoch:r.epoch+1,revision:r.revision+1});
      return true;
    },
    /** CHAT short codes are branch-relative. Rebind by immutable record, never by code. */
    relabel(pictures: readonly Picture[]) {
      for (const r of records.value) {
        if (!r.boardId?.startsWith('chat:')) continue;
        const labels=new Map<string,string>(), used=new Set<string>();
        for(const n of r.value.nodes)for(const id of n.image_ids) {
          const p=pictures.find(p=>p.id===r.pictureRefs[id]?.record_id);
          if(p){labels.set(id,p.label);used.add(p.label);}
        }
        for(const n of r.value.nodes)for(const id of n.image_ids)if(!labels.has(id)) {let next=id;while(used.has(next))next+='·失效';labels.set(id,next);used.add(next);}
        if([...labels].every(([a,b])=>a===b))continue;
        const rename=(id:string)=>labels.get(id)??id;
        const cursor=(c:EvolutionCursor|null)=>c?{...c,imageId:rename(c.imageId)}:null;
        put({...r,revision:r.revision+1,cursor:cursor(r.cursor),final:cursor(r.final),
          pictureRefs:Object.fromEntries([...labels].map(([a,b])=>[b,{...r.pictureRefs[a],tag:b}])),
          value:{...r.value,nodes:r.value.nodes.map(n=>({...n,cover:rename(n.cover),image_ids:n.image_ids.map(rename),recipes:Object.fromEntries(n.image_ids.map(id=>[rename(id),selectRetrospectSample(n,id).recipe]))})),
            sampleBases:Object.fromEntries(Object.entries(r.value.sampleBases??{}).map(([a,b])=>[rename(a),rename(b)]))}});
      }
    },
    arrange(id: string, layout: NodeLayout) {
      const r = get(id); if (!r) return;
      const next = Object.fromEntries(Object.entries(layout).filter(([node, p]) => r.value.nodes.some(n => n.id === node) && Number.isFinite(p.x) && Number.isFinite(p.cy) && Number.isSafeInteger(p.z)));
      if (JSON.stringify(next) !== JSON.stringify(r.nodeLayout)) put({ ...r, nodeLayout: next });
    },
    arrangeContinuation(id: string, anchor: ContinuationAnchor) {
      const r = get(id);
      if (!r || r.status !== 'active' || r.cursor?.nodeId !== anchor.nodeId || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.cy) || !Number.isSafeInteger(anchor.z)) return;
      if (JSON.stringify(anchor) !== JSON.stringify(r.continuationAnchor)) put({ ...r, continuationAnchor: anchor });
    },
    rememberCamera(id: string, camera: GraphCamera) {
      const r = get(id);
      if (!r || ![camera.x, camera.y, camera.scale, camera.fitted].every(Number.isFinite) || camera.scale <= 0 || camera.fitted <= 0) return;
      if (JSON.stringify(camera) !== JSON.stringify(r.graphCamera)) put({ ...r, graphCamera: { ...camera } });
    },
    detachBoard(boardId: string) { const r = activeForBoard(boardId); if (r) setStatus(r.id, 'ended', undefined, true); },
    open(id: string, initialVersion?: string) {
      const r = get(id); if (!r) return;
      if (opened.value?.id === id && (!initialVersion || opened.value.initialVersion === initialVersion)) return;
      if (opened.value?.id !== id) acknowledgeOpened();
      opened.value = { id, initialVersion: r.value.nodes.some(n => n.id === initialVersion) ? initialVersion : undefined, key: ++opening };
    },
    close() { acknowledgeOpened(); opened.value = null; },
    annotate(id: string, keys: readonly string[], text: string | null) {
      const r = get(id); if (!r || r.status !== 'active') throw new Error('请先继续演进，再编辑批注');
      put({ ...r, notes: editNotes(r.value, r.notes, keys, text), revision: r.revision + 1 });
    },
    removeSource(conversationId: string, turns?: ReadonlySet<number>) {
      records.value = records.value.map(r => ({ ...r, sources: r.sources.filter(s => s.conversationId !== conversationId || turns && !turns.has(s.turnId)) }));
    },
    blocksAsk() { return [...document.querySelectorAll('dialog:modal')].some(dialog => dialog !== host.value?.closest('dialog')); },
    dispose() { records.value = []; opened.value = null; host.value = null; },
  };
}
export type Retrospects = ReturnType<typeof createRetrospects>;
/** Parent links remain the sole topology truth; final highlighting is a derived view. */
export function finalPath(r: Pick<ReviewRecord, 'value' | 'final'>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (let id = r.final?.nodeId; id && !ids.has(id); id = r.value.edges.find(e => e.to === id)?.from) ids.add(id);
  return ids;
}
