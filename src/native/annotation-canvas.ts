import { annotationTag, validateAnnotationSnapshot, validateAnnotationAreas } from '../domain/region-annotation.ts';
import type { AnnotationEdges, AnnotationSnapshot, RegionAnnotation } from '../domain/region-annotation.ts';
import type { MaskBitmap } from './edit-input.ts';

type PaintContext = OffscreenCanvasRenderingContext2D;
function context(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('当前浏览器不支持图片处理');
  return { canvas, ctx };
}
export function annotationPath(ctx: PaintContext, region: RegionAnnotation, width: number, height: number) {
  const b = region.bbox;
  ctx.beginPath();
  if (region.shape === 'point') return;
  if (region.shape === 'ellipse') ctx.ellipse((b.x+b.w/2)*width, (b.y+b.h/2)*height, b.w*width/2, b.h*height/2, 0, 0, Math.PI*2);
  else if (region.shape === 'rect') ctx.rect(b.x*width, b.y*height, b.w*width, b.h*height);
  else { region.points!.forEach((p,i) => i ? ctx.lineTo(p.x*width,p.y*height) : ctx.moveTo(p.x*width,p.y*height)); ctx.closePath(); }
}
export function annotationMask(value: AnnotationSnapshot): MaskBitmap {
  validateAnnotationSnapshot(value);
  validateAnnotationAreas(value.regions);
  const { width, height } = value, { ctx } = context(width,height);
  ctx.fillStyle = '#fff';
  for (const r of value.regions) { annotationPath(ctx,r,width,height); ctx.fill(); }
  const rgba = ctx.getImageData(0,0,width,height).data, bits = new Uint8Array(Math.ceil(width*height/8));
  for (let p=0;p<width*height;p++) if (rgba[p*4+3] > 32) bits[p>>3] |= 1<<(p&7);
  return { width,height,bits };
}
export function unionMasks(a: MaskBitmap, b: MaskBitmap): MaskBitmap {
  if (a.width !== b.width || a.height !== b.height) throw new Error('蒙版尺寸不一致');
  return { width:a.width, height:a.height, bits:a.bits.map((n,i) => n | b.bits[i]) };
}
export async function annotationPreview(source: Blob, value: AnnotationSnapshot): Promise<Blob> {
  validateAnnotationSnapshot(value);
  const bitmap = await createImageBitmap(source);
  try {
    if (bitmap.width !== value.width || bitmap.height !== value.height) throw new Error('批注来源尺寸已变化');
    const { width, height } = value, { canvas, ctx } = context(width,height), unit = Math.max(1,Math.min(width,height)/700);
    ctx.drawImage(bitmap,0,0);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const stroke = () => { for (const [color, weight] of [['rgba(0,0,0,.5)', 7], ['#fff', 4.5], ['#7c3aed', 2.2]] as const) { ctx.strokeStyle=color; ctx.lineWidth=weight*unit; ctx.stroke(); } };
    for (const r of value.regions) if (r.shape !== 'point') {
      annotationPath(ctx,r,width,height); ctx.fillStyle='rgba(124,58,237,.16)';ctx.fill();stroke();
    }
    value.regions.forEach((r,i) => {
      const tag = annotationTag(r, i+1, width, height, unit*1.5);
      if (r.shape === 'point') {
        const x=r.bbox.x*width,y=r.bbox.y*height;
        ctx.beginPath();ctx.moveTo(x,y+(tag.below?9:-9)*unit);ctx.lineTo(x,tag.below?tag.y:tag.y+tag.h);stroke();
        ctx.beginPath();ctx.arc(x,y,9*unit,0,Math.PI*2);stroke();
      }
      ctx.beginPath();ctx.roundRect(tag.x,tag.y,tag.w,tag.h,9*unit);
      ctx.strokeStyle='rgba(0,0,0,.45)';ctx.lineWidth=5*unit;ctx.stroke();ctx.fillStyle='#7c3aed';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2.2*unit;ctx.stroke();
      ctx.font=`800 ${18.75*unit}px monospace`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';ctx.fillText(String(i+1),tag.x+tag.w/2,tag.y+tag.h/2);
    });
    return await canvas.convertToBlob({type:'image/png'});
  } finally { bitmap.close(); }
}
/** Squared Euclidean distance to selected pixels, linear time and bounded scratch space. */
function distanceField(mask: MaskBitmap): Float32Array {
  const {width:w,height:h,bits}=mask, field=new Float32Array(w*h), length=Math.max(w,h);
  const f=new Float64Array(length), out=new Float64Array(length), v=new Int32Array(length), z=new Float64Array(length+1);
  const transform=(n:number) => {
    let k=0;v[0]=0;z[0]=-Infinity;z[1]=Infinity;
    for(let q=1;q<n;q++) {
      let s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);
      while(s<=z[k]) { k--;s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]); }
      v[++k]=q;z[k]=s;z[k+1]=Infinity;
    }
    k=0;
    for(let q=0;q<n;q++) { while(z[k+1]<q) k++;out[q]=(q-v[k])**2+f[v[k]]; }
  };
  for(let y=0;y<h;y++) { for(let x=0;x<w;x++) {const p=y*w+x;f[x]=(bits[p>>3] & 1<<(p&7)) ? 0 : 1e12;}transform(w);for(let x=0;x<w;x++)field[y*w+x]=out[x]; }
  for(let x=0;x<w;x++) { for(let y=0;y<h;y++)f[y]=field[y*w+x];transform(h);for(let y=0;y<h;y++)field[y*w+x]=out[y]; }
  return field;
}
/** Binary editor coverage stays binary. Soft alpha is derived only for local composition. */
export function annotationAlpha(mask: MaskBitmap, edges: AnnotationEdges): Uint8ClampedArray {
  if (![edges.dilate,edges.feather].every(n=>Number.isFinite(n)&&n>=0&&n<=.025)) throw new Error('边缘设置无效');
  const {width,height,bits}=mask, count=width*height, alpha=new Uint8ClampedArray(count);
  if (!edges.dilate && !edges.feather) { for(let p=0;p<count;p++) if(bits[p>>3]&1<<(p&7))alpha[p]=255;return alpha; }
  const short=Math.min(width,height), dilate=edges.dilate*short, sigma=edges.feather ? Math.max(1,edges.feather*short) : 0;
  const distances=distanceField(mask), {canvas,ctx}=context(width,height), pixels=ctx.createImageData(width,height);
  for(let p=0;p<count;p++) if(distances[p]<=dilate*dilate) pixels.data.fill(255,p*4,p*4+4);
  ctx.putImageData(pixels,0,0);
  if (!sigma) { for(let p=0;p<count;p++)alpha[p]=pixels.data[p*4+3];return alpha; }
  const blurred=context(width,height);
  // Canvas blur uses a Gaussian kernel. Clip its tail to an explicit finite footprint.
  blurred.ctx.filter=`blur(${sigma}px)`;blurred.ctx.drawImage(canvas,0,0);
  const rgba=blurred.ctx.getImageData(0,0,width,height).data, extent=(dilate+Math.ceil(3*sigma))**2;
  for(let p=0;p<count;p++) if(distances[p]<=extent)alpha[p]=rgba[p*4+3];
  return alpha;
}
