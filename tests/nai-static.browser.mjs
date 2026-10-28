import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createLocalServer } from '../server.mjs';

test('built NAI tokenizer Worker and licensed vocabularies work at root and nested static paths',async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    for(const mount of ['/','/nested/']) {
      const server=createLocalServer({env:{KOMA_BASE_PATH:mount}});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const origin=`http://127.0.0.1:${server.address().port}`,context=await browser.newContext(),page=await context.newPage(),files=[],errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      try {
        await context.addInitScript(()=>{
          localStorage.setItem('koma.prefs.v1',JSON.stringify({tagSuggest:false}));
          localStorage.setItem('koma.routing.v1',JSON.stringify({version:1,connections:{test:{id:'test',name:'模拟官方',baseUrl:'https://image.novelai.net',profileId:'nai-official-v1',credentialRef:'test-key',revision:'r1'}},links:{}}));
          sessionStorage.setItem('koma.session.keys',JSON.stringify({'test-key':'synthetic-static-only'}));
        });
        await context.route('**/*',async route=>{
          const url=new URL(route.request().url());
          if(url.origin===origin){files.push(url.pathname);return route.continue();}
          if(url.href==='https://image.novelai.net/user/subscription'&&route.request().method()==='GET')return route.fulfill({json:{active:true,tier:3,usage:{isNegative:false},trainingStepsLeft:{fixedTrainingStepsLeft:1000,purchasedTrainingSteps:0}}});
          errors.push(`unexpected request: ${url.origin}${url.pathname}`);return route.abort();
        });
        await page.goto(origin+mount+'#/image');
        await page.locator('#model').click();
        await page.locator('.nai-menu:popover-open [data-value="nai-diffusion-4-5-full"]').click();
        await page.locator('#prompt').fill('1girl, blue hair');
        await page.waitForFunction(()=>document.querySelector('#tab-prompt .tab-count')?.textContent==='6'&&document.querySelector('#tab-prompt .tab-count')?.dataset.budget==='512');
        await page.locator('#model').click();
        await page.locator('.nai-menu:popover-open [data-value="nai-diffusion-5-curated"]').click();
        await page.locator('#prompt').fill('你好，世界');
        await page.waitForFunction(()=>document.querySelector('#tab-prompt .tab-count')?.textContent==='3'&&document.querySelector('#tab-prompt .tab-count')?.dataset.budget==='703');
        // Worker requests can bypass page-level routing; verify the same deployed URLs directly too.
        for(const name of ['t5.json','qwen35.json','LICENSE','NOTICE.txt','tokenizers-LICENSE.txt']) assert.equal((await page.request.get(origin+mount+'tokenizers/'+name)).status(),200);
        assert.equal(await page.locator('#trayEmpty').isVisible(),true);
        assert.deepEqual(errors,[]);
      }finally{await context.close();await new Promise(resolve=>server.close(resolve));}
    }
  }finally{await browser.close();}
});
