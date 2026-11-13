import type { Retrospect, RetrospectNode } from './model.ts';
import type { PictureRefs } from '../edit-context.ts';

export type DeliveryKind = 'stage' | 'rejected';
/** Page-owned association; native services retain all pixels and editing history. */
export interface WorkshopTicket {
  readonly id: string;
  readonly target: string;
  readonly name: string;
  readonly sourceRecordId: string;
  readonly anchorRecordId: string;
  readonly nodeId: string | null;
  readonly results: readonly string[];
  /** Trials already settled by the last explicit delivery, including unselected attempts. */
  readonly deliveredCount: number;
  readonly inputs: readonly string[];
}
export function pendingWorkshopResult(ticket: WorkshopTicket): string | null {
  return ticket.results.length > ticket.deliveredCount ? ticket.results.at(-1)! : null;
}
export const workshopPending = (ticket: WorkshopTicket) => !ticket.nodeId || pendingWorkshopResult(ticket) !== null;
export interface WorkshopDelivery {
  readonly sourceRecordId: string;
  readonly samples: Readonly<Record<string, { readonly kind: DeliveryKind; readonly target: string }>>;
}
export function assertForest(value: Retrospect) {
  const ids = new Set(value.nodes.map(n => n.id)), parents = new Map<string, string>();
  if (ids.size !== value.nodes.length) throw new Error('演进节点编号重复');
  for (const e of value.edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || parents.has(e.to)) throw new Error('演进连线须为单父关系');
    parents.set(e.to, e.from);
  }
  for (const id of ids) {
    const seen = new Set<string>();
    for (let cursor: string | undefined = id; cursor; cursor = parents.get(cursor)) {
      if (seen.has(cursor)) throw new Error('演进连线不能成环');
      seen.add(cursor);
    }
  }
}
/** ASK may regroup IMAGE history, but delivered native records remain immutable evidence. */
export function preserveDeliveries(value: Retrospect, previous: { value: Retrospect; pictureRefs: PictureRefs }, refs: PictureRefs): Retrospect {
  const nodes: RetrospectNode[] = [...value.nodes], edges = [...value.edges];
  for (const old of previous.value.nodes.filter(n => n.delivery)) {
    const reused = nodes.find(n => n.id === old.id);
    if (reused && (reused.image_ids.length !== old.image_ids.length || reused.image_ids.some(tag => !old.image_ids.some(id => previous.pictureRefs[id]?.record_id === refs[tag]?.record_id))))
      throw new Error(`工坊交付 ${old.id} 须完整保留，不能重划交付样本`);
    if (nodes.some(n => n.id !== old.id && n.image_ids.some(tag => old.image_ids.some(id => previous.pictureRefs[id]?.record_id === refs[tag]?.record_id))))
      throw new Error(`工坊交付 ${old.id} 的图片不能移入其他阶段`);
    if (reused) nodes[nodes.indexOf(reused)] = old; else nodes.push(old);
  }
  for (const node of nodes.filter(n => n.delivery)) {
    const parent = nodes.find(n => n.image_ids.some(tag => refs[tag]?.record_id === node.delivery!.sourceRecordId));
    if (!parent) throw new Error(`整理不能移除工坊交付 ${node.id} 的来源样本`);
    const edge = { from: parent.id, to: node.id, summary: previous.value.edges.find(e => e.to === node.id)?.summary ?? node.label };
    const index = edges.findIndex(e => e.to === node.id);
    if (index < 0) edges.push(edge); else edges[index] = edge;
  }
  const result = { ...value, nodes, edges };
  assertForest(result);
  return result;
}
