import type { PhotopeaRoles } from "./photopea-scripts.ts";

/** Inspect only PSD layer metadata. Pixel decoding remains Photopea's job.
 * The public scripting DOM does not reliably expose attached layer/vector masks. */
export function validatePhotopeaProject(buffer: ArrayBuffer, roles: PhotopeaRoles) {
  const data = new DataView(buffer);
  let pos = 0, limit = data.byteLength;
  const invalid = () => new Error("Photopea 分层快照无效，请保留分层文件后重新载入");
  function take(n: number) {
    if (!Number.isSafeInteger(n) || n < 0 || pos + n > limit) throw invalid();
    const start = pos; pos += n; return start;
  }
  const u16 = () => data.getUint16(take(2)), u32 = () => data.getUint32(take(4));
  const str = () => String.fromCharCode(...new Uint8Array(buffer, take(4), 4));
  if (str() !== "8BPS" || u16() !== 1) throw invalid();
  take(20);
  for (let i = 0; i < 2; i++) take(u32()); // Color mode / image resources.
  const layerSection = u32();
  if (!layerSection || pos + layerSection > limit) throw invalid();
  limit = pos + layerSection;
  const layerInfo = u32();
  if (!layerInfo || pos + layerInfo > limit) throw invalid();
  limit = pos + layerInfo;
  const count = Math.abs(data.getInt16(take(2))), found = new Set<number>();
  for (let i = 0; i < count; i++) {
    take(16);
    const channels = u16();
    let attached = false;
    for (let c = 0; c < channels; c++) { if (data.getInt16(take(2)) < -1) attached = true; take(4); }
    if (str() !== "8BIM") throw invalid();
    take(8); // Blend mode, opacity, clipping, flags, filler.
    const extra = u32(), end = pos + extra, previous = limit;
    if (end > limit) throw invalid();
    limit = end;
    const maskData = u32(); attached ||= maskData > 0; take(maskData);
    take(u32()); // Blending ranges.
    const nameSize = data.getUint8(take(1)); take(nameSize);
    take((4 - (nameSize + 1) % 4) % 4);
    let id = 0, effect = false;
    while (pos + 12 <= end) {
      if (str() !== "8BIM") throw invalid();
      const key = str(), length = u32(), start = take(length);
      if (key === "lyid" && length === 4) id = data.getUint32(start);
      if (key === "vmsk" || key === "vsms") attached = true;
      if (key === "lrFX" || key === "lfx2" || key === "lmfx") effect = true;
      if (length % 2) take(1);
    }
    if (id === roles.maskId || id === roles.carrierId) {
      if (found.has(id)) throw invalid();
      found.add(id);
      if (attached || effect) throw new Error("Koma 蒙版和选区辅助层须保持独立像素层，请移除附加蒙版及图层效果");
    }
    pos = end; limit = previous;
  }
  if (!found.has(roles.maskId) || !found.has(roles.carrierId)) throw invalid();
}
