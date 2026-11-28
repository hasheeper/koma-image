import { shallowRef } from 'vue';
import type { Editor } from './editor.ts';
import type { MaskBitmap } from '../native/edit-input.ts';
import type { AnnotationEdges } from '../domain/region-annotation.ts';
import type { CompositeOptions } from '../native/inpaint-result.ts';

export interface FusionInput {
  key: string;
  title: string;
  source: Blob;
  raw: Blob;
  mask: MaskBitmap;
  edges: AnnotationEdges;
  options: CompositeOptions;
  valid: () => boolean;
  alive?: () => boolean;
  cancel?: (keep: boolean) => void;
  apply: (blob: Blob) => Promise<void>;
}

export interface PhotopeaFolder {
  id: number;
  name: string;
  visible: boolean;
}

export interface PhotopeaReturnedLayer {
  id: number;
  name: string;
  groups: PhotopeaFolder[];
  visible: boolean;
  locked: boolean;
  blob: Blob;
}

export interface PhotopeaLayerResult {
  width: number;
  height: number;
  layers: PhotopeaReturnedLayer[];
  skipped: string[];
}

/** Koma identities for the layer IDs written into this Photopea document's PSD. */
export interface PhotopeaLayerBinding {
  documentId: string;
  groups: ReadonlyMap<number, string>;
  initialLayers?: ReadonlyMap<number, string>;
}

export interface LayerPhotopeaInput {
  key: string;
  revision: number;
  title: string;
  width: number;
  height: number;
  psd: () => { blob: Blob; groups: ReadonlyMap<number, string>; initialLayers: ReadonlyMap<number, string> };
  valid: () => boolean;
  alive?: () => boolean;
  cancel?: (keep: boolean) => void;
  apply: (result: PhotopeaLayerResult, binding: PhotopeaLayerBinding) => Promise<number | void>;
}

export type PhotopeaTask = { id: string; title: string } & (
  | { editor: ReturnType<Editor['beginExternalEdit']>; fusion?: undefined; layer?: undefined }
  | { editor?: undefined; fusion: FusionInput; layer?: undefined }
  | { editor?: undefined; fusion?: undefined; layer: LayerPhotopeaInput }
);

export function createPhotopea() {
  const task = shallowRef<PhotopeaTask>(),
    created = shallowRef(false);
  return {
    task,
    created,
    open(value: PhotopeaTask) {
      if (task.value) throw new Error('请先完成当前高级编辑');
      created.value = true;
      task.value = value;
    },
    close(id: string) {
      if (task.value?.id === id) {
        task.value.fusion?.cancel?.(false);
        task.value.layer?.cancel?.(false);
        task.value = undefined;
      }
    },
  };
}
export type Photopea = ReturnType<typeof createPhotopea>;
