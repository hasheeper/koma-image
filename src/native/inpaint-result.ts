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

/** GPT/Gemini raw outputs are reviewed first; callers invoke this only for preview/apply. */
export async function composeAnnotatedResult(source: Blob, result: Blob, snapshot: import('../domain/region-annotation.ts').AnnotationSnapshot, signal?: AbortSignal): Promise<Blob> {
  const { validateAnnotationSnapshot, validateAnnotationAreas } = await import('../domain/region-annotation.ts');
  const { annotationMask } = await import('./annotation-canvas.ts');
  validateAnnotationSnapshot(snapshot);
  validateAnnotationAreas(snapshot.regions);
  return composeMaskedResult(source, result, annotationMask(snapshot), snapshot.edges, signal);
}

/** The frozen coverage can come from a brush, imported bitmap or geometric regions. */
export async function composeMaskedResult(source: Blob, result: Blob, mask: import('./edit-input.ts').MaskBitmap, edges: import('../domain/region-annotation.ts').AnnotationEdges, signal?: AbortSignal): Promise<Blob> {
  const { annotationAlignment } = await import('../domain/region-annotation.ts');
  const { annotationAlpha } = await import('./annotation-canvas.ts');
  const base = await createImageBitmap(source);
  let generated: ImageBitmap | undefined;
  try {
    signal?.throwIfAborted();
    generated = await createImageBitmap(result);
    if (base.width !== mask.width || base.height !== mask.height || mask.bits.length !== Math.ceil(mask.width * mask.height / 8)) throw new Error('冻结蒙版尺寸不一致');
    const fit = annotationAlignment(base,generated);
    if (!fit) throw new Error('模型直出的方向或宽高比不符，无法应用蒙版');
    const {width,height}=base, canvas=new OffscreenCanvas(width,height), ctx=canvas.getContext('2d',{willReadFrequently:true});
    if (!ctx) throw new Error('当前浏览器不支持本地合成');
    ctx.drawImage(base,0,0); const original=ctx.getImageData(0,0,width,height);
    ctx.clearRect(0,0,width,height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(generated,fit.x,fit.y,fit.width,fit.height);
    const output=ctx.getImageData(0,0,width,height).data, alpha=annotationAlpha(mask,edges);
    signal?.throwIfAborted();
    for(let p=0;p<alpha.length;p++) {
      if (!alpha[p]) continue; // Preserve untouched decoded pixels exactly, including transparency.
      const at=p*4, mix=alpha[p]/255, a=original.data[at+3]/255*(1-mix), b=output[at+3]/255*mix, total=a+b;
      for(let c=0;c<3;c++) original.data[at+c]=total ? (original.data[at+c]*a+output[at+c]*b)/total : 0;
      original.data[at+3]=total*255;
    }
    ctx.putImageData(original,0,0);
    const blob=await canvas.convertToBlob({type:'image/png'});signal?.throwIfAborted();return blob;
  } finally { base.close();generated?.close(); }
}
