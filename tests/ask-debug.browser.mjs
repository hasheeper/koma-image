import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { useAskFixture, submitAsk, open, openai, text, tool, end, anthropic, askSettings, generation, bind, addImage, drawer, openDebug } from "./helpers/ask-fixture.mjs";

useAskFixture();

test("ASK call debug: every model request, exact payload copy/export, images, cache unknowns", async () => {
  const {page, context, requests, errors, llm, calls} = await open('/#/image', {ready: '.switcher', ask: askSettings()});
  try {
    await bind(page);
    await addImage(page, 'adult woman, blue coat, synthetic scene');
    llm.push(
      {body: openai(tool('view_1', 'view_image', {id:'#h1', spec:'glance'}), end('tool_calls'))},
      {body: openai(text('已查看 #h1 的合成图片，保持人物，只修改背景。'), end())}
    );
    await page.evaluate(() => ask.show());
    await page.locator('#askPrompt').fill('检查 #h1 的场景');
    await submitAsk(page);
    await page.locator('.ask-turn[data-status="done"]').waitFor();
    const summaries = await page.evaluate(() => ask.debug.value.calls);
    assert.equal(summaries.length,2);
    assert.deepEqual(summaries.map(c => c.step),[1,2]);
    assert.equal(summaries[1].cache.read,1500);
    assert.equal(summaries[1].cache.write,null);
    for (let i=0;i<2;i++) assert.equal(await page.evaluate(id => ask.debugCall(id).body,summaries[i].id),calls[i].raw);
    await openDebug(page);
    const debug = page.locator('#askDebug');
    await debug.waitFor();
    assert.equal(await debug.evaluate(el => el.matches(':modal')),true);
    assert.equal(await page.locator('#askDebugCall').getAttribute('data-call'),String(summaries[1].id));
    assert.equal(await debug.locator('.debug-meters dd > span').nth(1).textContent(),'1,500');
    assert.equal(await debug.locator('.debug-meters dd > span').nth(2).textContent(),'300');
    assert.equal(await debug.locator('.debug-meters dd > span').nth(3).textContent(),'未报告');
    assert.match(await debug.locator('.debug-facts').textContent(),/自动前缀/);
    assert.equal(await debug.locator('.debug-thumb img').count(),1);
    await debug.locator('.debug-thumb img').evaluate(img => img.decode());
    assert.match(await debug.locator('#askDebugStructureTip').textContent(),/本地内容是否一致，不代表缓存命中/);
    assert.match(await debug.locator('.debug-legend').textContent(),new RegExp(`与 #${summaries[0].id} 比较`));
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    await debug.getByRole('button',{name:'复制请求 JSON',exact:true}).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), calls[1].raw);
    const downloaded = page.waitForEvent('download');
    await debug.getByRole('button',{name:'更多',exact:true}).click();
    await debug.getByRole('menuitem',{name:/^导出全部/}).click();
    const file = await downloaded;
    const exportedText = await readFile(await file.path(),'utf8'), exported = JSON.parse(exportedText);
    assert.equal(exported.calls.length,2);
    assert.equal(exported.calls[1].body,calls[1].raw);
    assert.equal(exportedText.includes('synthetic-chat'),false);
    assert.equal(exportedText.includes('Authorization'),false);

    {
      const [width,height] = [1440, 900];
      await page.setViewportSize({width,height});
    }
    await debug.locator('.debug-thumb').click();
    const shot = debug.locator('.debug-part[data-open]').filter({has: page.locator('.debug-imgs img')});
    await shot.waitFor();
    assert.match(await shot.locator('.debug-code').textContent(),/Base64 已在预览中折叠/);
    assert.equal(await shot.locator('.debug-role').first().textContent(),'工具');
    await page.keyboard.press('Escape');
    await debug.waitFor({state:'detached'});
    assert.equal(await page.locator('#askDrawer').isVisible(),true);
    llm.push({body:openai(text('这次不报告缓存。'),{choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:90,completion_tokens:10}})});
    await page.locator('#askPrompt').fill('再检查一次');
    await submitAsk(page);
    await page.waitForFunction(() => ask.debug.value.calls.length===3 && !ask.running.value);
    await openDebug(page);
    await debug.waitFor();
    assert.equal(await debug.locator('.debug-meters dd > span').nth(1).textContent(),'未报告');
    assert.equal(await debug.locator('.debug-meters dd > span').nth(2).textContent(),'未报告');
    await debug.getByRole('button',{name:'关闭调用上下文'}).click();
    llm.push({status:403,type:'application/json',body:JSON.stringify({error:{message:'Synthetic permission failure'}})});
    await page.locator('#askPrompt').fill('错误记录检查');
    await submitAsk(page);
    await page.locator('.ask-turn[data-status="failed"]').waitFor();
    await openDebug(page);
    await debug.waitFor();
    assert.match(await debug.textContent(),/本轮未计入后续会话/);
    assert.equal(await page.evaluate(() => ask.debug.value.calls.at(-1).status),'failed');
    await debug.getByRole('button',{name:'更多',exact:true}).click();
    await debug.getByRole('menuitem',{name:'清空记录',exact:true}).click();
    assert.equal(await debug.locator('.debug-empty').count(),1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.ask-turn').count(),3);
    assert.deepEqual(generation(requests),[]);
    assert.deepEqual(errors,[]);
    await page.reload();
    await page.waitForSelector('.switcher');
    await bind(page);
    assert.deepEqual(await page.evaluate(() => ask.debug.value.calls),[]);
  } finally {await context.close();}
});

test("ASK call debug: Anthropic cache markers, creation/read counts and unknown counters", async () => {
  const {page, context, requests, errors, llm, calls} = await open('/#/image', {ready: '.switcher', ask: askSettings({connectionId:'claude'})});
  try {
    await bind(page);
    llm.push({body:anthropic(
      {type:'message_start',message:{usage:{input_tokens:80,cache_read_input_tokens:1200,cache_creation_input_tokens:320}}},
      {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'合成诊断完成。'}},
      {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:20}},
      {type:'message_stop'}
    )});
    await page.evaluate(() => ask.show());
    await page.locator('#askPrompt').fill('当前工作台是什么状态？');
    await submitAsk(page);
    await page.locator('.ask-turn[data-status="done"]').waitFor();
    await openDebug(page);
    const debug=page.locator('#askDebug');await debug.waitFor();
    assert.deepEqual(await debug.locator('.debug-meters dd > span').allTextContents(),['1,600','1,200','400','320','20']);
    assert.match(await debug.locator('.debug-facts').textContent(),/显式标记 3 处/);
    assert.equal(await page.evaluate(() => ask.debugCall(1).body),calls[0].raw);
    await debug.locator('.debug-gt',{hasText:'工具与系统'}).click();
    await debug.locator('.debug-row[data-part="tools"]').click();
    const tools = debug.locator('.debug-part[data-open]').filter({has: page.locator('.debug-row[data-part="tools"]')});
    assert.match(await tools.locator('.debug-bmeta').textContent(),/tools\[\d+\]\.cache_control/);
    assert.match(await tools.locator('.debug-code').textContent(),/"cache_control"/);
    await page.keyboard.press('Escape');
    llm.push({body:anthropic(
      {type:'message_start',message:{usage:{input_tokens:60}}},
      {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'未返回缓存计数。'}},
      {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:10}},
      {type:'message_stop'}
    )});
    await page.locator('#askPrompt').fill('继续');await submitAsk(page);
    await page.waitForFunction(() => ask.debug.value.calls.length===2 && !ask.running.value);
    await openDebug(page);await debug.waitFor();
    assert.deepEqual(await debug.locator('.debug-meters dd > span').allTextContents(),['60','未报告','未报告','未报告','10']);
    assert.deepEqual(generation(requests),[]);
    assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test("ASK call debug: inspecting an active request preserves it, Esc closes only debug, stop retains the dispatched context", async () => {
  const {page, context, requests, errors} = await open('/#/image', {ready: '.switcher', ask: askSettings()});
  let release;
  const pending = new Promise(resolve => {release=resolve;});
  try {
    await bind(page);
    await page.route('https://chat.example.test/v1/chat/completions', async route => {
      await pending;
      try {await route.fulfill({contentType:'text/event-stream',body:openai(text('合成完成'),end())});} catch {}
    });
    await page.evaluate(() => ask.show());
    await page.locator('#askPrompt').fill('检查运行中的调用');await submitAsk(page);
    await page.waitForFunction(() => ask.debug.value.calls.length===1);
    await openDebug(page);
    const debug=page.locator('#askDebug');await debug.waitFor();
    assert.equal(await debug.locator('.debug-pill').first().getAttribute('data-s'),'running');
    assert.match(await debug.locator('.debug-unone').textContent(),/响应完成后由上游返回/);
    await debug.getByRole('button',{name:'更多',exact:true}).click();
    assert.equal(await debug.getByRole('menuitem',{name:'清空记录',exact:true}).isDisabled(),true);
    await page.keyboard.press('Escape');
    await debug.locator('#askDebugMore').waitFor({state:'detached'});
    assert.equal(await debug.isVisible(),true,'Esc closed the menu first');
    await page.evaluate(() => document.body.__vue_app__._instance.provides[Object.getOwnPropertySymbols(document.body.__vue_app__._instance.provides).find(k=>k.description==='ui')].toast('合成错误提示','err'));
    await debug.locator('.toast[role="alert"]').waitFor();
    await page.keyboard.press('Escape');await debug.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>ask.running.value),true);
    await drawer(page).getByRole('button',{name:'更多',exact:true}).focus();
    await page.keyboard.press('Escape');
    await page.locator('.ask-turn[data-status="stopped"]').waitFor();
    release();
    assert.equal(await page.evaluate(()=>ask.debug.value.calls[0].status),'stopped');
    assert.match(await page.evaluate(()=>ask.debugCall(1).body),/检查运行中的调用/);
    assert.deepEqual(generation(requests),[]);
    assert.deepEqual(errors,[]);
  } finally {release();await context.close();}
});
