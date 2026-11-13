import type { DraftState, EditReferencesStep } from './types.ts';
import type { Picture } from '../library.ts';
import { handoffImage } from './validate.ts';
import { checkShape } from './schema-check.ts';

export const editReferencesSchema = { type: 'array', maxItems: 16, description: 'EDIT 的完整参考图列表（不含底图）；省略保留，空数组清空。按顺序发送，每张可说明用途。', items: {
  type: 'object', additionalProperties: false, required: ['image'], properties: {
    image: { type: 'string', maxLength: 1024, description: '已读取的图片编号（含 #aN、#e1:r1）或企划相对图片路径' },
    usage: { type: 'string', maxLength: 500, description: '如参考此图的服装，保留底图人物与构图' },
  },
} };
export const editReferencesStepSchema = { type: 'object', additionalProperties: false, required: ['kind','references'], properties: {
  kind: {type:'string',enum:['edit_references']}, references: editReferencesSchema,
} };
export function parseEditReferences(raw: Record<string, unknown>, base: DraftState, library: readonly Picture[]): EditReferencesStep {
  checkShape(raw, editReferencesStepSchema, '编辑参考图');
  const existing = base.edit?.config.references ?? [];
  let next = Math.max(base.edit?.nextReferenceNumber ?? 1, ...existing.map(r => Number(r.label.slice(1))+1));
  const items = (raw.references as {image:string;usage?:string}[]).map(r => {
    const image = handoffImage(r.image, base, library), same = existing.find(ref => ref.id === image.ref);
    return { image, reference: { id: same?.id ?? crypto.randomUUID(), label: same?.label ?? `R${next++}`, name: same?.name ?? image.label, usage: r.usage ?? same?.usage ?? '' } };
  });
  if (new Set(items.map(i => i.image.binding?.entity_key || i.image.ref)).size !== items.length) throw new Error('参考图列表包含重复图片');
  return {kind:'edit_references',items};
}
