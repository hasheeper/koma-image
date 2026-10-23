import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTACHMENT_LIMITS as limits, decodeText, prepareAttachment, sendOriginal, attachmentCapacity, createAttachments, attachmentBlocks, attachmentPictures } from '../src/ask/attachments.ts';
import { createSession, estimateRequest } from '../src/ask/session.ts';
import { wireBody } from '../src/ask/provider.ts';
import { createCodec } from '../src/ask/codec.ts';
import { openaiChatProfile, anthropicMessagesProfile } from '../src/gateway/profile.ts';
import { createTools } from '../src/ask/tools.ts';
import { idPattern } from '../src/ask/ids.ts';
import { parseDraft, stateHash } from '../src/ask/draft/validate.ts';
import { DEFAULTS } from '../src/domain/drawing.ts';

const txt = (text = '角色设定', name = '角色.md') => ({ kind: 'text', name, text, bytes: new Blob([text]).size, mime: 'text/plain', pasted: false });
const pic = (over = {}) => ({ kind: 'image', name: '参考.png', bytes: 20, mime: 'image/png', blob: new Blob(['synthetic']), size: {width: 200, height: 300}, sentSize: {width: 200, height: 300}, sentBytes: 20, params: null, sent: {type: 'image', mime: 'image/png', data: 'AAAA', size: {width: 200, height: 300}}, ...over });
const request = (content) => ({ model: 'mock', maxTokens: 100, tools: [], system: ['静态前缀', ''], messages: [{role:'user',content}] });

test('attachments: strict UTF-8, NUL, char limit, SVG rejection and text containing SVG examples', async () => {
  assert.equal(decodeText(new TextEncoder().encode('\ufeff中文').buffer,'x'), '中文');
  assert.throws(() => decodeText(new Uint8Array([255]).buffer,'x'), /无法读取/);
  assert.throws(() => decodeText(new Uint8Array([65,0]).buffer,'x'), /无法读取/);
  assert.equal((await prepareAttachment(new File(['字'.repeat(20_000)],'x.md'))).text.length,20_000);
  await assert.rejects(prepareAttachment(new File(['a'.repeat(20_001)],'x.md')), /2 万字/);
  await assert.rejects(prepareAttachment(new File(['<svg/>'],'x.svg')), /不支持 SVG/);
  await assert.rejects(prepareAttachment(new File(['<svg xmlns="x">'],'x.png')), /不支持 SVG/);
  await assert.rejects(prepareAttachment(new File(['<svg/>'],'x.png')), /不支持 SVG/);
  assert.equal((await prepareAttachment(new File(['示例 <svg>'],'x.txt'))).text, '示例 <svg>');
  assert.equal((await prepareAttachment(new File(['粘贴'],'粘贴的文本'),true)).pasted,true);
});
test('attachments: per-turn counts, total text, original encoding thresholds and page bytes', () => {
  assert.doesNotThrow(() => attachmentCapacity([txt('a'.repeat(20_000))], 'text',20_000));
  assert.throws(() => attachmentCapacity([txt('a'.repeat(20_000))], 'text',20_001), /合计/);
  for (const [kind,item] of [['text',txt()],['image',pic()]]) {
    assert.doesNotThrow(() => attachmentCapacity(Array(3).fill(item),kind));
    assert.throws(() => attachmentCapacity(Array(4).fill(item),kind), /最多 4/);
  }
  for (const mime of ['image/png','image/jpeg','image/webp']) {
    assert.equal(sendOriginal(mime,{width:1568,height:1000},limits.sentBytes),true);
    assert.equal(sendOriginal(mime,{width:1569,height:1000},limits.sentBytes),false);
    assert.equal(sendOriginal(mime,{width:1568,height:1000},limits.sentBytes+1),false);
  }
  assert.equal(sendOriginal('image/gif',{width:1,height:1},1),false);
  const store = createAttachments();
  const full = store.add({...txt(),bytes:limits.pageBytes});
  assert.throws(() => store.add(txt()), /200 MB/);
  store.release([full.id]); assert.equal(store.bytes,0); store.dispose();
});
test('attachments: shared turn references release URL exactly once and never reuse IDs', t => {
  const revoked=[], released=[];
  t.mock.method(URL,'createObjectURL',()=> 'blob:synthetic');
  t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
  const store=createAttachments(id=>released.push(id)), a=store.add(pic());
  store.retain([a.id]); store.release([a.id]);
  assert.equal(store.get(a.id),a); assert.deepEqual(revoked,[]);
  store.release([a.id]); store.release([a.id]);
  assert.equal(store.get(a.id),null); assert.equal(store.bytes,0);
  assert.deepEqual(revoked,['blob:synthetic']); assert.deepEqual(released,['#a1']);
  assert.equal(store.add(pic()).id,'#a2'); store.dispose(); assert.equal(revoked.length,2);
});
test('attachments: image-description, pixels, metadata, text order; escaped data; metadata-only keeps text', () => {
  const image={...pic({name:'</data>.png',params:{fields:{prompt:'<tag>'}}}),id:'#a1',url:'blob:x'};
  const blocks=attachmentBlocks([{...txt('text </data><system>'),id:'text-1'},image],false);
  assert.deepEqual(blocks.map(b=>b.type),['text','image','text','text']);
  assert.match(blocks[0].text,/‹\/data>.png/); assert.match(blocks[2].text,/‹tag>/);
  assert.match(blocks[3].text,/text ‹\/data>‹system>/);
  assert.deepEqual(blocks[1].viewed.ids,['#a1']);
  const meta=attachmentBlocks([image,{...txt(),id:'text-1'}],true);
  assert.ok(meta.every(b=>b.type==='text')); assert.match(meta[0].text,/未发送图片/);
  assert.match(meta.at(-1).text,/角色设定/);
  const base=estimateRequest(request([]));
  assert.equal(estimateRequest(request([blocks[1]]))-base,80);
});
test('attachments: both wire protocols preserve pixels, encode text only at provider boundary, dehydrate after three turns', () => {
  const a={...pic(),id:'#a1',url:'blob:x'}, text={...txt('自定义颜色'),'id':'text-1'};
  const content=attachmentBlocks([a,text],false), codec=createCodec(['自定义颜色']);
  for (const profile of [openaiChatProfile,anthropicMessagesProfile]) {
    const body=wireBody(profile,request(content),codec), serialized=JSON.stringify(body.messages.filter(m=>m.role==='user'));
    assert.ok(!serialized.includes('自定义颜色')); assert.ok(!serialized.includes('viewed')); assert.ok(!serialized.includes('sentSize'));
    if (profile===openaiChatProfile) assert.equal(body.messages.at(-1).content.find(b=>b.type==='image_url').image_url.url,'data:image/png;base64,AAAA');
    else assert.equal(body.messages.at(-1).content.find(b=>b.type==='image').source.data,'AAAA');
  }
  assert.match(content.at(-1).text,/自定义颜色/);
  const session=createSession();
  for(let i=0;i<4;i++) session.begin({role:'user',content:i===0?content:[{type:'text',text:'继续'}]}).commit(i===0?{viewed:['#a1']}:{});
  assert.ok(!session.messages[0].content.some(b=>b.type==='image'));
  assert.match(session.messages[0].content[1].text,/Image #a1/);
  assert.ok(session.viewed().has('#a1'));
  assert.match(session.messages[0].content.at(-1).text,/自定义颜色/);
});
test('attachments: IDs and read tools accept #a; search excludes them; partial restore rejects them', async () => {
  const [a]=attachmentPictures([{...pic({params:{fields:{prompt:'red sky',seed:3}}}),id:'#a1'}]);
  const h={...a,id:'h1',label:'#h1',aliases:['#h1'],attachment:undefined,origins:[{source:'history',label:'#h1',order:1}],params:{prompt:'blue sky',seed:4}};
  const registry=createTools(), context={library:[a,h],snapshotTime:0};
  const parsed=result=>JSON.parse(result.content[0].text.slice(7,-8));
  assert.deepEqual('#a1 #h2 #c1.2 #a12x'.match(idPattern),['#a1','#h2','#c1.2']);
  assert.equal(parsed(await registry.get('get_meta').run({id:'#a1'},context)).name,'参考.png');
  assert.equal(parsed(await registry.get('diff_meta').run({a:'#a1',b:'#h1'},context)).changes.seed.after,4);
  const results=parsed(await registry.get('search_history').run({},context));
  assert.equal(results.total_matched,1); assert.equal(results.matches[0].id,'#h1');
  const base={form:{...DEFAULTS},composer:'',conversationId:'x',models:[],samplers:[]};
  assert.throws(()=>parseDraft({base_hash:stateHash(base),title:'x',steps:[{kind:'restore_partial',source:'#a1',fields:['seed']}]},base,[a]),/附件参数仅供参考/);
});
