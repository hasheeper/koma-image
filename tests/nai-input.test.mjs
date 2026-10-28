import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readImageParams } from '../src/native/image-meta.ts';
import { gzipSync } from 'node:zlib';
import { createNaiTokenizer } from '../src/native/nai-tokenizer-engine.ts';
import { naiMediumNegative } from '../src/domain/nai.ts';
import { naiInputLimits, naiInputParts, naiTextLength, validateNaiText } from '../src/domain/nai-input.ts';
import { naiCost } from '../src/domain/nai-cost.ts';
import { quoteLabel, costNotice } from '../src/domain/quote.ts';
import { stealthPayload, inflateMetadata } from '../src/native/png-stealth.ts';
const full='nai-diffusion-4-5-full', v5='nai-diffusion-5-full';
const payload={model:full,width:832,height:1216,steps:23};
const opus={active:true,tier:3,usage:{isNegative:false}};

test('NAI estimates mirror public client Anlas formula and Opus eligibility',()=>{
  assert.equal(naiCost(payload,{active:true,tier:2}).cost,17);
  assert.equal(naiCost(payload,opus).cost,0);
  assert.equal(naiCost({...payload,steps:29},opus).cost,20);
  assert.equal(naiCost({...payload,width:1024,height:1088},opus).cost,19);
  assert.equal(naiCost({...payload,model:v5},{active:true,tier:2}).cost,26);
  assert.equal(naiCost({...payload,model:v5,tool:'img2img',strength:.4},{active:true,tier:2}).cost,11);
  assert.equal(naiCost({...payload,model:'nai-diffusion-5-full-medium',steps:40},{active:true,tier:2}).cost,17);
  assert.equal(naiCost(payload,{...opus,expiresAt:1}).cost,17);
  assert.equal(naiCost({...payload,model:v5},{active:true,tier:3}),null);
  assert.equal(naiCost({...payload,model:v5}, {...opus,usage:{isNegative:true}}).cost,26);
  assert.ok(naiCost({...payload,model:v5},opus).usagePercent>0);
  assert.equal(quoteLabel(naiCost({...payload,model:v5},opus)),'');
  assert.equal(quoteLabel(naiCost(payload,opus)),'');
  assert.equal(costNotice(naiCost(payload,{active:false}),0),'');
});
test('reference surcharge repeats per sample while paid encoding is once per unique reference',()=>{
  const items=Array.from({length:6},(_,i)=>({id:String(i),assetId:'a'.repeat(64),information:.7}));
  const q=naiCost({...payload,referencePlan:{kind:'vibe',items},referenceMinimum:6},opus);
  assert.equal(q.cost,6);assert.equal(q.encodingCost,2);
  assert.equal(quoteLabel(q,3),'≈14 Anlas');
  assert.equal(naiCost({...payload,preparedReferences:{kind:'vibe',images:['a','b','c','d','e']}},opus).cost,2);
  assert.equal(naiCost({...payload,referencePlan:{kind:'precise',items:items.slice(0,1)},referenceMinimum:5},opus).cost,22);
  assert.equal(naiCost({...payload,referencePlan:{kind:'vibe',items}},opus),null);
  for (const [width,height,cost] of [[512,512,1],[1024,1280,2],[1536,1536,3],[1536,2048,4]]) assert.equal(naiCost({...payload,tool:'upscale',width,height},opus).cost,cost);
});
test('input budgets separate active positive/negative roles, Text includes Unicode and whitespace',()=>{
  assert.deepEqual(naiInputLimits(full),{encoder:'t5',tokens:512,text:118});
  assert.deepEqual(naiInputLimits(v5),{encoder:'qwen35',tokens:1471,text:750});
  assert.equal(naiInputLimits('nai-diffusion-5-curated').tokens,703);
  assert.equal(naiTextLength('cat, Text: 猫🐈\n '),4);
  assert.doesNotThrow(()=>validateNaiText({model:full,prompt:'Text: '+ '猫'.repeat(118)}));
  assert.throws(()=>validateNaiText({model:full,prompt:'Text: '+ '猫'.repeat(119)}),/119.*118/);
  const characters=[{id:'c1',on:true,prompt:'Text: abc',negative:'bad',centers:[{x:.5,y:.5}]},{id:'c2',on:false,prompt:'ignored',negative:'x'}];
  assert.deepEqual(naiInputParts({model:full,prompt:'base',negative_prompt:'negative',characters}).prompt,['base','Text: abc']);
  assert.deepEqual(naiInputParts({model:'nai-diffusion-5-full-medium',prompt:'base',characters}).negative,[naiMediumNegative('base'),'']);
});
test('licensed T5/Qwen counters retain model-specific normalization and EOS',()=>{
  const t5=createNaiTokenizer(JSON.parse(readFileSync('public/tokenizers/t5.json')), 't5');
  const qwen=createNaiTokenizer(JSON.parse(readFileSync('public/tokenizers/qwen35.json')), 'qwen35');
  assert.equal(t5(''),1);assert.equal(qwen(''),0);
  assert.equal(t5('1girl, blue hair'),6);
  assert.equal(t5('1.2::blue hair::'),t5('blue hair'));
  assert.equal(t5('blue  hair'),t5('blue hair'));
  assert.equal(t5(' blue hair'),t5('blue hair')+1);
  assert.equal(t5('猫'),3);
  assert.equal(t5('🐈'),4);
  assert.equal(qwen('你好，世界'),3);
  assert.equal(qwen('e\u0301'),qwen('é'));
  assert.ok(t5(naiInputParts({model:full,prompt:'cat',enhance:true,enhanceScale:1}).prompt[0])>t5('cat'));
  assert.equal(naiInputParts({model:full,prompt:'cat',enhance:true,enhanceScale:'max'}).prompt[0],'cat');
  assert.ok(qwen('1.2::blue hair::')>qwen('blue hair'));
});
test('alpha metadata uses column-first LSB with bounded gzip and rejects bad length',async()=>{
  const compressed=gzipSync(Buffer.from(JSON.stringify({Comment:'{"prompt":"test"}'})));
  const header=Buffer.alloc(4);header.writeUInt32BE(compressed.length*8);
  const dataBytes=Buffer.concat([Buffer.from('stealth_pngcomp'),header,compressed]);
  const width=40,height=50,data=new Uint8ClampedArray(width*height*4).fill(255);
  dataBytes.forEach((byte,b)=>{for(let bit=0;bit<8;bit++){const cursor=b*8+bit;data[4*(cursor%height*width+Math.floor(cursor/height))+3]=254|((byte>>(7-bit))&1);}});
  const bytes=stealthPayload({data,width,height});
  assert.deepEqual(Buffer.from(bytes),compressed);
  assert.match(new TextDecoder().decode(await inflateMetadata(bytes,'gzip')),/prompt/);
  assert.equal(stealthPayload({data,width:1,height:1}),null);
  data[3]^=1;assert.equal(stealthPayload({data,width,height}),null);
});

const pngMetadata = data => {
  const body=Buffer.from('Comment\0'+JSON.stringify(data)),type=Buffer.from('tEXt');
  const chunk=Buffer.alloc(body.length+12);chunk.writeUInt32BE(body.length);type.copy(chunk,4);body.copy(chunk,8);
  return new Blob([Buffer.from('89504e470d0a1a0a','hex'),chunk,Buffer.from('0000000049454e4400000000','hex')]);
};
test('PNG encoded Vibes retain ordinary parameters when corrupt, absent or model-incompatible',async()=>{
  const data={model:full,prompt:'keep this',reference_image_multiple:['AAH+/w=='],reference_strength_multiple:[.4]};
  const good=await readImageParams(pngMetadata(data));
  assert.deepEqual(good.vibes,{model:full,normalize:false,items:[{encoding:'AAH+/w==',information:.7,strength:.4}]});
  assert.equal(good.fields.naiReferences,undefined);
  for (const patch of [{reference_image_multiple:['bad!']},{reference_strength_multiple:[]},{reference_information_extracted_multiple:[NaN]},{model:v5},{reference_image_multiple:Array(17).fill('YQ==')}]) {
    const bad=await readImageParams(pngMetadata({...data,...patch}));
    assert.equal(bad.fields.prompt,'keep this');assert.ok(bad.vibeError);assert.equal(bad.vibes,undefined);
  }
  assert.equal((await readImageParams(pngMetadata({model:full,prompt:'keep this',reference_strength_multiple:[.6]}))).vibes,undefined);
});
