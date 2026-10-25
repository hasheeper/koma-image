/** Binary references remain outside Vue and JSON form state. */
export const bytesBase64 = (bytes: Uint8Array) => {
  let result = "";
  for (let i = 0; i < bytes.length; i += 32768) result += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(result);
};
export const blobBase64 = async (blob: Blob) => bytesBase64(new Uint8Array(await blob.arrayBuffer()));
export const sha256 = async (value: Blob | string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", typeof value === "string" ? new TextEncoder().encode(value) : await value.arrayBuffer())), b => b.toString(16).padStart(2, "0")).join("");
export function base64Blob(value: unknown, type = "application/octet-stream", limit = 8 * 1024 * 1024): Blob {
  if (typeof value !== "string" || !value.length || value.length > Math.ceil(limit / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("参考文件编码无效或过大");
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (bytes.length > limit) throw new Error("参考文件过大");
  return new Blob([bytes], { type });
}
export async function referenceBitmap(blob: Blob) {
  if (!/^image\/(png|jpeg|webp)$/.test(blob.type) || !blob.size || blob.size > 16 * 1024 * 1024) throw new Error("参考图片支持 PNG、JPEG、WebP，单张最多 16MB");
  const bitmap = await createImageBitmap(blob);
  if (bitmap.width * bitmap.height > 40_000_000) { bitmap.close(); throw new Error("参考图片最多 4000 万像素"); }
  return bitmap;
}
const png = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("参考图片处理失败")), "image/png"));
export async function preciseImage(blob: Blob) {
  const image = await referenceBitmap(blob);
  try {
    const [width, height] = [[1024,1536], [1536,1024], [1472,1472]].reduce((best, size) => Math.abs(image.width / image.height - size[0] / size[1]) < Math.abs(image.width / image.height - best[0] / best[1]) ? size : best);
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    const scale = Math.min(width / image.width, height / image.height), w = Math.round(image.width * scale), h = Math.round(image.height * scale);
    ctx.drawImage(image, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h);
    return blobBase64(await png(canvas));
  } finally { image.close(); }
}
/** Bounded binary reader also covers the body-consumption phase of an encode request. */
export async function readEncoding(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Vibe 编码返回为空");
  const abort = () => { void reader.cancel(signal.reason); };
  signal.addEventListener("abort", abort, { once: true });
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read(); signal.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error("Vibe 编码返回过大"); }
      chunks.push(value);
    }
    if (!size) throw new Error("Vibe 编码返回为空");
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return bytesBase64(bytes);
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
export async function imageBase64(value: unknown, limit = 16 * 1024 * 1024) {
  const raw = base64Blob(value,"application/octet-stream",limit), bytes = new Uint8Array(await raw.slice(0,16).arrayBuffer());
  const type = bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71 ? "image/png" : bytes[0]===255 && bytes[1]===216 ? "image/jpeg" : String.fromCharCode(...bytes.slice(0,4))==="RIFF" && String.fromCharCode(...bytes.slice(8,12))==="WEBP" ? "image/webp" : null;
  if (!type) throw new Error("参考文件没有有效图片");
  return new Blob([raw],{type});
}
