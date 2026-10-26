import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blocks, inline, summary } from '../src/ask/format.ts';

const sample = readFileSync(new URL('./fixtures/ask-markdown.md', import.meta.url), 'utf8');
test('ASK Markdown: numbered headings stay headings and nested list structure is preserved', () => {
  const parsed = blocks(sample);
  assert.deepEqual(parsed.filter(b => b.t === 'heading').map(b => [b.depth, b.parts[0].v]), [[3, '1. 表现到位的地方'], [3, '2. 画面目前存在的问题'], [3, '3. 提示词层面的潜在诱因']]);
  const lists = parsed.filter(b => b.t === 'ul');
  const nested = lists[1].items[1].blocks[1];
  assert.equal(nested.t, 'ul');
  assert.equal(nested.items[1].blocks[1].t, 'ol');
  assert.equal(nested.items[1].blocks[1].items.length, 2);
  assert.equal(parsed.find(b => b.t === 'ol').start, 4);
  assert.equal(blocks('0. zero\n1. one')[0].start, 0);
  assert.equal(blocks('标题\n====')[0].depth, 1);
});
test('ASK Markdown: nested emphasis, escapes, entities, line breaks and ID references', () => {
  assert.deepEqual(inline('**保留 *#h1***'), [{t:'strong', parts:[{t:'text',v:'保留 '},{t:'em',parts:[{t:'id',v:'#h1'}]}]}]);
  assert.deepEqual(inline('`#h1` `#a2` `#h1 literal`'), [{t:'id',v:'#h1'},{t:'text',v:' '},{t:'id',v:'#a2'},{t:'text',v:' '},{t:'code',v:'#h1 literal'}]);
  assert.equal(inline('&amp; &lt; &copy; &#x4e2d;')[0].v, '& < © 中');
  assert.equal(inline('`&lt;`')[0].v, '&lt;');
  assert.deepEqual(inline('a\nb').map(p=>p.t), ['text','br','text']);
  assert.equal(inline('\\*literal\\*').map(p=>p.v).join(''), '*literal*');
  assert.equal(inline('~~deleted~~')[0].t, 'del');
});
test('ASK Markdown: quoted strong works beside Chinese text and accepts horizontal padding', () => {
  for (const quote of [['“','”'],['"','"'],['「','」'],['『','』']]) {
    for (const padding of ['', ' ', '\t']) {
      const text=`当前正处于**${padding}${quote[0]}画风框架已就绪，但角色设定尚未交接${quote[1]}${padding}**的状态：`;
      const expected=[{t:'text',v:'当前正处于'},{t:'strong',parts:[{t:'text',v:`${padding}${quote[0]}画风框架已就绪，但角色设定尚未交接${quote[1]}${padding}`}]},{t:'text',v:'的状态：'}];
      assert.deepEqual(inline(text),expected,text);
      assert.deepEqual(blocks(text),[{t:'p',parts:expected}]);
      assert.equal(summary(text).map(p=>p.v).join(''),text.replaceAll('**',''));
    }
  }
  const nested=inline('前**“保留 *#h1* 与 [参考][ref]”**后');
  assert.equal(nested[1].t,'strong');
  assert.deepEqual(nested[1].parts[1],{t:'em',parts:[{t:'id',v:'#h1'}]});
  const reference=blocks('前**“[参考][ref]”**后\n\n[ref]: https://example.test');
  assert.equal(reference[0].parts[1].parts[1].t,'a','reference definitions remain in the same lexer');
});
test('ASK Markdown: quote compatibility preserves code, escapes, links and incomplete streams', () => {
  assert.deepEqual(inline('`** “原样” **`'),[{t:'code',v:'** “原样” **'}]);
  assert.deepEqual(blocks('```text\n** “原样” **\n```'),[{t:'pre',text:'** “原样” **',language:'text'}]);
  assert.equal(inline('\\*\\*“原样”\\*\\*').map(p=>p.v).join(''),'**“原样”**');
  const quoted=inline('前**“代码 `”**` 之后才结束”**后');
  assert.equal(quoted[1].t,'strong');
  assert.deepEqual(quoted[1].parts[1],{t:'code',v:'”**'});
  const link=inline('[参考](https://example.test/** "** “原样” **")')[0];
  assert.equal(link.href,'https://example.test/**');assert.equal(link.title,'** “原样” **');
  for(const value of ['前**“未结束”','前** “未结束” *','前**“未结束”\\**'])
    assert.equal(inline(value).some(p=>p.t==='strong'),false,value);
  // Unpadded delimiters follow the CJK-adjacent rule even when the quotes differ.
  assert.equal(inline('前**“引号不配对"**')[1].t,'strong');
  const full='前** “带 *斜体* 与 `code` 的引用” **后';
  for(let i=0;i<=full.length;i++)assert.doesNotThrow(()=>blocks(full.slice(0,i)));
});
test('ASK Markdown: strong beside CJK text opens and closes at full-width punctuation', () => {
  const shape=parts=>parts.map(p=>p.parts?`<${p.t}>${shape(p.parts)}</${p.t}>`:p.v??'').join('');
  for(const [text,expected] of [
    ['**青蓝/荧光晶石（luminescent crystals）**点缀在岩壁上','<strong>青蓝/荧光晶石（luminescent crystals）</strong>点缀在岩壁上'],
    ['使用**（注意）**为准','使用<strong>（注意）</strong>为准'],
    ['**晶石（crystals）**与**苔藓（moss）**交错','<strong>晶石（crystals）</strong>与<strong>苔藓（moss）</strong>交错'],
    ['**晶石（crystals）**与**苔藓**交错','<strong>晶石（crystals）</strong>与<strong>苔藓</strong>交错'],
    ['光は**「青」**です','光は<strong>「青」</strong>です'],
    ['색은**（파랑）**이다','색은<strong>（파랑）</strong>이다'],
    ['用*（备注）*说明','用<em>（备注）</em>说明'],
  ]){
    assert.equal(shape(inline(text)),expected,text);
    assert.equal(summary(text).map(p=>p.v).join(''),text.replace(/\*/g,''));
  }
  // Latin text keeps CommonMark: punctuation inside needs a space or punctuation outside.
  assert.equal(shape(inline('word**(note)**word')),'word**(note)**word');
  assert.equal(shape(inline('`**（原样）**`中')),'**（原样）**中');
  assert.equal(shape(inline('\\**（原样）**中')),'**（原样）**中');
});
test('ASK Markdown: code is literal, GFM tables/tasks and quote blocks survive', () => {
  const parsed = blocks(sample), code = parsed.find(b=>b.t==='pre'), table = parsed.find(b=>b.t==='table');
  assert.equal(code.language, 'text');
  assert.match(code.text, /### 这里是原始提示词/);
  assert.match(code.text, /- #h1 不应变成按钮/);
  assert.deepEqual(table.align, ['left','right','center']);
  assert.equal(table.rows.length, 2);
  assert.equal(parsed.find(b=>b.t==='blockquote').blocks.length, 2);
  const tasks = parsed.find(b=>b.t==='ul' && b.items[0].task);
  assert.deepEqual(tasks.items.map(i=>i.blocks[0].parts[0]), [{t:'check',checked:true},{t:'check',checked:false}]);
});
test('ASK Markdown: HTML is text, links validate decoded schemes and images become explicit links', () => {
  for (const url of ['javascript:alert%281%29','java&#x73;cript:alert%281%29','data:text/html,unsafe','vbscript:unsafe'])
    assert.equal(inline(`[label](${url})`).some(p=>p.t==='a'), false);
  const link = inline('[**#h1**](https://example.test/?a=1&amp;b=2)')[0];
  assert.equal(link.href, 'https://example.test/?a=1&b=2');
  assert.deepEqual(link.parts, [{t:'strong',parts:[{t:'text',v:'#h1'}]}]);
  assert.equal(inline('![alt](https://example.test/img.png)')[0].t, 'a');
  assert.equal(inline('<img src=x onerror=alert(1)>')[0].t, 'text');
  assert.equal(blocks('<script>alert(1)</script>')[0].parts[0].v, '<script>alert(1)</script>');
  assert.equal(blocks('[label][ref]\n\n[ref]: https://example.test')[0].parts[0].t, 'a');
  assert.equal(blocks('[label][ref]')[0].parts[0].t, 'text', 'reference definitions stay within one message');
});
test('ASK Markdown: bare HTML breaks render in table cells without enabling HTML or changing code', () => {
  for(const tag of ['<br>','<br/>','<br />','<BR>','<Br />']){
    assert.deepEqual(inline(`标题${tag}副标题`),[{t:'text',v:'标题'},{t:'br'},{t:'text',v:'副标题'}]);
    const table=blocks(`| 剧目 |\n| --- |\n| **现实的静止**${tag}角落里的空壳人偶 |`)[0];
    assert.deepEqual(table.rows[0][0],[{t:'strong',parts:[{t:'text',v:'现实的静止'}]},{t:'br'},{t:'text',v:'角落里的空壳人偶'}]);
  }
  for(const html of ['<br onclick="alert(1)">','<br style="display:none">','<br data-test="x"/>','<img src=x onerror=alert(1)>','<script>alert(1)</script>'])
    assert.ok(inline(html).every(p=>p.t==='text'),html);
  assert.deepEqual(inline('`<br>`'),[{t:'code',v:'<br>'}]);
  assert.deepEqual(inline('&lt;br&gt;'),[{t:'text',v:'<br>'}]);
  assert.deepEqual(blocks('```html\n<br>\n```'),[{t:'pre',text:'<br>',language:'html'}]);
  assert.equal(summary('标题<br>副标题').map(p=>p.v).join(''),'标题 副标题');
});
test('ASK Markdown: incomplete streamed syntax is readable and all block types have a compact summary', () => {
  for (let length=0; length<=sample.length; length+=11) assert.doesNotThrow(()=>blocks(sample.slice(0,length)));
  assert.equal(summary('### 1. **结论**')[0].v, '1. ');
  for(const value of ['> 引用', '- 列表', '```text\ncode', '| A |\n| --- |\n| B |', '---\n\n正文'])
    assert.ok(summary(value).length, value);
  assert.deepEqual(blocks('```text\n**still code'), [{t:'pre',text:'**still code',language:'text'}]);
  assert.equal(blocks('**partial')[0].parts.map(p=>p.v).join(''), '**partial');
});
