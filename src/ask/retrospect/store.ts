import { shallowRef } from 'vue';
import type { PictureRefs } from '../edit-context.ts';
import type { Retrospect, RetrospectNode } from './model.ts';
import { MAX_EVOLUTION_NODES, MAX_STAGED_BRANCHES, isStaged, stagedCount, selectRetrospectSample, remapSampleBases, preserveStaged } from './model.ts';
import { recipeOf, pictureTarget, recipeTarget, recipeWorkspace } from './recipe.ts';
import { evolutionWorkspace } from '../../domain/evolution-input.ts';
import { recipeDiff } from './diff.ts';
import { assertForest, workshopPending } from './workshops.ts';
import type { WorkshopTicket, DeliveryKind } from './workshops.ts';
import { canonical } from '../canonical.ts';
import type { Recipe } from './recipe.ts';
import type { Picture } from '../library.ts';
import { editNotes, nodeNoteKey, edgeNoteKey } from './annotations.ts';
import type { ReviewNotes } from './annotations.ts';
import type { NodeLayout, ContinuationAnchor, GraphCamera } from './view.ts';

export type ReviewStatus = 'active' | 'ended';
export interface ReviewOwner { conversationId: string; turnId: number; boardId: string | null; boardName: string }
export type EvolutionCursor = { nodeId: string; imageId: string; kind?: 'generated' } | { nodeId: string; imageId: ''; kind: 'staged' };
export interface EvolutionDestination { id: string; baseRecordId: string; reason: 'ask' }
export interface EvolutionChange {
  id: string; boardId: string; epoch: number;
  before: { cursor: EvolutionCursor; key: string; destination?: EvolutionDestination | null };
  after: { cursor: EvolutionCursor; key: string; destination?: EvolutionDestination | null };
}
export interface ReviewRecord extends ReviewOwner {
  /** Only IMAGE owns the generation cursor. Workshops keep explicit delivery associations. */
  workshops: readonly WorkshopTicket[];
  imageAttached: boolean;
  id: string; value: Retrospect; pictureRefs: PictureRefs; status: ReviewStatus;
  createdAt: number; activatedAt: number; endedAt: number | null; revision: number; notes: ReviewNotes;
  destination: EvolutionDestination | null;
  cursor: EvolutionCursor | null; cursorKey: string; epoch: number; nextVersion: number;
  final: EvolutionCursor | null; sources: readonly Pick<ReviewOwner, 'conversationId' | 'turnId'>[];
  /** Viewing state only; never changes the ASK revision or draft base. */
  newNodes: readonly string[];
  nodeLayout: NodeLayout;
  continuationAnchor: ContinuationAnchor | null;
  graphCamera: GraphCamera | null;
}
export interface EvolutionTreeChange { readonly id: string; readonly before: ReviewRecord; readonly after: ReviewRecord }
interface GenerationBinding {
  id: string; boardId: string; epoch: number; cursor: EvolutionCursor; key: string; recipe: Recipe;
  recordId: string; advance: boolean;
  firstRecord?: string;
  destination?: EvolutionDestination | null;
  targetRecord?: string;
  capacityNotified?: boolean;
  stagedNode?: string;
}
const key = () => crypto.randomUUID();
const sampleRefs = (value: Retrospect, refs: PictureRefs): PictureRefs => Object.fromEntries(value.nodes.flatMap(n => n.image_ids).flatMap(id => refs[id] ? [[id, refs[id]]] : []));
const sample = (r: ReviewRecord, cursor: EvolutionCursor) => {
  const node = r.value.nodes.find(n => n.id === cursor.nodeId);
  if (!node) return null;
  if (cursor.kind === 'staged') return isStaged(node) ? node : selectRetrospectSample(node, node.image_ids[0]);
  return node.image_ids.includes(cursor.imageId) ? selectRetrospectSample(node, cursor.imageId) : null;
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
  const inFlight = new Map<string, number>();
  // Reservation identity survives undo/redo and late completions; only page-owned IDs/positions.
  const landedDestinations = new Map<string, string>();
  const rememberedLayouts = new Map<string, NodeLayout>();
  const placements = new Map<string, ContinuationAnchor>();
  const flightRevision = shallowRef(0);
  const flightKey = (id: string, node: string) => `${id}/${node}`;
  const get = (id: string, _boardId?: string): ReviewRecord | undefined => records.value.find(r => r.id === id);
  const put = (r: ReviewRecord, _preserveFocus = false) => { records.value = records.value.map(old => old.id === r.id ? r : old); };
  const source = (conversationId: string, turnId: number) => records.value.find(r => r.sources.some(s => s.conversationId === conversationId && s.turnId === turnId));
  const activeForBoard = (boardId: string) => records.value.find(r => r.boardId === boardId && r.imageAttached && r.status === 'active') ?? null;
  const relatedTo = (r: ReviewRecord, target: string) => r.boardId === target || r.workshops.some(t => t.target === target);
  const flights = new Set<GenerationBinding>();
  const reservations = (r: ReviewRecord) => new Set([r.destination, ...[...flights].filter(b => b.id === r.id && b.epoch === r.epoch).map(b => b.destination)].flatMap(d => d && !landedDestinations.has(d.id) ? [d.id] : []));
  const capacity = (r: ReviewRecord) => r.value.nodes.length + r.workshops.filter(t => !t.nodeId).length + reservations(r).size;
  const semantic = (r: ReviewRecord) => canonical({ value: r.value, pictureRefs: r.pictureRefs, cursor: r.cursor, cursorKey: r.cursorKey,
    destination: r.destination, status: r.status, imageAttached: r.imageAttached, epoch: r.epoch, final: r.final, notes: r.notes,
    workshops: r.workshops.map(({ results: _results, ...t }) => t) });
  function treeIssue(change: EvolutionTreeChange, undo = false) {
    const r = get(change.id);
    return !r || semantic(r) !== semantic(undo ? change.after : change.before) ? '演进已有后续修改，请先处理较新的操作' : '';
  }
  function commitTree(change: EvolutionTreeChange, undo = false) {
    const issue = treeIssue(change, undo); if (issue) throw new Error(issue);
    const r = get(change.id)!, next = undo ? change.before : change.after;
    const layout = { ...next.nodeLayout, ...rememberedLayouts.get(r.id), ...r.nodeLayout }; rememberedLayouts.set(r.id, layout);
    put({ ...next, revision: r.revision + 1, nextVersion: Math.max(r.nextVersion, next.nextVersion),
      workshops: next.workshops.map(t => ({ ...t, results: [...new Set([...t.results, ...(r.workshops.find(old => old.id === t.id)?.results ?? [])])] })),
      graphCamera: r.graphCamera,
      nodeLayout: Object.fromEntries(Object.entries(layout).filter(([id]) => next.value.nodes.some(n => n.id === id) || next.workshops.some(t => t.id === id))),
    });
  }
  function changed(before: ReviewRecord, after: ReviewRecord): EvolutionTreeChange {
    assertForest(after.value);
    return { id: before.id, before, after };
  }
  function preparePromote(id: string, recordId: string): EvolutionTreeChange {
    const r = get(id), cursor = r && locate(r, recordId), n = r && cursor && sample(r, cursor);
    if (!r || r.status !== 'active' || !cursor || !n || isStaged(n) || recipeWorkspace(n.recipe) !== 'image') throw new Error('请选择活动演进中的 IMAGE 样本');
    if (n.image_ids.length < 2) throw new Error('当前阶段只有一张图，无需拆分');
    if (capacity(r) >= MAX_EVOLUTION_NODES) throw new Error('演进已达 80 个节点，请先整理阶段');
    const old = r.value.nodes.find(node => node.id === n.id)!, remaining = old.image_ids.filter(tag => tag !== n.cover);
    const cover = remaining.includes(old.cover) ? old.cover : remaining.at(-1)!;
    const heading = summary(selectRetrospectSample(old, cover).recipe, n.recipe), nodeId = `v${r.nextVersion}`;
    let value: Retrospect = { ...r.value, nodes: [
      ...r.value.nodes.map(node => node.id === n.id ? { ...selectRetrospectSample(old, cover), image_ids: remaining,
        recipes: Object.fromEntries(remaining.map(tag => [tag, selectRetrospectSample(old, tag).recipe])) } : node),
      { id: nodeId, ...heading, cover: n.cover, image_ids: [n.cover], recipe: n.recipe, recipes: { [n.cover]: n.recipe } },
    ], edges: [...r.value.edges, { from: n.id, to: nodeId, summary: heading.label }] };
    value = { ...value, edges: value.edges.map(e => e.from === n.id && e.to !== nodeId && value.sampleBases?.[value.nodes.find(node => node.id === e.to)?.image_ids[0] ?? ''] === n.cover ? { ...e, from: nodeId } : e) };
    value = preserveStaged(value, r, r.pictureRefs);
    value = { ...value, sampleBases: { ...value.sampleBases, [n.cover]: cover } };
    const notes = { ...r.notes };
    for (const edge of r.value.edges) {
      const next = value.edges.find(e => e.to === edge.to);
      if (next && next.from !== edge.from && notes[edgeNoteKey(edge)]) { notes[edgeNoteKey(next)] = notes[edgeNoteKey(edge)]; delete notes[edgeNoteKey(edge)]; }
    }
    return changed(r, { ...r, value, notes, cursor: { nodeId, imageId: n.cover }, cursorKey: key(), destination: null, continuationAnchor: null,
      imageAttached: true, nextVersion: r.nextVersion + 1, newNodes: [...r.newNodes, nodeId] });
  }
  function prepareRestore(id: string, recordId: string) {
    const r = get(id), cursor = r && locate(r, recordId);
    if (!r || !cursor || !r.boardId || recipeWorkspace(sample(r, cursor)!.recipe) !== 'image') throw new Error('IMAGE 来源已失效');
    return changed(r, { ...r, cursor, cursorKey: key(), destination: null, continuationAnchor: null, imageAttached: r.status === 'active' });
  }
  function workshopsFor(target: string, recordId?: string) {
    return records.value.filter(r => r.status === 'active').flatMap(r => r.workshops.filter(t => t.target === target &&
      (!recordId || t.results.includes(recordId) || t.inputs.includes(recordId) || t.anchorRecordId === recordId)).map(ticket => ({ record: r, ticket })));
  }
  function collectWorkshop(target: string, parentRecordId: string | null, references: readonly string[] = []) {
    const inputs = new Set([parentRecordId, ...references].filter(Boolean));
    const matches = workshopsFor(target).filter(({ ticket }) => [...ticket.results, ...ticket.inputs, ticket.anchorRecordId].some(id => inputs.has(id)));
    if (!matches.length) return null;
    return (recordId: string) => {
      for (const { record, ticket } of matches) {
        const r = get(record.id), t = r?.workshops.find(t => t.id === ticket.id);
        if (r?.status === 'active' && t && !t.results.includes(recordId)) {
          // A new work result starts a fresh pending position; do not overlap its delivered stage.
          const restarting = !workshopPending(t);
          if (restarting) {
            const layout = rememberedLayouts.get(r.id);
            if (layout) rememberedLayouts.set(r.id, Object.fromEntries(Object.entries(layout).filter(([id]) => id !== t.id)));
          }
          put({ ...r, ...(restarting ? { nodeLayout: Object.fromEntries(Object.entries(r.nodeLayout).filter(([id]) => id !== t.id)) } : {}),
            workshops: r.workshops.map(item => item.id === t.id ? { ...t, results: [...t.results, recordId] } : item) });
        }
      }
    };
  }
  function delivery(r: ReviewRecord, ticketId: string, p: Picture, refs: PictureRefs, mode: 'append' | 'next', kind: DeliveryKind): ReviewRecord {
    const t = r.workshops.find(t => t.id === ticketId), existing = locate(r, p.id);
    if (existing) return r;
    if (!t || r.status !== 'active' || !t.results.includes(p.id) || recipeWorkspace(recipeOf(p.params)) === 'image') throw new Error('该图片没有对应的工坊交付来源');
    if (r.pictureRefs[p.label] && r.pictureRefs[p.label].record_id !== p.id) throw new Error('图片编号已变化，请重新选择');
    const parent = locate(r, t.anchorRecordId); if (!parent) throw new Error('工坊来源样本已失效');
    const creating = !t.nodeId || mode === 'next';
    if (creating && t.nodeId && capacity(r) >= MAX_EVOLUTION_NODES) throw new Error('演进已达 80 个节点，可追加到本阶段');
    const id = creating ? `v${r.nextVersion}` : t.nodeId!, recipe = recipeOf(p.params), label = `${recipeWorkspace(recipe).toUpperCase()} 精修`;
    const node: RetrospectNode = creating ? { id, label, image_ids: [], cover: p.label, recipe,
      delivery: { sourceRecordId: t.anchorRecordId, samples: {} } } : r.value.nodes.find(n => n.id === id)!;
    if (!node?.delivery) throw new Error('续交阶段不是工坊交付节点');
    const result: RetrospectNode = { ...node, cover: p.label, recipe, image_ids: [...node.image_ids, p.label],
      recipes: { ...node.recipes, [p.label]: recipe }, delivery: { ...node.delivery, samples: { ...node.delivery.samples, [p.label]: { kind, target: t.target } } } };
    const position = creating ? r.nodeLayout[t.id] : undefined;
    return { ...r, value: { ...r.value, nodes: creating ? [...r.value.nodes, result] : r.value.nodes.map(n => n.id === id ? result : n),
      edges: creating ? [...r.value.edges, { from: parent.nodeId, to: id, summary: label }] : r.value.edges,
      sampleBases: { ...r.value.sampleBases, [p.label]: parent.imageId } },
      pictureRefs: { ...r.pictureRefs, [p.label]: refs[p.label] }, nextVersion: creating ? r.nextVersion + 1 : r.nextVersion,
      newNodes: creating ? [...r.newNodes, id] : r.newNodes, nodeLayout: position ? { ...r.nodeLayout, [id]: position } : r.nodeLayout,
      workshops: r.workshops.map(item => item.id === t.id ? { ...t, nodeId: id, anchorRecordId: p.id, deliveredCount: t.results.length } : item) };
  }
  function prepareDelivery(id: string, ticketId: string, p: Picture, refs: PictureRefs, mode: 'append' | 'next' = 'append', kind: DeliveryKind = 'stage') {
    const r = get(id); if (!r) throw new Error('演进已失效');
    return changed(r, delivery(r, ticketId, p, refs, mode, kind));
  }
  function prepareDispatch(target: string, recordId: string, name: string, pictures: readonly Picture[], refs: PictureRefs, inputRecordId = recordId): EvolutionTreeChange | null {
    if (evolutionWorkspace(target) === 'image') return null;
    const candidates = records.value.filter(r => r.status === 'active' && (locate(r, recordId) || r.workshops.some(t => t.results.includes(recordId))));
    if (candidates.length !== 1) return null;
    const before = candidates[0]; let r = before;
    if (!locate(r, recordId)) {
      const matches = r.workshops.filter(t => t.results.includes(recordId)), p = pictures.find(p => p.id === recordId);
      if (matches.length !== 1 || !p) throw new Error('接力图片来源不明确，请先记入演进');
      r = delivery(r, matches[0].id, p, refs, 'append', 'stage');
    }
    if (r.workshops.some(t => t.target === target && t.sourceRecordId === recordId)) return r === before ? null : changed(before, r);
    if (capacity(r) >= MAX_EVOLUTION_NODES) throw new Error('演进已达 80 个节点；图片已交接，可整理阶段后再关联');
    const ticket: WorkshopTicket = { id: `w-${key()}`, target, name, sourceRecordId: recordId, anchorRecordId: recordId, nodeId: null, inputs: [inputRecordId], results: [], deliveredCount: 0 };
    return changed(before, { ...r, workshops: [...r.workshops, ticket] });
  }
  function prepareCancel(id: string, ticketId: string) {
    const r = get(id); if (!r || !r.workshops.some(t => t.id === ticketId)) throw new Error('工坊关联已失效');
    return changed(r, { ...r, workshops: r.workshops.filter(t => t.id !== ticketId) });
  }
  function detachBoard(boardId: string) {
    const r = activeForBoard(boardId); if (!r) return;
    put({ ...r, imageAttached: false, epoch: r.epoch + 1, cursorKey: key(), revision: r.revision + 1 });
  }
  function setStatus(id: string, status: ReviewStatus, revision?: number, quiet = false) {
    const before = get(id);
    if (!before || revision !== undefined && before.revision !== revision) return false;
    if (before.status === status) return true;
    if (status === 'active') {
      if (!before.boardId || !before.cursor) throw new Error('历史演进没有可继续跟踪的画板基底');
      const other = activeForBoard(before.boardId); if (other && other.id !== id) detachBoard(before.boardId);
    }
    const after = { ...before, imageAttached: status === 'active', status, epoch: before.epoch + 1, cursorKey: key(), revision: before.revision + 1,
      final: status === 'active' ? null : before.final, activatedAt: status === 'active' ? Date.now() : before.activatedAt, endedAt: status === 'ended' ? Date.now() : null };
    put(after);
    if (status === 'ended' && !quiet) onEnded?.(after, () => { setStatus(id, 'active', after.revision); });
    return true;
  }
  function register(value: Retrospect, pictureRefs: PictureRefs, owner: ReviewOwner, status: ReviewStatus = 'active', pictures: readonly Picture[] = []) {
    const existing = source(owner.conversationId, owner.turnId);
    if (existing) return existing;
    if (status === 'active' && evolutionWorkspace(owner.boardId) !== 'image') throw new Error('请从 IMAGE 历史建立演进主干');
    pictureRefs = sampleRefs(value, pictureRefs);
    if (status === 'active' && owner.boardId) {
      detachBoard(owner.boardId);
    }
    const samples = value.nodes.flatMap(n => n.image_ids.map(imageId => ({ nodeId: n.id, imageId })));
    const ownSamples = samples.filter(c => {
      const p = pictures.find(p => p.id === pictureRefs[c.imageId]?.record_id);
      return p ? recipeTarget(p) === owner.boardId : recipeWorkspace(selectRetrospectSample(value.nodes.find(n => n.id === c.nodeId)!, c.imageId).recipe) === evolutionWorkspace(owner.boardId);
    });
    const latest = [...(ownSamples.length ? ownSamples : samples)].sort((a, b) => {
      const time = (c: EvolutionCursor) => pictures.find(p => p.id === pictureRefs[c.imageId]?.record_id)?.createdAt ?? samples.indexOf(c);
      return time(a) - time(b);
    }).at(-1) ?? null;
    const now = Date.now();
    const record: ReviewRecord = { ...owner, workshops: [], imageAttached: status === 'active', id: `r${++sequence}`, value, pictureRefs, status, createdAt: now, activatedAt: now,
      endedAt: status === 'ended' ? now : null, revision: 0, notes: {}, destination: null, cursor: latest, cursorKey: key(), epoch: 0, final: null,
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
    if (!r?.cursor || !after || recipeWorkspace(sample(r, after)!.recipe) !== 'image') throw new Error('回退图片不在当前画板正在跟踪的版本演进中');
    return { id: r.id, boardId, epoch: r.epoch, before: { cursor: r.cursor, key: r.cursorKey, destination: r.destination }, after: { cursor: after, key: key() } };
  }
  function moveIssue(change: EvolutionChange, undo = false) {
    const r = get(change.id, change.boardId), expected = undo ? change.after : change.before;
    return !r || !r.imageAttached || r.boardId !== change.boardId || r.status !== 'active' || r.epoch !== change.epoch || r.cursorKey !== expected.key ||
      !sample(r, undo ? change.before.cursor : change.after.cursor) ? '演进基底或跟踪状态已变化，请重新提议' : '';
  }
  function commitMove(change: EvolutionChange, undo = false) {
    const issue = moveIssue(change, undo); if (issue) throw new Error(issue);
    const r = get(change.id, change.boardId)!, target = undo ? change.before : change.after;
    const resolved = sample(r, target.cursor)!;
    const cursor: EvolutionCursor = target.cursor.kind === 'staged' && !isStaged(resolved) ? { nodeId: resolved.id, imageId: resolved.cover } : target.cursor;
    put({ ...r, cursor, destination: target.destination ?? null, continuationAnchor: target.destination ? placements.get(target.destination.id) ?? null : null, cursorKey: target.key, revision: r.revision + 1 });
  }
  function prepareNext(boardId: string, reason: EvolutionDestination['reason'], move?: EvolutionChange): EvolutionChange {
    const r = activeForBoard(boardId);
    if (!r?.cursor) throw new Error('当前画板没有活动演进');
    if (move && moveIssue(move)) throw new Error(moveIssue(move));
    const cursor = move?.after.cursor ?? r.cursor;
    // A loaded blueprint already owns the next result, even after an ASK refinement.
    const destination = cursor.kind === 'staged' ? null : pending(r.id, boardId) && !move ? r.destination : {
      id: key(), baseRecordId: r.pictureRefs[cursor.imageId].record_id, reason,
    };
    if (destination && !reservations(r).has(destination.id) && capacity(r) >= MAX_EVOLUTION_NODES) throw new Error('版本演进已达 80 个节点，请 ASK 合并归纳阶段');
    return { id: r.id, boardId, epoch: r.epoch,
      before: { cursor: r.cursor, key: r.cursorKey, destination: r.destination },
      after: { cursor, key: key(), destination } };
  }
  function pending(id: string, boardId?: string) {
    const r = get(id, boardId), d = r?.destination;
    const cursor = r && d && !landedDestinations.has(d.id) && locate(r, d.baseRecordId);
    return cursor && d ? { ...cursor, key: d.id, reason: d.reason } : null;
  }
  function begin(boardId: string, parentRecordId?: string | null, advance = true): GenerationBinding | null {
    const r = activeForBoard(boardId);
    const cursor = r && parentRecordId !== undefined ? parentRecordId ? locate(r, parentRecordId) : null : r?.cursor;
    const base = r && cursor && sample(r, cursor);
    if (!r || !cursor || !base) return null;
    if (isStaged(base)) {
      const k = flightKey(r.id, base.id); inFlight.set(k, (inFlight.get(k) ?? 0) + 1);
      flightRevision.value++;
      const binding: GenerationBinding = { id: r.id, boardId, epoch: r.epoch, cursor, stagedNode: base.id, recordId: base.staged.base.record_id, advance, key: r.cursorKey, recipe: base.recipe };
      flights.add(binding); return binding;
    }
    const binding: GenerationBinding = { id: r.id, boardId, epoch: r.epoch, cursor, recordId: r.pictureRefs[base.cover].record_id, advance, key: r.cursorKey,
      recipe: base.recipe, destination: r.destination, targetRecord: r.cursor ? r.pictureRefs[r.cursor.imageId]?.record_id : undefined };
    flights.add(binding); return binding;
  }
  function land(binding: GenerationBinding | null, p: Picture, refs: PictureRefs): string | null {
    if (!binding || p.params.isComparison) return null;
    const r = get(binding.id, binding.boardId);
    if (!r || !r.imageAttached || r.boardId !== binding.boardId || r.status !== 'active' || r.epoch !== binding.epoch || r.boardId !== pictureTarget(p, r.boardId)) return null;
    if (locate(r, p.id)) return null;
    if (r.pictureRefs[p.label] && r.pictureRefs[p.label].record_id !== p.id) return '图片编号冲突，本次图片已保留，请 ASK 重新读取演进';
    const baseRecord = binding.recordId;
    const parent = baseRecord ? locate(r, baseRecord) : null;
    if (!parent) return '版本演进基底已变化，请 ASK 重新整理';
    const recipe = recipeOf(p.params);
    const previousBatch = binding.firstRecord ? locate(r, binding.firstRecord) : null;
    const destinationRecord = binding.destination ? landedDestinations.get(binding.destination.id) : binding.targetRecord;
    const destination = destinationRecord ? locate(r, destinationRecord) : null;
    let nodeId = previousBatch?.nodeId ?? binding.stagedNode ?? destination?.nodeId ?? (binding.destination ? '' : parent.nodeId);
    if (binding.stagedNode && !r.value.nodes.some(n => n.id === binding.stagedNode)) return '预设分支已移除，图片已保留在历史';
    const created = !nodeId;
    let nodes: RetrospectNode[] = [...r.value.nodes], edges = [...r.value.edges];
    if (!nodeId) {
      if (capacity(r) - (binding.destination && reservations(r).has(binding.destination.id) ? 1 : 0) >= MAX_EVOLUTION_NODES) {
        if (binding.capacityNotified) return null;
        binding.capacityNotified = true;
        return '版本演进已达 80 个节点，请 ASK 合并归纳阶段；本次图片已保留在历史中';
      }
      nodeId = `v${r.nextVersion}`;
      const heading = recipeWorkspace(binding.recipe) !== recipeWorkspace(recipe)
        ? { label: `${recipeWorkspace(recipe).toUpperCase()} 阶段`, description: `${recipeWorkspace(binding.recipe).toUpperCase()} → ${recipeWorkspace(recipe).toUpperCase()}` } : summary(binding.recipe, recipe);
      nodes.push({ id: nodeId, ...heading, image_ids: [], cover: p.label, recipe, recipes: {} });
      edges.push({ from: parent.nodeId, to: nodeId, summary: heading.description.slice(0, 100) });
    }
    nodes = nodes.map(n => n.id !== nodeId ? n : { ...n, kind: 'generated', staged: undefined, cover: isStaged(n) ? p.label : n.cover, recipe: isStaged(n) ? recipe : n.recipe, image_ids: [...n.image_ids, p.label], recipes: { ...(n.recipes ?? Object.fromEntries(n.image_ids.map(id => [id, n.recipe]))), [p.label]: recipe } });
    binding.firstRecord ??= p.id;
    if (binding.destination && !landedDestinations.has(binding.destination.id)) landedDestinations.set(binding.destination.id, p.id);
    const placement = binding.destination && placements.get(binding.destination.id);
    put({ ...r, value: { ...r.value, nodes, edges, sampleBases: { ...r.value.sampleBases, [p.label]: parent.imageId } }, pictureRefs: { ...r.pictureRefs, [p.label]: refs[p.label] }, revision: r.revision + 1,
      nodeLayout: created && placement
        ? { ...r.nodeLayout, [nodeId]: { x: placement.x, cy: placement.cy, z: placement.z } } : r.nodeLayout,
      nextVersion: Math.max(r.nextVersion, Number(nodeId.slice(1)) + 1),
      newNodes: created ? [...r.newNodes, nodeId] : r.newNodes,
      continuationAnchor: created && r.destination?.id === binding.destination?.id ? null : r.continuationAnchor,
      cursor: r.cursorKey === binding.key && binding.advance ? { nodeId, imageId: p.label } : r.cursor }, true);
    return null;
  }
  function update(id: string, revision: number, value: Retrospect, refs: PictureRefs, owner: ReviewOwner, preview = false) {
    const r = get(id); if (!r || r.revision !== revision) throw new Error('版本演进已变化，请重新读取后整理');
    value = preserveStaged(value, r, { ...r.pictureRefs, ...refs });
    const selected = sampleRefs(value, refs);
    for (const [tag, ref] of Object.entries(selected)) if (r.pictureRefs[tag] && r.pictureRefs[tag].record_id !== ref.record_id) throw new Error('图片编号作用域已变化，请重新读取');
    const allRefs = { ...r.pictureRefs, ...selected };
    value = { ...value, sampleBases: remapSampleBases(r, value.nodes, imageId => allRefs[imageId]?.record_id) };
    for (const old of r.value.nodes) {
      const reused = value.nodes.find(n => n.id === old.id);
      if (!isStaged(old) && reused && !reused.image_ids.some(id => old.image_ids.some(previous => allRefs[id]?.record_id === r.pictureRefs[previous]?.record_id))) throw new Error('已有版本编号不能改指完全不同的样本，请保留节点身份');
    }
    const mapped = (old: EvolutionCursor | null) => {
      if (!old) return null;
      if (old.kind === 'staged' && value.nodes.some(n => n.id === old.nodeId)) return old;
      const recordId = r.pictureRefs[old.imageId]?.record_id;
      for (const n of value.nodes) for (const imageId of n.image_ids) if (recordId && allRefs[imageId]?.record_id === recordId) return { nodeId: n.id, imageId };
      throw new Error('整理不能丢弃当前基底或定稿样本');
    };
    const cursor = mapped(r.cursor), final = mapped(r.final), notes: Record<string, string> = {};
    const mapping = new Map<string, string>();
    for (const old of r.value.nodes) {
      if (isStaged(old) && value.nodes.some(n => n.id === old.id)) { mapping.set(old.id, old.id); continue; }
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
    if (r.destination) for (const recordId of [r.destination.baseRecordId, landedDestinations.get(r.destination.id)].filter(Boolean))
      if (!value.nodes.some(n => n.image_ids.some(tag => allRefs[tag]?.record_id === recordId))) throw new Error('整理不能丢弃待生成目标或当前阶段样本');
    for (const flight of flights) if (flight.id === id && flight.epoch === r.epoch && !value.nodes.some(n => n.image_ids.some(tag => allRefs[tag]?.record_id === flight.recordId))) throw new Error('整理不能丢弃正在生成的来源样本');
    const workshops = r.workshops.map(t => {
      const parent = value.nodes.find(n => n.image_ids.some(tag => allRefs[tag]?.record_id === t.anchorRecordId));
      if (!parent) throw new Error('整理不能丢弃工坊来源或续交样本');
      return { ...t, nodeId: t.nodeId ? parent.id : null };
    });
    const after = { ...r, workshops, value, pictureRefs: sampleRefs(value, allRefs), cursor, final, notes, revision: r.revision + 1,
      nodeLayout: Object.fromEntries(Object.entries(r.nodeLayout).filter(([id]) => value.nodes.some(n => n.id === id) || workshops.some(t => t.id === id))),
      nextVersion: Math.max(r.nextVersion, ...value.nodes.map(n => Number(n.id.slice(1)) + 1)),
      newNodes: value.nodes.filter(n => r.newNodes.includes(n.id) || !r.value.nodes.some(old => old.id === n.id)).map(n => n.id),
      sources: [...r.sources, { conversationId: owner.conversationId, turnId: owner.turnId }] };
    if (capacity(after) > MAX_EVOLUTION_NODES) throw new Error('演进最多 80 个节点，含待生成目标与待交付工单');
    assertForest(after.value);
    if (!preview) put(after); return after;
  }
  function finalize(id: string, nodeId: string, imageId: string, revision: number) {
    const r = get(id);
    if (!r || r.revision !== revision || r.status !== 'active' || !sample(r, { nodeId, imageId }) || r.value.nodes.some(n => n.id === nodeId && isStaged(n))) throw new Error('版本演进已变化，请重新选择定稿');
    put({ ...r, final: { nodeId, imageId }, status: 'ended', endedAt: Date.now(), epoch: r.epoch + 1, revision: r.revision + 1 });
  }
  function stage(id: string, revision: number, node: RetrospectNode, edge: Retrospect['edges'][number], owner: ReviewOwner, prepared?: Retrospect, refs: PictureRefs = {}) {
    const before = get(id);
    if (!before || before.status !== 'active' || before.revision !== revision) throw new Error('演进已变化，请重新读取');
    const r = prepared ? update(id, revision, prepared, refs, owner, true) : before;
    if (!isStaged(node) || !r.value.nodes.some(n => n.id === edge.from && n.image_ids.some(tag => r.pictureRefs[tag]?.record_id === node.staged.base.record_id))) throw new Error('预设分支基底不在树中');
    if (r.value.nodes.some(n => n.id === node.id)) throw new Error('预设节点编号已占用');
    if (capacity(r) >= MAX_EVOLUTION_NODES || stagedCount(r.value) >= MAX_STAGED_BRANCHES) throw new Error('演进最多 80 个节点，其中待生成预设最多 16 个');
    const after = { ...r, value: { ...r.value, nodes: [...r.value.nodes, node], edges: [...r.value.edges, edge] }, revision: before.revision + 1,
      sources: r.sources.some(s => s.conversationId === owner.conversationId && s.turnId === owner.turnId) ? r.sources : [...r.sources, { conversationId: owner.conversationId, turnId: owner.turnId }],
      nextVersion: Math.max(r.nextVersion, Number(node.id.slice(1)) + 1), newNodes: [...r.newNodes, node.id] };
    put(after); return after;
  }
  function prepareStagedMove(id: string, nodeId: string, boardId?: string): EvolutionChange {
    const r = get(id, boardId), node = r?.value.nodes.find(n => n.id === nodeId);
    if (!r?.cursor || !r.boardId || r.status !== 'active' || !node || !isStaged(node)) throw new Error('预设分支已失效');
    return { id, boardId: r.boardId, epoch: r.epoch, before: { cursor: r.cursor, key: r.cursorKey, destination: r.destination }, after: { cursor: { kind: 'staged', nodeId, imageId: '' }, key: key() } };
  }
  function removeStaged(id: string, nodeId: string) {
    const r = get(id), node = r?.value.nodes.find(n => n.id === nodeId);
    if (!r || !node || !isStaged(node)) throw new Error('只能删除未生成预设');
    if (!r.boardId) throw new Error('历史演进快照仅供查看');
    if (inFlight.has(flightKey(id, nodeId))) throw new Error('该分支正在生成，请等待任务结束后删除');
    const parent = locate(r, node.staged.base.record_id);
    const selected = r.cursor?.nodeId === nodeId;
    const edges = r.value.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
    const notes = Object.fromEntries(Object.entries(r.notes).filter(([k]) => k !== nodeNoteKey(nodeId) && !r.value.edges.filter(e => e.from === nodeId || e.to === nodeId).some(e => k === edgeNoteKey(e))));
    put({ ...r, value: { ...r.value, nodes: r.value.nodes.filter(n => n.id !== nodeId), edges }, notes,
      cursor: selected ? parent : r.cursor, cursorKey: selected ? key() : r.cursorKey, revision: r.revision + 1,
      nodeLayout: Object.fromEntries(Object.entries(r.nodeLayout).filter(([id]) => id !== nodeId)), newNodes: r.newNodes.filter(id => id !== nodeId) });
  }
  function finish(binding: GenerationBinding | null) {
    if (binding) flights.delete(binding);
    if (!binding?.stagedNode) return;
    const k = flightKey(binding.id, binding.stagedNode), count = (inFlight.get(k) ?? 1) - 1;
    if (count) inFlight.set(k, count); else inFlight.delete(k);
    flightRevision.value++;
  }
  function acknowledgeOpened() {
    const r = opened.value && get(opened.value.id);
    if (r?.newNodes.length) put({ ...r, newNodes: [] });
  }
  return {
    records, opened, host, get, source, detachBoard, register, stage, prepareNext, pending, prepareStagedMove, removeStaged, finish, setStatus, activeForBoard, prepareMove, moveIssue, commitMove, begin, land, update, finalize,
    relatedTo, capacity, preparePromote, prepareRestore, workshopsFor, collectWorkshop, prepareDelivery, prepareDispatch, prepareCancel, treeIssue, commitTree, treeKey: semantic,
    generatingNodes(id: string): ReadonlySet<string> {
      void flightRevision.value;
      return new Set(get(id)?.value.nodes.filter(n => isStaged(n) && inFlight.has(flightKey(id, n.id))).map(n => n.id));
    },
    /** CHAT short codes are branch-relative. Rebind by immutable record, never by code. */
    relabel(pictures: readonly Picture[]) {
      for (const r of records.value) {
        const labels=new Map<string,string>(), used=new Set<string>();
        for(const n of r.value.nodes)for(const id of n.image_ids) {
          const p=pictures.find(p=>p.id===r.pictureRefs[id]?.record_id);
          if(p){labels.set(id,p.label);used.add(p.label);}
        }
        for(const n of r.value.nodes)for(const id of n.image_ids)if(!labels.has(id)) {let next=id;while(used.has(next))next+='·失效';labels.set(id,next);used.add(next);}
        if([...labels].every(([a,b])=>a===b))continue;
        const rename=(id:string)=>labels.get(id)??id;
        const cursor=(c:EvolutionCursor|null):EvolutionCursor|null=>c?.kind==='staged'?c:c?{...c,imageId:rename(c.imageId)}:null;
        put({...r,revision:r.revision+1,cursor:cursor(r.cursor),final:cursor(r.final),
          pictureRefs:Object.fromEntries([...labels].map(([a,b])=>[b,{...r.pictureRefs[a],tag:b}])),
          value:{...r.value,nodes:r.value.nodes.map(n=>isStaged(n)?{...n,staged:{...n.staged,base:{...n.staged.base,tag:rename(n.staged.base.tag)}}}:({...n,cover:rename(n.cover),...(n.delivery?{delivery:{...n.delivery,samples:Object.fromEntries(Object.entries(n.delivery.samples).map(([id,v])=>[rename(id),v]))}}:{}),image_ids:n.image_ids.map(rename),recipes:Object.fromEntries(n.image_ids.map(id=>[rename(id),selectRetrospectSample(n,id).recipe]))})),
            sampleBases:Object.fromEntries(Object.entries(r.value.sampleBases??{}).map(([a,b])=>[rename(a),rename(b)]))}});
      }
    },
    arrange(id: string, layout: NodeLayout) {
      const r = get(id); if (!r) return;
      const next = Object.fromEntries(Object.entries(layout).filter(([node, p]) => (r.value.nodes.some(n => n.id === node) || r.workshops.some(t => t.id === node)) && Number.isFinite(p.x) && Number.isFinite(p.cy) && Number.isSafeInteger(p.z)));
      if (JSON.stringify(next) !== JSON.stringify(r.nodeLayout)) put({ ...r, nodeLayout: next });
    },
    arrangeContinuation(id: string, anchor: ContinuationAnchor, boardId?: string) {
      const r = get(id, boardId);
      if (!r || r.status !== 'active' || pending(id, boardId)?.nodeId !== anchor.nodeId || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.cy) || !Number.isSafeInteger(anchor.z)) return;
      placements.set(r.destination!.id, anchor);
      if (JSON.stringify(anchor) !== JSON.stringify(r.continuationAnchor)) put({ ...r, continuationAnchor: anchor });
    },
    rememberCamera(id: string, camera: GraphCamera) {
      const r = get(id);
      if (!r || ![camera.x, camera.y, camera.scale, camera.fitted].every(Number.isFinite) || camera.scale <= 0 || camera.fitted <= 0) return;
      if (JSON.stringify(camera) !== JSON.stringify(r.graphCamera)) put({ ...r, graphCamera: { ...camera } });
    },
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
    dispose() { inFlight.clear(); flights.clear(); landedDestinations.clear(); placements.clear(); rememberedLayouts.clear(); records.value = []; opened.value = null; host.value = null; },
  };
}
export type Retrospects = ReturnType<typeof createRetrospects>;
/** Parent links remain the sole topology truth; final highlighting is a derived view. */
export function finalPath(r: Pick<ReviewRecord, 'value' | 'final'>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (let id = r.final?.nodeId; id && !ids.has(id); id = r.value.edges.find(e => e.to === id)?.from) ids.add(id);
  return ids;
}
