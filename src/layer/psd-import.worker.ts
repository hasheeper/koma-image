import { initializeCanvas } from 'ag-psd';
import { decodeLayerPsd, type ImportedPsd } from './psd-import.ts';

export type PsdImportReply = { document: ImportedPsd } | { error: string };

// useImageData decodes directly to RGBA without a DOM canvas or premultiplication.
initializeCanvas(() => { throw new Error('无法在 PSD 像素导入中创建画布'); }, (w, h) => new ImageData(w, h));
self.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
  try {
    const document = decodeLayerPsd(data);
    const planes = [document.reference.data, ...document.layers.map(layer => layer.pixels)];
    const transfer = [...new Set(planes.map(plane => plane.buffer).filter(b => b instanceof ArrayBuffer))];
    self.postMessage({ document } satisfies PsdImportReply, { transfer });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies PsdImportReply);
  }
};
