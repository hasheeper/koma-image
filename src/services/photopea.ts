import { shallowRef } from 'vue';
import type { Editor } from './editor.ts';
import type { MaskBitmap } from '../native/edit-input.ts';
import type { AnnotationEdges } from '../domain/region-annotation.ts';
import type { CompositeOptions } from '../native/inpaint-result.ts';

export interface FusionInput {
  key: string; title: string; source: Blob; raw: Blob; mask: MaskBitmap; edges: AnnotationEdges;
  options: CompositeOptions;
  valid: () => boolean;
  alive?: () => boolean;
  cancel?: (keep: boolean) => void;
  apply: (blob: Blob) => Promise<void>;
}
export type PhotopeaTask = { id: string; title: string } & (
  { editor: ReturnType<Editor['beginExternalEdit']>; fusion?: undefined } |
  { editor?: undefined; fusion: FusionInput }
);
export function createPhotopea() {
  const task=shallowRef<PhotopeaTask>(),created=shallowRef(false);
  return {task,created,
    open(value: PhotopeaTask) { if(task.value)throw new Error('请先完成当前高级编辑');created.value=true;task.value=value; },
    close(id: string) { if(task.value?.id===id){task.value.fusion?.cancel?.(false);task.value=undefined;} },
  };
}
export type Photopea = ReturnType<typeof createPhotopea>;
