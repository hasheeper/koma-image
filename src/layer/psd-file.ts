import type { ImportedPsd } from './psd-import.ts';
import type { PsdImportReply } from './psd-import.worker.ts';

export const layerFileAccept = 'image/png,image/jpeg,image/webp,.psd,image/vnd.adobe.photoshop,image/x-photoshop';

export function isPsdFile(name: string, type: string) {
  return /\.ps[db]$/i.test(name) || /photoshop/i.test(type);
}

export async function readLayerPsd(bytes: ArrayBuffer, signal: AbortSignal): Promise<ImportedPsd> {
  signal.throwIfAborted();
  const worker = new Worker(new URL('./psd-import.worker.ts', import.meta.url), { type: 'module' });
  let abort: (() => void) | undefined;
  try {
    return await new Promise<ImportedPsd>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      worker.onmessage = ({ data }: MessageEvent<PsdImportReply>) => {
        if ('error' in data) reject(new Error(`PSD 导入失败：${data.error}`));
        else resolve(data.document);
      };
      worker.onerror = worker.onmessageerror = () => reject(new Error('PSD 读取中断，请重新导入文件'));
      worker.postMessage(bytes, [bytes]);
    });
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
    worker.terminate();
  }
}
