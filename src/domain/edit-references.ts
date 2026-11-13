/** Lightweight page-local identities; image bytes belong to EDIT's resource pool. */
export interface EditReference { id: string; label: string; name: string; usage: string }
export interface ReferenceImage extends EditReference { blob: Blob }
export const editReferenceLimit = 16;
export function editReferenceCapacity(maxImages: number, hasGuide = false, markup = false, textOnly = false) {
  const guideSlot = hasGuide && !markup && !(textOnly && maxImages < 2) ? 1 : 0;
  return Math.min(editReferenceLimit, Math.max(0, maxImages - 1 - guideSlot));
}
export function validateEditReferences(refs: readonly EditReference[]) {
  if (refs.length > editReferenceLimit || new Set(refs.map(r => r.id)).size !== refs.length || new Set(refs.map(r => r.label)).size !== refs.length)
    throw new Error('参考图重复或超过 16 张');
  if (refs.some(r => !r.id || !/^R[1-9]\d*$/.test(r.label) || typeof r.name !== 'string' || typeof r.usage !== 'string' || r.usage.length > 500))
    throw new Error('参考图编号或用途无效');
}
/** R labels remain stable when reordered or when switching annotation transport. */
export function referenceInstructions(refs: readonly EditReference[], firstImage: number, indices?: readonly number[]): string {
  validateEditReferences(refs);
  return refs.length ? ['参考图用途（首张为修改底图）：', ...refs.map((r, i) => `${r.label} = 第 ${indices?.[i] ?? firstImage + i} 张图${r.usage.trim() ? `：${r.usage.trim()}` : '，按修改说明参考其内容'}。`)].join('\n') : '';
}
