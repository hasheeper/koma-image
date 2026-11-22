import type { Picture } from '../ask/library.ts';
import { png } from './images.ts';
import type { LayerProject, StackLayer } from './project.ts';

export type ScalpelReference = NonNullable<LayerProject['scalpelReferences']>[number];
export const layerPictureId = (id: string) => '#lref-layer-' + id;
export const filePictureId = (id: string) => '#lref-file-' + id;

export interface ReferenceSource {
  picture: string;
  kind: 'layer' | 'file';
  name: string;
  width: number;
  height: number;
  image: StackLayer | Blob;
}

export function referenceSources(p: LayerProject): ReferenceSource[] {
  return [
    ...(p.referenceFiles ?? []).map(f => ({
      picture: filePictureId(f.id), kind: 'file' as const, name: f.name,
      width: f.width, height: f.height, image: f.blob,
    })),
    ...p.layers.filter(l => !l.archived).reverse().map(l => ({
      picture: layerPictureId(l.id), kind: 'layer' as const, name: [...(l.groups ?? []), l.name].join(' / '),
      width: l.width, height: l.height, image: l,
    })),
  ];
}

export function referenceBlob(source: ReferenceSource) {
  const image = source.image;
  return image instanceof Blob ? image : png({ width: image.width, height: image.height, data: image.pixels });
}

/** Capture immutable layer pixels at turn start, encoding only pictures the artist asks ASK to inspect. */
export function referencePictures(p: LayerProject) {
  const pictures = new Map<string, () => Picture>();
  for (const source of referenceSources(p)) {
    const label = source.picture;
    let picture: Picture | undefined;
    pictures.set(label, () => picture ??= {
      id: label, label, aliases: [label], origins: [], blob: referenceBlob(source), turnOnly: true,
      createdAt: 0, size: { width: source.width, height: source.height }, params: {},
    });
  }
  return pictures;
}

/** Explicit inputs always travel. Include the unmarked local frame whenever an input slot remains. */
export function scalpelInputs(maxImages: number, references: number, hasOccluders: boolean) {
  const required = 1 + Number(hasOccluders) + references;
  const context = required < maxImages;
  return {
    context, workspaceIndex: context ? 2 : 1,
    occluderIndex: hasOccluders ? (context ? 3 : 2) : undefined,
    firstReference: 2 + Number(context) + Number(hasOccluders),
    count: required + Number(context),
    issue: required > maxImages
      ? `当前组合需要 ${required} 张输入，模型最多接收 ${maxImages} 张。请减少参考或遮挡图，或切换模型。` : '',
  };
}
