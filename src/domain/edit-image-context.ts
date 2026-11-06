import { annotationSummary } from './region-annotation.ts';
import type { EditorSession } from '../services/editor.ts';
import type { AnnotationSnapshot } from './region-annotation.ts';
import type { MaskBitmap } from '../native/edit-input.ts';
import type { MaskSummary } from './mask-summary.ts';
import { summarizeMaskBitmap } from './mask-summary.ts';
import { annotationAlignment } from './region-annotation.ts';
import { qualifiedEditLabel } from './edit-identity.ts';

export interface ComparisonDisplay { mode:'source'|'raw'|'composite'; preview:'idle'|'loading'|'ready'|'error' }
const frozenMaskSummaries=new WeakMap<MaskBitmap,MaskSummary>();
/** A metadata-only projection: no blobs, pixel buffers, URLs or automatic composition. */
export function imageEditContext(s:EditorSession, annotation?:AnnotationSnapshot, display?:ComparisonDisplay) {
  const viewed=s.versions.find(v=>v.id===s.viewId), info=viewed?.comparison;
  const source=s.versions.find(v=>v.id===info?.sourceId), raw=s.versions.find(v=>v.id===info?.rawId), composite=s.versions.find(v=>v.id===info?.compositeId);
  let comparison;
  if(info&&source&&raw) {
    let mask:MaskSummary={has_mask:false,status:'ready'};
    if(info.mask) { mask=frozenMaskSummaries.get(info.mask)??summarizeMaskBitmap(info.mask);frozenMaskSummaries.set(info.mask,mask); }
    const compatible=!!annotationAlignment(source,raw);
    comparison={ source:qualifiedEditLabel(s,source), raw:qualifiedEditLabel(s,raw), composite:composite?qualifiedEditLabel(s,composite):null,
      source_size:{width:source.width,height:source.height},raw_size:{width:raw.width,height:raw.height},
      frozen_mask:mask,frozen_edges:info.edges,compatible,
      status:composite?'applied':!mask.has_mask?'no_mask':!compatible?'incompatible':'awaiting_review',
      can_apply:!composite&&mask.has_mask&&compatible,requires_manual_review:true,
      display:display??{mode:composite?.id===viewed?.id?'composite':'raw',preview:'idle'} };
  }
  const base=s.versions.find(v=>v.id===s.baseId);
  return structuredClone({ settings:s.imageEdit, comparison:comparison??null,
    annotations:annotation&&base&&annotation.image.record_id===base.recordId&&annotation.image.entity_key===base.entity_key
      ? {image:qualifiedEditLabel(s,base),width:annotation.width,height:annotation.height,regions:annotationSummary(annotation.regions)} : null });
}
