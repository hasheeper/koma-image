/** Replace only the binary mask's white pixels. No cropping, scaling or feathering. */
export async function composeInpaint(source: string, mask: string, result: Blob, signal: AbortSignal): Promise<Blob> {
  const decode = (data: string) => {
    const bytes = Uint8Array.from(atob(data.slice(data.indexOf(",") + 1)), c => c.charCodeAt(0));
    return createImageBitmap(new Blob([bytes], { type: "image/png" }));
  };
  const bitmaps: ImageBitmap[] = [];
  try {
    signal.throwIfAborted();
    const base = await decode(source); bitmaps.push(base);
    const selection = await decode(mask); bitmaps.push(selection);
    const generated = await createImageBitmap(result); bitmaps.push(generated);
    signal.throwIfAborted();
    const { width, height } = base;
    if ([selection, generated].some(b => b.width !== width || b.height !== height)) throw new Error("重绘结果尺寸与底图不一致，未写入编辑版本，请勿重复提交");
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器不支持重绘合成");
    const pixels = (bitmap: ImageBitmap) => { context.clearRect(0, 0, width, height); context.drawImage(bitmap, 0, 0); return context.getImageData(0, 0, width, height); };
    const original = pixels(base), selected = pixels(selection).data, replacement = pixels(generated).data;
    for (let i = 0; i < selected.length; i += 4) {
      if (selected[i] < 128 || selected[i + 3] < 128) continue;
      original.data[i] = replacement[i]; original.data[i + 1] = replacement[i + 1];
      original.data[i + 2] = replacement[i + 2]; original.data[i + 3] = replacement[i + 3];
    }
    context.putImageData(original, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    signal.throwIfAborted();
    return blob;
  } finally { for (const bitmap of bitmaps) bitmap.close(); }
}
