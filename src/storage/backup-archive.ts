/** Small ZIP32 reader/writer for our backups. Stored entries keep image bytes
 * unchanged and Blob parts avoid base64 copies of the entire collection. */
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
async function crc32(blob: Blob) {
  let crc = 0xffffffff;
  for (let at = 0; at < blob.size; at += 1024 * 1024) {
    const bytes = new Uint8Array(
      await blob.slice(at, at + 1024 * 1024).arrayBuffer(),
    );
    for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const header = (size: number) => {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
};
const invalid = () => new Error("备份文件不完整或格式不受支持，请重新导出");

export async function createArchive(
  entries: [string, Blob][],
  progress: (done: number, total: number) => void = () => {},
) {
  if (entries.length > 60_000) throw new Error("备份文件数量过多，请分批备份");
  const parts: BlobPart[] = [],
    directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0,
    done = 0;
  for (const [name, blob] of entries) {
    const path = encoder.encode(name),
      crc = await crc32(blob);
    if (
      path.length > 1024 ||
      offset + blob.size + path.length + 30 > 0xffffffff
    )
      throw new Error("备份超过 4GB，请分批备份");
    const local = header(30),
      v = local.view;
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint16(12, 0x21, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, blob.size, true);
    v.setUint32(22, blob.size, true);
    v.setUint16(26, path.length, true);
    parts.push(local.bytes, path, blob);
    const central = header(46),
      c = central.view;
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x800, true);
    c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, blob.size, true);
    c.setUint32(24, blob.size, true);
    c.setUint16(28, path.length, true);
    c.setUint32(42, offset, true);
    directory.push(central.bytes, path);
    offset += 30 + path.length + blob.size;
    progress(++done, entries.length);
  }
  const size = directory.reduce((n, p) => n + p.length, 0);
  if (offset + size + 22 > 0xffffffff)
    throw new Error("备份超过 4GB，请分批备份");
  const end = header(22),
    e = end.view;
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end.bytes], {
    type: "application/zip",
  });
}

export async function readArchive(file: Blob) {
  if (file.size < 22 || file.size > 0xffffffff) throw invalid();
  const start = Math.max(0, file.size - 65557),
    tail = new DataView(await file.slice(start).arrayBuffer());
  let end = tail.byteLength - 22;
  for (; end >= 0; end--) {
    if (
      tail.getUint32(end, true) === 0x06054b50 &&
      end + 22 + tail.getUint16(end + 20, true) === tail.byteLength
    )
      break;
  }
  if (end < 0 || tail.getUint32(end + 4, true) !== 0) throw invalid();
  const count = tail.getUint16(end + 10, true),
    size = tail.getUint32(end + 12, true),
    at = tail.getUint32(end + 16, true);
  if (
    count > 60_000 ||
    count !== tail.getUint16(end + 8, true) ||
    size > 64 * 1024 * 1024 ||
    at + size !== start + end
  )
    throw invalid();
  const bytes = new Uint8Array(await file.slice(at, at + size).arrayBuffer()),
    central = new DataView(bytes.buffer),
    items = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (
      p + 46 > size ||
      central.getUint32(p, true) !== 0x02014b50 ||
      central.getUint16(p + 10, true) !== 0 ||
      central.getUint16(p + 8, true) & 1
    )
      throw invalid();
    const length = central.getUint16(p + 28, true),
      extra = central.getUint16(p + 30, true),
      comment = central.getUint16(p + 32, true);
    if (p + 46 + length + extra + comment > size || length > 1024)
      throw invalid();
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + length));
    const crc = central.getUint32(p + 16, true),
      packed = central.getUint32(p + 20, true),
      unpacked = central.getUint32(p + 24, true),
      offset = central.getUint32(p + 42, true);
    if (
      packed !== unpacked ||
      items.has(name) ||
      !/^[a-zA-Z0-9_./-]+$/.test(name) ||
      name.includes("..") ||
      name.startsWith("/") ||
      offset + 30 > at
    )
      throw invalid();
    const local = new DataView(
      await file.slice(offset, offset + 30).arrayBuffer(),
    );
    const nameLength = local.getUint16(26, true),
      extraLength = local.getUint16(28, true),
      dataAt = offset + 30 + nameLength + extraLength;
    if (
      local.getUint32(0, true) !== 0x04034b50 ||
      local.getUint16(8, true) !== 0 ||
      local.getUint16(6, true) & 1 ||
      nameLength !== length ||
      dataAt + packed > at ||
      decoder.decode(
        await file.slice(offset + 30, offset + 30 + nameLength).arrayBuffer(),
      ) !== name
    )
      throw invalid();
    items.set(name, { dataAt, size: unpacked, crc });
    p += 46 + length + extra + comment;
  }
  if (p !== size) throw invalid();
  return {
    has: (name: string) => items.has(name),
    async read(
      name: string,
      type = "application/octet-stream",
      maxBytes = 128 * 1024 * 1024,
    ) {
      const item = items.get(name);
      if (!item || item.size > maxBytes) throw invalid();
      const blob = file.slice(item.dataAt, item.dataAt + item.size, type);
      if ((await crc32(blob)) !== item.crc) throw invalid();
      return blob;
    },
  };
}
