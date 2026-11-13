import test from 'node:test';
import assert from 'node:assert/strict';
import { exportCallLog } from '../src/ask/debug-export.ts';
import { createCallLog } from '../src/ask/debug.ts';
import { wireBody } from '../src/ask/provider.ts';
import { openaiChatProfile, anthropicMessagesProfile, geminiChatProfile } from '../src/gateway/profile.ts';

const info = { conversation:'test',turn:1,step:1,question:'检查图片',connection:'test',protocol:'openai-chat',model:'test',promptVersion:'test' };
function expand(exported, call) {
  const block = value => value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.$ref === 'string' && value.$ref.startsWith('#/blocks/')
    ? exported.blocks[value.$ref.slice('#/blocks/'.length)] : value;
  return Object.fromEntries(Object.entries(call.body).map(([key,value]) => [key,
    ['messages','contents','system'].includes(key) && Array.isArray(value) ? value.map(block)
      : ['tools','system','systemInstruction'].includes(key) ? block(value) : value,
  ]));
}
const imageData = Buffer.from('synthetic pixel bytes'.repeat(400)).toString('base64');
function restoreFixtureImage(value) {
  if (Array.isArray(value)) return value.map(restoreFixtureImage);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key,child]) => [key,
    typeof child === 'string' && child.startsWith('[image1: Base64 已省略')
      ? (key === 'url' ? `data:image/png;base64,${imageData}` : imageData) : restoreFixtureImage(child),
  ]));
}

test('compact exports preserve all three wire protocols, exact text, cache markers, diagnostics and message order', () => {
  for (const profile of [openaiChatProfile,anthropicMessagesProfile,geminiChatProfile]) {
    const log=createCallLog(()=>{});
    const request={model:'test',maxTokens:128,system:['完整系统词文\n'.repeat(80),'偏好'],tools:[{name:'get_state',description:'工具说明'.repeat(100),schema:{type:'object',properties:{source:{$ref:'#/blocks/user-defined-schema'}}}}],
      messages:[{role:'user',content:[{type:'text',text:'<workspace_state>{"prompt":"全文保留"}</workspace_state>\n问题\n'.repeat(40)},{type:'image',mime:'image/png',data:imageData}]}]};
    const body=JSON.stringify(wireBody(profile,request),null,1), id=log.start({...info,protocol:profile.protocol},body);
    log.finish(id,{usage:{input:200,output:20},cache:{read:120,write:null},stop:'end',response:{httpStatus:200,finishReason:'STOP'}});
    log.start({...info,protocol:profile.protocol,step:2,purpose:'compaction',afterCompaction:true},JSON.stringify(wireBody(profile,{...request,messages:[...request.messages,{role:'assistant',content:[{type:'text',text:'工具结果与上一轮回答原文'}]},{role:'user',content:[{type:'text',text:'下一问'}]}]})));
    const exportedText=log.export(), exported=JSON.parse(exportedText);
    assert.equal(exported.version,2);assert.equal(exported.format,'compact');assert.ok(Object.keys(exported.blocks).length);
    assert.equal(exportedText.includes(imageData),false);assert.equal(exported.images.image1.occurrences,2);
    assert.equal(exported.images.image1.bytes,Buffer.from(imageData,'base64').length);
    for(const call of exported.calls) {
      const {body:raw,...summary}=log.get(call.id),{body:_compact,...exportedSummary}=call;
      assert.deepEqual(exportedSummary,summary);
      assert.deepEqual(restoreFixtureImage(expand(exported,call)),JSON.parse(raw));
    }
    assert.equal(log.get(id).body,body,'export does not mutate the captured request');
    const raw=JSON.parse(log.export(undefined,'raw'));assert.equal(raw.version,1);assert.equal(raw.calls[0].body,body);
    const single=JSON.parse(log.export(id));assert.equal(single.calls.length,1);assert.deepEqual(restoreFixtureImage(expand(single,single.calls[0])),JSON.parse(body));
  }
});

test('compact exports merge repeated context without truncating unique changes or interpreting text as image data', () => {
  const log=createCallLog(()=>{}, {calls:30,bytes:64*1024*1024});
  const shared={role:'user',content:'相同的历史与配方\n'.repeat(2000)}, literal='data:image/png;base64,this is user text';
  const bodies=[];
  for(let i=0;i<20;i++) {
    const body=JSON.stringify({model:'test',messages:[shared,{role:'user',content:`不同的末尾 ${i}\n${literal}`}]});
    bodies.push(body);log.start({...info,step:i+1},body);
  }
  const compact=log.export(),raw=log.export(undefined,'raw'), exported=JSON.parse(compact);
  assert.ok(Buffer.byteLength(compact)<Buffer.byteLength(raw)/10,'repeated context is stored once');
  assert.deepEqual(exported.images,{});
  exported.calls.forEach((call,i)=>assert.deepEqual(expand(exported,call),JSON.parse(bodies[i])));
  assert.deepEqual(JSON.parse(exportCallLog([],7)).calls,[]);assert.equal(JSON.parse(exportCallLog([],7)).dropped,7);
});
