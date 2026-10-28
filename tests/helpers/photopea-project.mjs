// Metadata-only synthetic transport fixture; real PSD pixels are tested through Photopea.
export function photopeaProject({masked=[],vector=[],effects=[]}={}) {
 const u32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255],text=s=>[...s].map(c=>c.charCodeAt(0));
 const tag=(k,b)=>[...text('8BIM'+k),...u32(b.length),...b,...(b.length%2?[0]:[])];
 const records=[4,1,2,3].flatMap(id=>{
  const mask=masked.includes(id)?Array(20).fill(0):[];
  const extra=[...u32(mask.length),...mask,...u32(0),0,0,0,0,...tag('lyid',u32(id)),...(vector.includes(id)?tag('vmsk',Array(8).fill(0)):[]),...(effects.includes(id)?tag('lfx2',Array(8).fill(0)):[])];
  return [...Array(18).fill(0),...text('8BIMnorm'),255,0,0,0,...u32(extra.length),...extra];
 });
 const info=[0,4,...records],section=[...u32(info.length),...info];
 return Uint8Array.from([...text('8BPS'),0,1,...Array(6).fill(0),0,3,...u32(1),...u32(1),0,8,0,3,...u32(0),...u32(0),...u32(section.length),...section]).buffer;
}
