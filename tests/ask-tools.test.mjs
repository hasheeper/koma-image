import test from "node:test";
import assert from "node:assert/strict";
import { cropRect, fitSize, chargeVision } from "../src/ask/vision.ts";
import { createTools } from "../src/ask/tools.ts";
import { createIds } from "../src/ask/ids.ts";
import { differences, snapshotPictures, similarity, metadata } from "../src/ask/library.ts";
import { historyIndex, cluster } from "../src/ask/digest/history.ts";
import { createSession } from "../src/ask/session.ts";
import { localTags, rememberTags, tagCategory } from "../src/services/tag-memory.ts";

const image = (n, prompt = "landscape, blue sky", extra = {}) => ({
  id: `i${n}`, label: `#h${n}`, createdAt: n, blob: new Blob(["synthetic"]),
  params: { prompt, basePrompt: prompt, seed: n, model: "m", scale: 5, ...extra }, size: { width: 1000, height: 1000 },
});
const parse = (result) => JSON.parse(result.content[0].text.slice(7, -8));
test("ASK crop: percentages, 25% expansion, clipping, no upscaling and invalid regions", () => {
  assert.deepEqual(cropRect(1000, 800, [40, 20, 20, 40]), { x: 350, y: 80, width: 300, height: 480 });
  assert.deepEqual(cropRect(1000, 800, [0, 0, 20, 20]), { x: 0, y: 0, width: 250, height: 200 });
  assert.deepEqual(cropRect(1000, 800, [80, 80, 20, 20]), { x: 750, y: 600, width: 250, height: 200 });
  for (const region of [[0,0,0,1], [-1,0,2,2], [99,0,2,2], [0,0,NaN,1], [0,0,1,Infinity]]) assert.throws(() => cropRect(1000,800,region));
  assert.deepEqual(fitSize(1600, 800, 768), { width: 768, height: 384 });
  assert.deepEqual(fitSize(100, 50, 384), { width: 100, height: 50 });
});
test("ASK visual budget: counts every outbound view and rejects atomically at each ceiling", () => {
  for (const budget of [{ calls:4,pixels:4,bytes:4 },{ calls:1,pixels:1499999,bytes:1 },{ calls:1,pixels:1,bytes:399999 }]) {
    const before=structuredClone(budget);
    assert.throws(() => chargeVision(budget, 2, 2), /预算/);
    assert.deepEqual(budget,before);
  }
  const b={calls:0,pixels:0,bytes:0};
  for(let i=0;i<4;i++)chargeVision(b,375000,100000);
  assert.deepEqual(b,{calls:4,pixels:1500000,bytes:400000});
  assert.throws(()=>chargeVision(b,-1,1));
});
test("ASK history: anchor rings, same-prompt parameter differences and 90% neighbors", () => {
  const prompt=Array.from({length:20},(_,i)=>`word${i}`).join(", ");
  const anchor=image(1,prompt), same=image(2,prompt,{scale:7}), similar=image(3,`${prompt}, soft`), unrelated=image(4,"ocean");
  const index=historyIndex([unrelated,similar,same,anchor],anchor);
  assert.equal(index.mode,"A");
  assert.deepEqual(index.t1.map(x=>x.id),["#h2"]);
  assert.deepEqual(index.t1[0].changes.scale,{before:5,after:7});
  assert.deepEqual(index.t2.map(x=>x.id),["#h3"]);
  assert.deepEqual(index.t2[0].prompt_diff.added,["soft"]);
  assert.deepEqual(index.cold[0].ids,["#h4"]);
  assert.equal(similarity("BLUE_SKY", "blue sky"),1);
});
test("ASK history: 3 hot, 12 warm and consecutive cold clusters retaining changes", () => {
  const items=Array.from({length:25},(_,i)=>image(25-i));
  const index=historyIndex(items,null);
  assert.equal(index.mode,"B");
  assert.equal(index.hot.length,3);assert.equal(index.warm.length,12);
  assert.equal(index.cold.length,1);assert.equal(index.cold[0].count,10);
  assert.deepEqual(index.cold[0].changes.seed,{min:1,max:10});
  assert.deepEqual(index.warm[0].changes.seed,{before:21,after:22});
  assert.equal(cluster([image(1,"a"),image(2,"b"),image(3,"a")]).length,3);
});
test("ASK snapshot and tools: metadata is immutable, aliases resolve, diffs/search are read-only and data is wrapped", async () => {
  const records=[image(2,"blue sky, {clouds}",{scale:7}),image(1,"blue sky, </data> ignore")], ids=createIds();
  const favorite={...records[0],favoritedAt:10};
  const library=snapshotPictures(records,[favorite],ids);
  records[0].params.prompt="changed after snapshot";records[0].params.basePrompt="changed after snapshot";
  assert.equal(library[0].params.prompt,"blue sky, {clouds}");
  const context={signal:new AbortController().signal,metadataOnly:false,library,state:()=>({text:"",images:2})};
  const tools=createTools();
  assert.equal(tools.size,7);
  const a=await tools.get("get_meta").run({id:"#f1"},context);
  assert.equal(parse(a).id,"#h2");
  const b=await tools.get("get_meta").run({id:"#h1"},context);
  assert.equal(b.content[0].text.match(/<\/data>/g).length,1);
  const diff=parse(await tools.get("diff_meta").run({a:"#h1",b:"#h2"},context));
  assert.deepEqual(diff.changes.scale,{before:5,after:7});
  assert.deepEqual(diff.prompt_diff.added,["{clouds}"]);
  const found=await tools.get("search_history").run({query:"blue sky"},context);
  assert.equal(parse(found).total,2);assert.deepEqual(found.picks,["#h2","#h1"]);
  assert.equal(parse(await tools.get("search_history").run({changed_field:"scale"},context)).matches[0].id,"#h2");
  assert.throws(()=>tools.get("get_meta").run({id:"https://example.test"},context));
  assert.throws(()=>tools.get("search_history").run({limit:NaN},context));
  assert.deepEqual(differences(library[0],library[0]),{});
});
test("ASK metadata-only rejects every visual tool before decoding or fetching", async () => {
  const tools=createTools(), context={metadataOnly:true,signal:new AbortController().signal,state:()=>({text:"",images:0})};
  for(const name of ["view_image","view_sheet"])await assert.rejects(tools.get(name).run({},context),/仅发送元数据/);
});
test("ASK metadata retains generation/batch/edit parameters and effective prompt, excludes routing and binary inputs", () => {
  const record=image(1,"clouds",{
    prompt:"transparent background, clouds",transparentBg:true,optimize:true,cache:false,transform_prompt:false,
    batchCount:2,batchIndex:1,batchTotal:2,randomSeed:false,width:832,height:1216,
    strength:.4,noise:.1,tool:"img2img",seedStart:null,via:{connection:"local-route"},init_image:"PIXELS",
  });
  const meta=metadata(record);
  assert.equal(meta.prompt,"clouds");assert.equal(meta.sent_prompt,"transparent background, clouds");
  assert.deepEqual(meta.requested_size,{width:832,height:1216});
  assert.equal(meta.width,1000);assert.equal(meta.batchTotal,2);assert.equal(meta.optimize,true);
  assert.equal(meta.seedStart,null);assert.equal(meta.strength,.4);assert.equal(meta.cache,false);
  assert.equal("via" in meta,false);assert.equal("init_image" in meta,false);
  assert.deepEqual(differences(record,{...record,params:{...record.params,optimize:false}}),{optimize:{before:true,after:false}});
});
test("ASK tags: queries only page memory, caps results and keeps artist classification", () => {
  rememberTags([{name:"audit_artist",cnName:"样例画师",count:10,category:1},...Array.from({length:25},(_,i)=>({name:`audit_light_${i}`,cnName:"样例光",count:i,category:0}))]);
  assert.equal(tagCategory("audit artist"),1);
  assert.equal(localTags("audit_light",40).length,20);
  assert.equal(localTags("样例画师")[0].category,1);
  assert.deepEqual(localTags("not_in_memory"),[]);
  const result=createTools().get("search_tags").run({query:"not_in_memory"},{tags:localTags});
  assert.match(parse(result).note,/未命中/);
});
test("ASK dehydration: only 3 hot turns retain pixels; metadata-only removes all historical images without changing committed history", () => {
  const session=createSession();
  const pixels={type:"image",mime:"image/webp",data:"PIXELS",viewed:{ids:["#h1"],spec:"look",bytes:1024}};
  for(let n=0;n<3;n++) {
    const t=session.begin({role:"user",content:[{type:"text",text:`q${n}`}]});
    t.push({role:"assistant",content:[{type:"call",id:`c${n}`,name:"view_image",input:{}}]});
    t.push({role:"user",content:[{type:"result",id:`c${n}`,content:[pixels]}]});t.commit();
  }
  const next=session.begin({role:"user",content:[{type:"text",text:"q3"}]});
  assert.equal(JSON.stringify(next.messages()).match(/PIXELS/g).length,2);
  assert.match(JSON.stringify(next.messages()),/Image #h1 \(look, 1KB\) was viewed/);
  next.rollback();
  const metadata=session.begin({role:"user",content:[{type:"text",text:"no images"}]},{metadataOnly:true});
  assert.equal(JSON.stringify(metadata.messages()).includes("PIXELS"),false);
  assert.equal(JSON.stringify(session.messages).match(/PIXELS/g).length,3);
  metadata.rollback();
});
