import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, open, bind, askSettings, askText, textReply, submitAsk, drawer, attachText } from './helpers/ask-fixture.mjs';

useAskFixture();
const answer = title => `**${title}**\n\n${Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 项：保留角色外观，调整光影与构图。`).join('\n\n')}`;
const bottom = page => page.waitForFunction(() => {
  const el = document.querySelector('.ask-stream');
  return el && el.clientHeight > 0 && el.scrollHeight - el.scrollTop - el.clientHeight < 4;
});
const position = page => page.locator('.ask-stream').evaluate(el => el.scrollTop);
const ticks = page => page.getByRole('navigation', { name: '对话轮次导航' }).getByRole('button');
async function clickTick(page, index = 0) {
  // Entering the edge reveals the rail beneath the pointer, changing the hit target.
  if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) {
    // Let the opening window settle before entering its narrow edge.
    await drawer(page).locator('.ask-head').hover();
    await page.locator('.ask-timeline-edge').hover({ force: true });
  }
  await ticks(page).nth(index).click();
}
async function history(f, count = 3) {
  await bind(f.page);
  for (let i = 1; i <= count; i++) {
    await askText(f.page, f.llm, `构图调整 ${i}`, answer(`第 ${i} 轮结论`));
    assert.equal(await ticks(f.page).count(), i < 3 ? 0 : i);
  }
  await bottom(f.page);
}

test('ASK navigation: preview and keyboard jump only browse turns; return to latest restores following', async () => {
  const f = await open('/#/image', { ready: '#prompt', ask: askSettings({ images: false }) });
  const { page, context, calls, errors } = f;
  try {
    await history(f);
    const before = await page.evaluate(() => JSON.stringify(ask.entries.value)), count = calls.length;
    assert.equal(await ticks(page).count(), 3);
    assert.equal(await ticks(page).last().getAttribute('aria-current'), 'step');
    assert.equal(await page.locator('.ask-timeline').getAttribute('data-expanded'), null);
    await page.locator('.ask-timeline-edge').hover({ force: true });
    await ticks(page).first().hover();
    const preview = page.getByRole('tooltip');
    await preview.waitFor();
    assert.equal(await page.locator('.ask-timeline').getAttribute('data-expanded'), 'true');
    assert.match(await preview.textContent(), /构图调整 1.*第 1 轮结论/s);
    await page.keyboard.press('Escape');
    await preview.waitFor({ state: 'detached' });
    assert.equal(await drawer(page).isVisible(), true);
    await clickTick(page);
    await page.getByRole('button', { name: '回到最近', exact: true }).waitFor();
    assert.equal(await ticks(page).first().getAttribute('aria-current'), 'step');
    const first = await position(page);
    // A mouse click leaves DOM focus on the tick, but must not pin the rail open.
    await page.locator('#askPrompt').hover();
    await page.waitForFunction(() => !document.querySelector('.ask-timeline').hasAttribute('data-expanded'));
    assert.equal(await ticks(page).first().evaluate(el => el === document.activeElement), true);
    await ticks(page).first().press('ArrowDown');
    assert.equal(await ticks(page).nth(1).evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('.ask-timeline').getAttribute('data-expanded'), 'true');
    await page.keyboard.press('Enter');
    assert.ok(await position(page) > first);
    await page.getByRole('button', { name: '回到最近', exact: true }).click();
    await bottom(page);
    assert.equal(await page.getByRole('button', { name: '回到最近', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => JSON.stringify(ask.entries.value)), before);
    assert.equal(calls.length, count);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('ASK navigation: reopening always goes to latest; an arriving reply does not interrupt browsing old turns', async () => {
  const f = await open('/#/image', { ready: '#prompt', ask: askSettings({ images: false }), motion: 'no-preference' });
  const { page, context, errors } = f;
  try {
    await history(f);
    await clickTick(page);
    await drawer(page).getByRole('button', { name: '收起 ASK', exact: true }).click();
    await page.keyboard.press('Control+j');
    await bottom(page);
    await clickTick(page);
    await page.keyboard.press('Control+j');
    await page.locator('.ask-launcher').click();
    await bottom(page);
    let release;
    f.llm.push({ ...textReply(answer('新一轮回复')), wait: new Promise(resolve => { release = resolve; }) });
    await page.locator('#askPrompt').fill('继续调整'); await submitAsk(page);
    await page.waitForFunction(() => ask.running.value);
    await clickTick(page);
    const reading = await position(page);
    release();
    await page.waitForFunction(() => !ask.running.value);
    assert.equal(await position(page), reading);
    assert.equal(await ticks(page).first().getAttribute('aria-current'), 'step');
    await page.getByRole('button', { name: '回到最近', exact: true }).click(); await bottom(page);
    // Content can grow independently of a model turn (tool expansion / attachment layout).
    await page.evaluate(() => {
      ask.entries.value = ask.entries.value.map((entry, i, list) => i === list.length - 1 ? {
        ...entry, turn: { ...entry.turn, items: [...entry.turn.items, { kind: 'tools', rows: Array.from({ length: 12 }, (_, n) => ({
          id: `preview-${n}`, name: 'get_meta', verb: '读取', object: `参考 ${n + 1}`, stat: '参数', state: 'done',
        })) }] },
      } : entry);
    });
    await bottom(page);
    await page.locator('.ask-tools-line').last().click();
    await bottom(page);
    assert.equal(await page.locator('.ask-tools-line').last().getAttribute('aria-expanded'), 'true');
    await page.locator('.ask-stream').hover(); await page.mouse.wheel(0, -500);
    await page.getByRole('button', { name: '回到最近', exact: true }).waitFor();
    await drawer(page).getByRole('button', { name: '收起 ASK', exact: true }).click();
    await page.keyboard.press('Control+j'); await bottom(page);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('ASK navigation: long histories, attachment-only turns and conversation switches retain correct targets', async () => {
  const f = await open('/#/image', { ready: '#prompt', ask: askSettings({ images: false }) });
  const { page, context, errors } = f;
  try {
    await bind(page); await page.evaluate(() => ask.show());
    await attachText(page, '合成角色资料', '角色资料.txt');
    f.llm.push(textReply(answer('附件已读取'))); await submitAsk(page);
    await page.waitForFunction(() => !ask.running.value && ask.entries.value.some(e => e.type === 'turn'));
    await page.evaluate(() => {
      const source = ask.entries.value.find(e => e.type === 'turn');
      ask.entries.value = [
        ...Array.from({ length: 40 }, (_, i) => ({ ...source, id: 1000 + i, turn: {
          ...source.turn, id: 1000 + i, committed: null, turnId: null,
          question: i === 0 ? '' : `历史提问 ${i + 1}`, attachments: i === 0 ? source.turn.attachments : [],
          ...(i === 39 ? { status: 'failed', items: [], failure: { kind: 'local', message: '模拟连接中断' } } : {}),
        } })),
        { type: 'note', id: 2000, text: '普通说明不新增轮次刻度' },
      ];
    });
    await bottom(page);
    assert.equal(await ticks(page).count(), 40);
    await ticks(page).last().focus();
    assert.match(await page.getByRole('tooltip').textContent(), /模拟连接中断/);
    await page.keyboard.press('Home');
    assert.equal(await ticks(page).first().evaluate(el => document.activeElement === el), true);
    assert.match(await page.getByRole('tooltip').textContent(), /角色资料.txt/);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.ask-stream').scrollTop < 4);
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.ask-timeline-rail [aria-current]')?.dataset.id === '1039');
    const previous = await page.evaluate(() => { const id = ask.conversationId.value; ask.newConversation(); return id; });
    await page.locator('.ask-start').waitFor();
    assert.equal(await ticks(page).count(), 0);
    assert.equal(await page.getByRole('button', { name: '回到最近', exact: true }).count(), 0);
    await page.evaluate(id => ask.selectConversation(id), previous); await bottom(page);
    assert.equal(await ticks(page).count(), 40);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

for (const screen of [{ name: 'mobile', width: 390, touch: true, route: '/#/image', ready: '#prompt' }, { name: 'HOME', width: 1440, touch: false, route: '/#/home', ready: '.home-ask' }]) {
  test(`ASK navigation: ${screen.name} uses the same timeline and reopen behavior`, async () => {
    const f = await open(screen.route, { ...screen, ask: askSettings({ images: false }) });
    const { page, context, errors } = f;
    try {
      if (screen.name === 'mobile') await page.getByRole('dialog', { name: '当前窗口较窄', exact: true }).getByRole('button', { name: '切换到 BETA', exact: true }).click();
      await history(f, 3);
      await clickTick(page);
      await page.getByRole('button', { name: '回到最近', exact: true }).click(); await bottom(page);
      await clickTick(page);
      if (screen.name === 'mobile') await page.getByRole('group', { name: '侧栏内容', exact: true }).getByRole('button', { name: 'ASK', exact: true }).click();
      else await drawer(page).getByRole('button', { name: '收起 ASK', exact: true }).click();
      await page.evaluate(() => ask.show()); await bottom(page);
      if (screen.name === 'HOME') {
        await drawer(page).getByRole('button', { name: '放大 ASK 窗口', exact: true }).click();
        await bottom(page);
        await clickTick(page);
        await page.getByRole('button', { name: '回到最近', exact: true }).click(); await bottom(page);
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
