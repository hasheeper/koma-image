/** Read source dimensions without decoding pixels; the browser also decodes uploads. */
export function imageDimensions(dataUrl) {
  const bytes = Uint8Array.from(
    atob(dataUrl.slice(dataUrl.indexOf(",") + 1)),
    (c) => c.charCodeAt(0),
  );
  const view = new DataView(bytes.buffer);
  const ascii = (start, length) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  let width, height;
  if (bytes.length >= 24 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 3 < bytes.length; ) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 7
      ) {
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (
    bytes.length >= 20 &&
    ascii(0, 4) === "RIFF" &&
    ascii(8, 4) === "WEBP"
  ) {
    // Walk chunks: metadata may precede the pixel chunk in valid WebP files.
    for (let offset = 12; offset + 8 <= bytes.length; ) {
      const type = ascii(offset, 4),
        length = view.getUint32(offset + 4, true),
        start = offset + 8;
      if (start + length > bytes.length) break;
      const uint24 = (n) =>
        bytes[n] | (bytes[n + 1] << 8) | (bytes[n + 2] << 16);
      if (type === "VP8X" && length >= 10) {
        width = uint24(start + 4) + 1;
        height = uint24(start + 7) + 1;
        break;
      }
      if (type === "VP8L" && length >= 5 && bytes[start] === 0x2f) {
        const bits = view.getUint32(start + 1, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
        break;
      }
      if (
        type === "VP8 " &&
        length >= 10 &&
        bytes[start + 3] === 0x9d &&
        bytes[start + 4] === 1 &&
        bytes[start + 5] === 0x2a
      ) {
        width = view.getUint16(start + 6, true) & 0x3fff;
        height = view.getUint16(start + 8, true) & 0x3fff;
        break;
      }
      offset = start + length + (length % 2);
    }
  }
  if (!width || !height)
    throw new Error("无法读取图片尺寸，请重新导出为 PNG、JPEG 或 WebP");
  return { width, height };
}
