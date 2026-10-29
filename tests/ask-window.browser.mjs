import { test } from "node:test";
import assert from "node:assert/strict";

import { useAskFixture, submitAsk, open, openai, text, tool, end, askSettings, generation, bind, addImage, drawer, openMore, route, patchStep, proposal, askDraft, form, undoCheckpoint, islandMode, openConversations, askText, editQuestion, attachText } from "./helpers/ask-fixture.mjs";

useAskFixture();

test('ASK floating assistant: drag without opening or Vue updates, minimize preserves running turns, drafts and workspace layout', async () => {
  const { page, context, requests, errors, llm, calls } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await bind(page);
    await page.locator('#prompt').fill('adult woman, red eyes');
    await addImage(page, 'adult woman, red eyes');
    const geometry = () => page.locator('body > .topbar, .shell, #viewport, #gallery').evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    }));
    const before = await geometry(), initialForm = await form(page);
    const launcher = page.getByRole('button', { name: '打开 Koma ASK', exact: true });
    await launcher.waitFor();
    const orb = await launcher.boundingBox();
    await page.mouse.move(orb.x + 24, orb.y + 24);
    await page.mouse.down();
    await page.mouse.move(orb.x - 160, orb.y - 80, { steps: 20 });
    await page.mouse.up();
    assert.equal(await drawer(page).isVisible(), false, 'dragging the icon does not open ASK');
    assert.ok((await launcher.boundingBox()).x < orb.x - 100);
    await launcher.click();
    await page.waitForFunction(() => document.activeElement?.id === 'askPrompt');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#askDrawer')).opacity === '1');
    assert.equal(await launcher.isVisible(), false);
    assert.deepEqual(await geometry(), before, 'opening ASK does not resize the workspace');
    const node = await drawer(page).elementHandle();
    const original = await drawer(page).boundingBox();
    await page.evaluate(() => {
      window.askRenders = 0;
      const component = document.querySelector('#askIsland').__vueParentComponent;
      component.u = [...(component.u || []), () => window.askRenders++];
    });
    const handle = page.getByRole('group', { name: '移动 ASK 窗口' });
    const grip = await handle.boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x - 180, grip.y + 100, { steps: 30 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.askRenders), 0, 'pointer moves stay outside Vue updates');
    const moved = await drawer(page).boundingBox();
    assert.ok(moved.x < original.x - 100 && moved.y > original.y + 50);
    await handle.focus();
    const keyboardStart = await drawer(page).boundingBox();
    await handle.press('Alt+ArrowRight');
    await page.waitForFunction(x => Math.abs(document.querySelector('#askDrawer').getBoundingClientRect().x - x - 16) < 1, keyboardStart.x);
    const normal = await drawer(page).boundingBox();
    await drawer(page).getByRole('button', { name: '放大 ASK 窗口' }).click();
    await page.waitForFunction(() => document.querySelector('#askIsland').offsetWidth === 760);
    await drawer(page).getByRole('button', { name: '还原 ASK 窗口' }).click();
    await page.waitForFunction(({ x, y }) => {
      const r = document.querySelector('#askDrawer').getBoundingClientRect();
      return Math.abs(r.x - x) < 1 && Math.abs(r.y - y) < 1 && r.width === 420;
    }, normal);

    llm.push({ body: openai(text('窗口收起后也保留这轮回复。'), end()), delay: 450 });
    await page.locator('#askPrompt').fill('解释当前图片');
    await submitAsk(page);
    await page.waitForFunction(() => ask.running.value);
    await drawer(page).getByRole('button', { name: '收起 ASK', exact: true }).click();
    await drawer(page).waitFor({ state: 'hidden' });
    await page.locator('#askIsland[data-mode=run]').waitFor();
    await page.waitForFunction(() => !ask.running.value);
    assert.equal(await drawer(page).isVisible(), false, 'reply completion does not reopen the window');
    await page.locator('.ask-ready .ask-open').first().click();
    await drawer(page).locator('.ask-stream').getByText('窗口收起后也保留这轮回复。', { exact: true }).waitFor();
    llm.push(proposal([patchStep('replace', 'red eyes', 'blue eyes')]));
    await page.locator('#askPrompt').fill('把红眼睛改成蓝色');
    await submitAsk(page);
    await page.locator('.ask-draft[data-status="pending"]').waitFor();
    await page.locator('#askPrompt').fill('保留这条未发送的问题');
    await drawer(page).getByRole('button', { name: '收起 ASK', exact: true }).click();
    await page.locator('#askIsland[data-mode=ready]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '展开 ASK 对话');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#askPrompt').inputValue(), '保留这条未发送的问题');
    assert.equal(await page.locator('.ask-draft[data-status="pending"]').count(), 1);
    assert.equal(await node.evaluate(el => el === document.querySelector('#askDrawer')), true);
    for (const workspace of ['chat', 'tags', 'image']) {
      await route(page, `#/${workspace}`);
      await page.locator(`[data-workspace-root="${workspace}"]`).waitFor();
      assert.equal(await drawer(page).isVisible(), true);
      assert.equal(await page.locator('#askPrompt').inputValue(), '保留这条未发送的问题');
    }
    assert.deepEqual(await form(page), initialForm);
    assert.deepEqual(await geometry(), before);
    assert.equal(calls.length, 2);
    assert.deepEqual(generation(requests), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('ASK responsive window: desktop floats and mobile fills the screen across workspaces', async () => {
  const { page, context, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await bind(page);
    await addImage(page, 'synthetic window layout');
    const launcher = page.locator('#askLauncher');
    const bounds = async (locator, width, height) => {
      await page.waitForFunction(({ selector, width, height }) => {
        const el = document.querySelector(selector), r = el.getBoundingClientRect();
        const full = selector === '#askDrawer' && width <= 860;
        return getComputedStyle(el).opacity === '1' && el.scrollWidth <= el.clientWidth + 1 && (full
          ? r.left === 0 && r.top === 0 && r.width === width && r.height === height
          : r.left >= 7 && r.top >= 7 && r.right <= width - 7 && r.bottom <= height - 7);
      }, { selector: await locator.getAttribute('id').then(id => `#${id}`), width, height });
    };
    for (const [width, height] of [[1440,900], [861,900], [860,900], [768,900], [390,900], [320,900], [390,520]]) {
      await page.setViewportSize({ width, height });
      await bounds(launcher, width, height);
      await page.screenshot({ path: `.local/ask/window/icon-${width}-${height}.png` });
      await launcher.click();
      await bounds(drawer(page), width, height);
      await page.locator('#askPrompt').fill('输入和会话会在收起后保留');
      await page.screenshot({ path: `.local/ask/window/normal-${width}-${height}.png` });
      if (width > 860) {
        await drawer(page).getByRole('button', { name: '放大 ASK 窗口' }).click();
        await bounds(drawer(page), width, height);
        await page.screenshot({ path: `.local/ask/window/expanded-${width}-${height}.png` });
        await drawer(page).getByRole('button', { name: '还原 ASK 窗口' }).click();
      } else {
        assert.equal(await drawer(page).getByRole('button', { name: /放大 ASK 窗口|还原 ASK 窗口/ }).count(), 0);
        assert.equal(await drawer(page).locator('[data-ask-grip]').count(), 0);
        assert.equal(await drawer(page).getAttribute('aria-modal'), 'true');
        assert.equal(await page.locator('[data-workspace-root="image"]').getAttribute('inert'), '');
      }
      await drawer(page).getByRole('button', { name: '收起 ASK', exact: true }).click();
      await drawer(page).waitFor({ state: 'hidden' });
      assert.equal(await page.locator('[data-workspace-root="image"]').getAttribute('inert'), null);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await launcher.click();
    const identity = await page.locator('#askPrompt').elementHandle();
    for (const workspace of ['chat', 'edit', 'tags', 'home', 'image']) {
      await route(page, `#/${workspace}`);
      await bounds(drawer(page), 390, 844);
      assert.equal(await identity.evaluate(el => el === document.querySelector('#askPrompt')), true);
      assert.equal(await page.locator('#askPrompt').inputValue(), '输入和会话会在收起后保留');
      assert.equal(await page.locator(workspace === 'home' ? '.home-shell' : `[data-workspace-root="${workspace}"]`).getAttribute('inert'), '');
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden');
      await page.screenshot({path:`.local/ask/window/mobile-${workspace}.png`});
    }
    // Keyboard/browser chrome changes the visual viewport without changing the layout width.
    await page.evaluate(() => {
      window.testViewport = Object.assign(new EventTarget(), {width:390,height:470,offsetLeft:0,offsetTop:48});
      Object.defineProperty(window, 'visualViewport', {configurable:true, value:testViewport});
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForFunction(() => {
      const r = document.querySelector('#askIsland').getBoundingClientRect(), c = document.querySelector('.ask-composer').getBoundingClientRect();
      return r.top === 48 && r.height === 470 && c.bottom <= 518;
    });
    await page.evaluate(() => { delete window.visualViewport; window.dispatchEvent(new Event('resize')); });
    await bounds(drawer(page), 390, 844);
    await page.keyboard.press('Escape');
    await drawer(page).waitFor({state:'hidden'});
    await page.locator('#prompt').fill('selected prompt');
    await page.locator('#prompt').press('Control+k');
    await bounds(drawer(page), 390, 844);
    assert.equal(await page.evaluate(() => ask.inline.value.text), 'selected prompt');
    await page.setViewportSize({width:1440,height:900});
    await page.locator('#askDrawer.ask-inline').waitFor();
    await page.getByRole('button',{name:'展开',exact:true}).click();
    await bounds(drawer(page), 1440, 900);
    assert.equal(await drawer(page).getAttribute('aria-modal'), 'false');
    assert.deepEqual(generation(requests), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('ASK launcher: workspace anchors follow the image rail, remember each manual position and reset to the current anchor', async () => {
  const { page, context, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await bind(page);
    await addImage(page, 'synthetic launcher placement');
    const launcher = page.locator('#askLauncher');
    const anchored = () => page.waitForFunction(() => {
      const icon = document.querySelector('#askIsland'), r = icon.getBoundingClientRect();
      const bar = document.querySelector('.topbar').getBoundingClientRect();
      const right = icon.dataset.workspace === 'image' && innerWidth > 860
        ? document.querySelector('#gallery').getBoundingClientRect().left - 8
        : innerWidth - (innerWidth <= 480 ? 12 : 20);
      return Math.abs(r.right - right) < 1 && Math.abs(r.top - bar.height - 12) < 1;
    });
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const workspace of ['image', 'chat', 'tags']) {
        await route(page, `#/${workspace}`);
        await page.locator(`[data-workspace-root="${workspace}"]`).waitFor();
        await anchored();
        await page.screenshot({ path: `.local/ask/window/anchor-${workspace}-${width}.png` });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await route(page, '#/image');
    await page.locator('#histToggle').click();
    await page.waitForFunction(() => document.querySelector('#gallery').offsetWidth === 52);
    await anchored();
    const folded = await launcher.boundingBox();
    await page.locator('#histToggle').click();
    await page.waitForFunction(() => document.querySelector('#gallery').offsetWidth === 132);
    await anchored();
    const expanded = await launcher.boundingBox();
    assert.ok(folded.x > expanded.x, 'the default icon stays beside the history rail');
    await launcher.focus();
    await launcher.press('Alt+ArrowLeft');
    await launcher.press('Alt+ArrowDown');
    const manual = await launcher.boundingBox();
    assert.equal(Math.round(expanded.x - manual.x), 16);
    assert.equal(Math.round(manual.y - expanded.y), 16);
    for (const workspace of ['chat', 'tags']) {
      await route(page, `#/${workspace}`);
      await page.locator(`[data-workspace-root="${workspace}"]`).waitFor();
      await anchored();
    }
    await route(page, '#/image');
    await page.waitForFunction(({ x, y }) => {
      const r = document.querySelector('#askLauncher').getBoundingClientRect();
      return Math.abs(r.x - x) < 1 && Math.abs(r.y - y) < 1;
    }, manual);
    await launcher.focus();
    await launcher.press('Alt+Home');
    await anchored();
    assert.deepEqual(generation(requests), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('ASK island: collapsed tools, reviewed draft, apply/undo, focus guards and timed idle use the real turn', async () => {
  const { page, context, llm, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await bind(page);
    await page.evaluate(() => drawing.patch({ prompt: 'red eyes' }));
    const initial = await form(page);
    await addImage(page, 'red eyes');
    await page.locator('#askLauncher').click();
    const draftNode = () => page.locator('.ask-draft');
    llm.push({ body: openai(tool('meta', 'get_meta', { id: '#h1' }), end('tool_calls')) });
    llm.push({ ...proposal([patchStep('replace', 'red eyes', 'blue eyes')]), delay: 700 });
    await page.locator('#askPrompt').fill('把红眼睛改成蓝色');
    await submitAsk(page);
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'run');
    assert.match(await page.locator('.ask-activity').textContent(), /正在/);
    assert.equal(await page.locator('.ask-run button').count(), 1, 'the running island only opens the window');
    // Esc on the island never stops the turn: the draft still arrives.
    await page.keyboard.press('Escape');
    await islandMode(page, 'ready');
    assert.equal(await drawer(page).isVisible(), false);
    assert.equal(await page.locator('#askCompactDraft .ask-draft').isVisible(), true);
    assert.match(await page.locator('.ask-result-grip').textContent(), /2 项工具/);
    assert.equal(await page.locator('#askCompactDraft .draft-body').isVisible(), false);
    assert.equal(await page.locator('#askCompactDraft [aria-label="查看草稿修改"]').isVisible(), true);
    assert.deepEqual(await form(page), initial, 'collapsed completion never writes');
    const node = await draftNode().elementHandle();
    await page.locator('#askCompactDraft [aria-label="查看草稿修改"]').click();
    assert.equal(await page.locator('#askFullDraft .draft-toggle').getAttribute('aria-expanded'), 'true', 'reviewing opens the body');
    assert.match(await page.locator('#askFullDraft .draft-diff').textContent(), /red eyes.*blue eyes/);
    assert.equal(await node.evaluate(el => el === document.querySelector('#askFullDraft .ask-draft')), true, 'Teleport retains the reviewed card');
    await page.locator('#askPrompt').fill('保留输入');
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'ready');
    // Workspace typing, IME and modals keep their own keys while the card floats.
    await page.locator('#prompt').focus();
    await page.keyboard.press('Tab');
    assert.deepEqual(await form(page), initial);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', isComposing: true, bubbles: true })));
    assert.deepEqual(await form(page), initial);
    await route(page, '#/image/settings/ask');
    await page.locator('#settingsPanel[open]').waitFor();
    await page.keyboard.press('Tab');
    assert.deepEqual(await form(page), initial);
    await page.keyboard.press('Escape');
    await page.locator('#settingsPanel').waitFor({ state: 'hidden' });
    await page.locator('.ask-ready [aria-label="展开 ASK 对话"]').focus();
    await page.keyboard.press('Tab');
    await islandMode(page, 'done');
    assert.equal((await form(page)).prompt, 'blue eyes');
    // Undo lives in the window: the write pill only opens it.
    assert.equal(await page.locator('.ask-done button').count(), 1);
    await page.locator('.ask-done [aria-label="展开 ASK 对话"]').click();
    await undoCheckpoint(page);
    assert.deepEqual(await form(page), initial);
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'idle');
    // A new pending draft still validates edits in compact mode.
    await askDraft(page,llm,[patchStep('replace','red eyes','blue eyes')]);
    await page.locator('#askPrompt').fill('保留输入');
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page,'ready');
    await page.evaluate(() => drawing.patch({ prompt: 'green eyes' }));
    assert.equal(await page.locator('#askCompactDraft .ask-draft-apply').isDisabled(), true);
    assert.match(await page.locator('#askCompactDraft .draft-issue').textContent(), /锚点不唯一或已不存在/);
    await page.evaluate(() => drawing.patch({ prompt: 'red eyes' }));
    await page.locator('#askCompactDraft .ask-draft-apply').click();
    await islandMode(page, 'done');
    await islandMode(page, 'idle');
    assert.equal((await form(page)).prompt, 'blue eyes');
    await page.locator('#askLauncher').click();
    assert.equal(await page.locator('#askPrompt').inputValue(), '保留输入');
    llm.push({ body: openai(text('这是新一轮普通回复。'), end()) });
    await submitAsk(page);
    await page.locator('#askDrawer .ask-turn[data-status="done"]').nth(2).waitFor();
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'ready');
    assert.equal(await page.locator('#askCompactDraft .ask-draft').count(), 0, 'an earlier applied draft stays out of a new text answer');
    await page.locator('.ask-ready .ask-details').click();
    await undoCheckpoint(page);
    assert.deepEqual(await form(page), initial, 'undo remains available after the pill returns to idle');
    assert.deepEqual(generation(requests), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('ASK island: text, error, stop and responsive morphs retain anchors without hiding controls', async () => {
  const { page, context, llm, requests, errors } = await open('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await bind(page);
    await addImage(page, 'synthetic island');
    let glass;
    for (const [width, height] of [[1440,900], [768,900], [390,900], [320,900], [390,520]]) {
      await page.setViewportSize({ width, height });
      const shot = async state => {
        await islandMode(page, state);
        await page.waitForFunction(state => {
          const el = document.querySelector('#askIsland'), r = el.getBoundingClientRect();
          if (state === 'exp' && innerWidth <= 860) return r.x === 0 && r.y === 0 && r.width === innerWidth && r.height === innerHeight && el.scrollWidth <= el.clientWidth + 1;
          const size = { idle: [40, 40], run: [304, 40], done: [172, 40], exp: [420, Math.min(660, innerHeight - 16)], ready: [372, el.querySelector('.ask-ready').offsetHeight] }[state];
          return r.width === Math.min(size[0], innerWidth - 16) && Math.abs(r.height - size[1]) < 1 && r.left >= 7 && r.right <= innerWidth - 7 && r.top >= 7 && r.bottom <= innerHeight - 7 && el.scrollWidth <= el.clientWidth + 1;
        }, state);
        const visual = await page.locator('#askIsland').evaluate(el => {
          const r = el.getBoundingClientRect(), layer = el.querySelector('.ask-layer:not([inert])');
          const mark = layer?.querySelector('.ask-mark'), m = mark?.getBoundingClientRect(), style = getComputedStyle(el);
          return { glass: style.backgroundColor, blur: style.backdropFilter, mark: m ? { width: m.width, height: m.height, left: m.x - r.x, top: m.y - r.y } : null, height: r.height };
        });
        glass ??= visual.glass;
        if (state === 'exp' && width <= 860) {
          assert.equal(visual.blur, 'none', 'mobile uses the HOME full-screen solid surface');
          assert.equal(await page.locator('#askIsland').evaluate(el => getComputedStyle(el, '::before').backgroundColor === getComputedStyle(document.body).backgroundColor), true);
        } else {
          assert.equal(visual.glass, glass, 'floating states use the same translucent surface');
          assert.match(visual.glass, /rgba\(/);
          assert.match(visual.blur, /blur\(20px\)/);
        }
        if (visual.mark) {
          assert.equal(visual.mark.width, 20);
          assert.equal(visual.mark.height, 20);
          if (state === 'idle' || state === 'run') {
            assert.equal(visual.mark.left, 10, 'the mark stays on the same 20px leading grid');
            assert.equal(visual.mark.top, 10, 'the icon has no inline baseline gap');
          }
        }
        if (state === 'ready' && width >= 390) assert.ok(visual.height < 180, 'the draft summary remains compact');
        await page.screenshot({ path: `.local/ask/island/${state}-${width}-${height}.png` });
        await page.locator('#askIsland').screenshot({ path: `.local/ask/island/${state}-${width}-${height}-surface.png` });
      };
      await shot('idle');
      await page.locator('#askLauncher').click();
      await shot('exp');
      llm.push({ ...proposal([patchStep('rewrite', '', 'blue eyes')]), delay: 700 });
      await page.locator('#askPrompt').fill('整理提示词');
      await submitAsk(page);
      await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
      await shot('run');
      await shot('ready');
      assert.equal(await page.locator('#askCompactDraft .ask-draft-apply').isVisible(), true);
      await page.locator('#askCompactDraft .ask-draft-apply').click();
      await shot('done');
      assert.equal(await page.locator('.ask-done button').count(), 1, 'no undo on the write pill');
      await page.locator('.ask-done [aria-label="展开 ASK 对话"]').click();
      await undoCheckpoint(page);
      await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    }
    // Real motion: the same surface expands towards the left from its right edge.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(600);
    await page.mouse.move(500, 600);
    await page.waitForTimeout(450);
    const markGeometry = () => page.locator('#askLauncher').evaluate(el => {
      const rect = selector => { const r = el.querySelector(selector).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width }; };
      return { mark: rect('.ask-mark'), core: rect('.core'), corner: rect('.c4'), transform: getComputedStyle(el).transform };
    });
    const still = await markGeometry();
    await page.locator('#askLauncher').hover();
    await page.waitForTimeout(450);
    const hover = await markGeometry();
    assert.deepEqual(hover.mark, still.mark, 'hover must not translate the SVG or button');
    assert.deepEqual(hover.core, still.core, 'only corner squares move');
    assert.equal(hover.transform, 'none');
    assert.equal(hover.corner.x - still.corner.x, -.5);
    assert.equal(hover.corner.y - still.corner.y, .5);
    await page.locator('#askIsland').screenshot({ path: '.local/ask/island/icon-hover.png' });
    const right = await page.locator('#askIsland').evaluate(el => el.getBoundingClientRect().right);
    await page.mouse.down();
    await page.waitForTimeout(300);
    const pressed = await markGeometry();
    assert.ok(Math.abs(pressed.core.x - still.core.x) < .01 && Math.abs(pressed.core.y - still.core.y) < .01, 'press scales around the same center');
    await page.mouse.up();
    await page.waitForTimeout(100);
    const during = await page.locator('#askIsland').boundingBox();
    assert.ok(during.width > 40 && during.width < 420);
    assert.ok(Math.abs(during.x + during.width - right) < 1);
    await page.waitForTimeout(600);
    llm.push({ body: openai(text('原因是 `crimson theme` 的色调。'), end()), delay: 300 });
    await page.locator('#askPrompt').fill('解释图片');
    await submitAsk(page);
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'ready');
    assert.equal(await page.locator('.ask-summary code').textContent(), 'crimson theme');
    assert.equal(await page.locator('.ask-draft').count(), 0);
    await page.locator('.ask-ready [aria-label="收起 ASK 结果"]').click();
    await islandMode(page, 'idle');
    // Failure has a path to the existing explicit retry UI, with no auto retry.
    await page.locator('#askLauncher').click();
    llm.push({ status: 503, type: 'application/json', body: JSON.stringify({ error: { message: 'synthetic unavailable' } }), delay: 600 });
    await page.locator('#askPrompt').fill('失败示例');
    await submitAsk(page);
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'ready');
    assert.match(await page.locator('.ask-summary').textContent(), /synthetic unavailable/);
    await page.locator('.ask-ready .ask-details').click();
    assert.equal(await page.locator('#askDrawer .ask-fail-actions button').first().isVisible(), true);
    llm.push({ body: openai(text('late reply'), end()), delay: 3000 });
    await page.locator('#askDrawer .ask-fail-actions button').first().click();
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'run');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => ask.running.value), true, 'Esc on the island never stops a turn');
    await page.locator('.ask-run [aria-label="展开 ASK 对话"]').click();
    await drawer(page).getByRole('button', { name: '停止', exact: true }).click();
    await page.locator('#askDrawer [aria-label="收起 ASK"]').click();
    await islandMode(page, 'ready');
    assert.match(await page.locator('.ask-summary').textContent(), /已停止/);
    await page.locator('.ask-ready [aria-label="展开 ASK 对话"]').focus();
    await page.keyboard.press('Escape');
    await islandMode(page, 'idle');
    assert.deepEqual(generation(requests), []);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

// W6: exercise the native/window boundary and transient UI cleanup, not a benchmark.
test('ASK W6: pointer dragging avoids component renders; repeated overlays and unmount release resources', async () => {
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await context.addInitScript(() => {
      window.askObserved = new Map();
      const Original = ResizeObserver;
      window.ResizeObserver = class extends Original {
        constructor(callback) { super(callback); askObserved.set(this,new Set()); }
        observe(target,...args) { askObserved.get(this).add(target); return super.observe(target,...args); }
        unobserve(target) { askObserved.get(this).delete(target); return super.unobserve(target); }
        disconnect() { askObserved.get(this).clear(); return super.disconnect(); }
      };
      window.askPointers = new Set();
      const add = document.addEventListener, remove = document.removeEventListener;
      document.addEventListener = function(type,listener,options) {
        if(type==='pointerdown' && (options===true || options?.capture)) askPointers.add(listener);
        return add.call(this,type,listener,options);
      };
      document.removeEventListener = function(type,listener,options) {
        if(type==='pointerdown' && (options===true || options?.capture)) askPointers.delete(listener);
        return remove.call(this,type,listener,options);
      };
    });
    await page.reload(); await page.locator('.switcher').waitFor(); await bind(page);
    await askText(page,llm,'检查窗口生命周期','这是一条用于界面回归的合成回答。');
    await attachText(page,'本地合成附件，检查预览关闭后的监听器回收。');
    const baseline=await page.evaluate(()=>askPointers.size);
    for(let i=0;i<4;i++) {
      await openConversations(page); await page.keyboard.press('Escape');
      await openMore(page); await page.keyboard.press('Escape');
      await page.getByRole('button',{name:'查看 角色设定.md',exact:true}).click();
      await page.keyboard.press('Escape');
      await editQuestion(page); await page.keyboard.press('Escape');
      await page.waitForFunction(count=>askPointers.size===count,baseline);
    }
    await page.evaluate(async()=>{
      await new Promise(requestAnimationFrame);
      window.askRenders=0;
      for(const selector of ['#askIsland','.ask-stream']) {
        const instance=document.querySelector(selector).__vueParentComponent;
        (instance.bu??=[]).push(()=>{window.askRenders++;});
      }
    });
    const grip=await page.locator('.ask-fill').boundingBox(), before=await page.locator('#askIsland').boundingBox();
    await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();
    await page.mouse.move(grip.x+grip.width/2-100,grip.y+grip.height/2+70,{steps:30});await page.mouse.up();
    const after=await page.locator('#askIsland').boundingBox();
    assert.ok(Math.abs(before.x-after.x-100)<1 && Math.abs(after.y-before.y-70)<1,'real pointer events move the window');
    assert.equal(await page.evaluate(()=>askRenders),0,'dragging does not rerender the window or stream');
    assert.equal(await drawer(page).isVisible(),true,'a completed drag does not toggle the window');
    await openMore(page);
    const released=await page.evaluate(()=>{
      const root=document.querySelector('#askIsland');
      const owned=[...askObserved].filter(([,targets])=>[...targets].some(el=>el===root||root.contains(el))).map(([o])=>o);
      document.body.__vue_app__.unmount();
      const before=root.style.cssText;
      window.dispatchEvent(new Event('resize'));
      document.dispatchEvent(new Event('visibilitychange'));
      return new Promise(resolve=>requestAnimationFrame(()=>resolve({owned:owned.length,targets:owned.reduce((n,o)=>n+askObserved.get(o).size,0),pointers:askPointers.size,unchanged:before===root.style.cssText})));
    });
    assert.ok(released.owned>=2,'window and stream observers were exercised');
    assert.equal(released.targets,0);assert.equal(released.pointers,baseline);assert.equal(released.unchanged,true);
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});

test('ASK W6: empty state and long draft preserve readable content and reachable controls at four widths', async () => {
  const {page,context,llm,requests,errors}=await open('/#/image',{ready:'.switcher',ask:askSettings()});
  try {
    await bind(page);await page.evaluate(()=>ask.show());
    const capture=async(state)=>{
      for(const width of [320,390,768,1440]) {
        await page.setViewportSize({width,height:900});
        await page.waitForFunction(()=>{
          const el=document.querySelector('#askIsland'),r=el.getBoundingClientRect();
          return innerWidth <= 860 ? r.x===0 && r.y===0 && r.width===innerWidth && r.height===innerHeight
            : r.left>=7 && r.top>=7 && r.right<=innerWidth-7 && r.bottom<=innerHeight-7;
        });
        assert.ok(await drawer(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1));
        const composer=await page.locator('.ask-composer').boundingBox();
        assert.ok(composer.height>=70 && composer.y+composer.height<=892,'composer stays reachable');
        if(state==='long-draft') {
          const layout=await page.locator('#askDraftBody').evaluate(el=>({scroll:el.scrollHeight>el.clientHeight,overflow:el.scrollWidth>el.clientWidth+1}));
          assert.equal(layout.scroll,true);assert.equal(layout.overflow,false);
          assert.ok((await page.locator('.ask-stream').boundingBox()).height>=56,'long draft leaves a message region');
        }
        await page.screenshot({path:`.local/ask/w6/${state}-${width}.png`});
      }
    };
    await capture('empty');
    await page.evaluate(()=>drawing.patch({prompt:'red eyes',negative:'low quality'}));
    const long='blue eyes, '+Array.from({length:70},(_,i)=>`synthetic lighting detail ${i+1}`).join(', ');
    await askDraft(page,llm,[patchStep('rewrite','',long),patchStep('replace','low quality','blurry','image.negative')],'整理这组场景描述，保留人物和画风','核对人物、光照与场景描述的长草稿');
    await capture('long-draft');
    assert.deepEqual(generation(requests),[]);assert.deepEqual(errors,[]);
  } finally {await context.close();}
});
