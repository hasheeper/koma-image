import test from 'node:test';
import assert from 'node:assert/strict';
import { matchBoundaryColor } from '../src/domain/boundary-color.ts';

function fixture(w=96,h=64) {
 const source=new Uint8ClampedArray(w*h*4),result=new Uint8ClampedArray(source.length),bits=new Uint8Array(Math.ceil(w*h/8)),alpha=new Uint8ClampedArray(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=y*w+x,i=p*4,v=90+(x%13)*3+(y%7)*2;
  source.set([v,v+12,v+20,255],i);result.set([v-15,v-3,v+5,255],i);
 }
 const rect=(x,y,rw,rh)=>{for(let yy=y;yy<y+rh;yy++)for(let xx=x;xx<x+rw;xx++){const p=yy*w+xx;bits[p>>3]|=1<<(p&7);alpha[p]=255;}};
 return {source,result,mask:{width:w,height:h,bits},alpha,rect};
}
test('boundary correction reduces edge error independently for disjoint regions, preserves source and deep interior',()=>{
 const f=fixture();f.rect(6,6,34,50);f.rect(54,6,34,50);
 // The second region is brighter instead of darker.
 for(let y=0;y<64;y++)for(let x=48;x<96;x++){let i=(y*96+x)*4;for(let c=0;c<3;c++)f.result[i+c]=f.source[i+c]+15;}
 const original=f.source.slice(),raw=f.result.slice();
 const summary=matchBoundaryColor(f.source,f.result,f.mask,f.alpha,3);assert.equal(summary.matched,2);
 let before=0,after=0;
 for(const x of [6,39,54,87])for(let y=8;y<54;y++)for(let c=0;c<3;c++){let i=(y*96+x)*4+c;before+=Math.abs(raw[i]-original[i]);after+=Math.abs(f.result[i]-original[i]);}
 assert.ok(after<before*.4,`${after} < ${before}`);assert.deepEqual(f.source,original);
 const center=(32*96+22)*4;assert.deepEqual(f.result.slice(center,center+4),raw.slice(center,center+4));
 for(let p=0;p<f.alpha.length;p++)if(!f.alpha[p])assert.deepEqual(f.result.slice(p*4,p*4+4),raw.slice(p*4,p*4+4));
});
test('full masks, transparent boundary samples and black/white samples conservatively skip matching',()=>{
 for(const mode of ['full','transparent','black','white']){
  const f=fixture();f.rect(8,8,60,40);if(mode==='full'){f.mask.bits.fill(255);f.alpha.fill(255);}
  if(mode==='transparent')for(let i=3;i<f.result.length;i+=4)f.result[i]=0;
  if(mode==='black'||mode==='white')for(let i=0;i<f.result.length;i+=4)f.result.set([mode==='black'?0:255,mode==='black'?0:255,mode==='black'?0:255,255],i);
  const before=f.result.slice();assert.equal(matchBoundaryColor(f.source,f.result,f.mask,f.alpha,4).matched,0);assert.deepEqual(f.result,before);
 }
});
test('flat-color samples use a bounded mean shift without variance explosions',()=>{
 const f=fixture();f.rect(8,8,60,40);
 for(let i=0;i<f.result.length;i+=4){f.result.set([70,80,90,255],i);f.source.set([90,100,110,255],i);}
 assert.equal(matchBoundaryColor(f.source,f.result,f.mask,f.alpha,4).matched,1);
 const edge=(10*96+8)*4;assert.ok(f.result[edge]>70&&f.result[edge]<=90);assert.equal(f.result[edge+3],255);
});
