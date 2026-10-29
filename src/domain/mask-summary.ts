import type { FocusRect } from './inpaint-focus.ts';
export interface MaskSummary {
  has_mask: boolean; status: 'ready' | 'pending' | 'error'; coverage_ratio?: number;
  bbox?: {x:number;y:number;w:number;h:number}; pixel_bbox?: FocusRect;
  region_count?: number; regions?: {bbox:{x:number;y:number;w:number;h:number};pixel_bbox:FocusRect;coverage_ratio:number}[];
  regions_truncated?: boolean;
}
/** Exact source coverage/bounds; components use a bounded 512px occupancy grid. */
export function summarizeMask(data: Uint8ClampedArray, width: number, height: number): MaskSummary {
  const stride=Math.max(1,Math.ceil(Math.max(width,height)/512)), gw=Math.ceil(width/stride),gh=Math.ceil(height/stride);
  const grid=new Uint32Array(gw*gh), visited=new Uint8Array(grid.length), queue=new Uint32Array(grid.length);
  let count=0,left=width,top=height,right=-1,bottom=-1;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) if(data[(y*width+x)*4+3]>32) {
    count++;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
    grid[Math.floor(y/stride)*gw+Math.floor(x/stride)]++;
  }
  if(!count) return {has_mask:false,status:'ready',coverage_ratio:0,region_count:0,regions:[]};
  const rect=(x:number,y:number,r:number,b:number)=>({x,y,width:r-x+1,height:b-y+1});
  const norm=(r:FocusRect)=>({x:r.x/width,y:r.y/height,w:r.width/width,h:r.height/height});
  const pixel_bbox=rect(left,top,right,bottom), components:{pixels:number;box:FocusRect}[]=[];
  for(let i=0;i<grid.length;i++) if(grid[i]&&!visited[i]) {
    let start=0,end=1,n=0,l=gw,t=gh,r=0,b=0;queue[0]=i;visited[i]=1;
    while(start<end) {
      const p=queue[start++],x=p%gw,y=Math.floor(p/gw); n+=grid[p];l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y);
      for(const q of [x? p-1:-1,x+1<gw?p+1:-1,y?p-gw:-1,y+1<gh?p+gw:-1]) if(q>=0&&grid[q]&&!visited[q]) {visited[q]=1;queue[end++]=q;}
    }
    components.push({pixels:n,box:rect(l*stride,t*stride,Math.min(width-1,(r+1)*stride-1),Math.min(height-1,(b+1)*stride-1))});
  }
  components.sort((a,b)=>b.pixels-a.pixels);
  return {has_mask:true,status:'ready',coverage_ratio:Number((count/(width*height)).toFixed(3)),bbox:norm(pixel_bbox),pixel_bbox,region_count:components.length,
    regions:components.slice(0,3).map(c=>({bbox:norm(c.box),pixel_bbox:c.box,coverage_ratio:Number((c.pixels/(width*height)).toFixed(3))})),regions_truncated:components.length>3};
}
