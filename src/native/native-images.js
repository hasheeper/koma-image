function imageBlob(bytes) {
  const mime = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216 ? "image/jpeg"
    : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" ? "image/webp" : null;
  if (!mime) throw new Error("原生接口未返回有效图片，请勿重复提交");
  return new Blob([bytes], { type: mime });
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** Native responses can be a ZIP even when Content-Type is octet-stream. */
export async function decodeNativeImages(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint32(0, true) !== 0x04034b50) return [imageBlob(bytes)];
  const fail = () => { throw new Error("原生图片包损坏或格式不支持，请勿重复提交"); };
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < Math.max(0, bytes.length - 65557)) return fail();
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true), totalSize = 0;
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)
    || view.getUint16(end + 8, true) !== count || count > 16 || offset + directorySize > end) return fail();
  const blobs = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) return fail();
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true), packed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
    const nameSize = view.getUint16(offset + 28, true), extraSize = view.getUint16(offset + 30, true), commentSize = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true), next = offset + 46 + nameSize + extraSize + commentSize;
    if (next > end) return fail();
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameSize));
    offset = next;
    if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
    totalSize += size;
    if (flags & 1 || ![0, 8].includes(method) || size > 32 * 1024 * 1024 || totalSize > 64 * 1024 * 1024
      || local + 30 > end || view.getUint32(local, true) !== 0x04034b50) return fail();
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packed > end) return fail();
    let decoded = bytes.slice(start, start + packed);
    if (method === 8) {
      let stream;
      try { stream = new Blob([decoded]).stream().pipeThrough(new DecompressionStream("deflate-raw")); }
      catch { throw new Error("浏览器不支持原生图片包解压，请更新浏览器；请勿重复提交"); }
      const reader = stream.getReader(), chunks = [];
      let length = 0;
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          length += item.value.length;
          if (length > size) { await reader.cancel(); return fail(); }
          chunks.push(item.value);
        }
      } catch { return fail(); }
      decoded = new Uint8Array(length);
      let position = 0;
      for (const chunk of chunks) { decoded.set(chunk, position); position += chunk.length; }
    }
    if (decoded.length !== size || crc32(decoded) !== crc) return fail();
    blobs.push(imageBlob(decoded));
  }
  if (!blobs.length) return fail();
  return blobs;
}
