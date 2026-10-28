/** NovelAI's alpha-LSB metadata, column first and MSB first. */
const signature = "stealth_pngcomp";
export const MAX_METADATA_BYTES = 32 * 1024 * 1024;
export function stealthPayload(image: { data: Uint8ClampedArray; width: number; height: number }): Uint8Array<ArrayBuffer> | null {
  const { data, width, height } = image, pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels < (signature.length + 4) * 8 || data.length < pixels * 4) return null;
  let cursor = 0;
  const byte = () => {
    let value = 0;
    for (let bit = 7; bit >= 0; bit--, cursor++) value |= (data[4 * (cursor % height * width + Math.floor(cursor / height)) + 3] & 1) << bit;
    return value;
  };
  for (const char of signature) if (byte() !== char.charCodeAt(0)) return null;
  const bits = byte() * 0x1000000 + (byte() << 16) + (byte() << 8) + byte();
  if (!bits || bits % 8 || bits > pixels - cursor || bits / 8 > MAX_METADATA_BYTES) return null;
  return Uint8Array.from({ length: bits / 8 }, byte);
}
export async function inflateMetadata(bytes: Uint8Array<ArrayBuffer>, format: CompressionFormat) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length;
      if (length > MAX_METADATA_BYTES) { await reader.cancel(); throw new Error("图片元数据过大，未读取"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
  return result;
}
export async function readStealthText(blob: Blob, bytes: Uint8Array) {
  if (typeof createImageBitmap !== "function" || bytes.length < 26 || ![4, 6].includes(bytes[25])) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width * height > 40_000_000) return null;
  const image = await createImageBitmap(blob, { imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const canvas = document.createElement("canvas");
  try {
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0);
    const payload = stealthPayload(ctx.getImageData(0, 0, canvas.width, canvas.height));
    return payload ? new TextDecoder("utf-8", { fatal: true }).decode(await inflateMetadata(payload, "gzip")) : null;
  } finally { image.close(); canvas.width = canvas.height = 0; }
}
