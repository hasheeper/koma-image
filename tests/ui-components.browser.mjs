import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from './helpers/vite.mjs';
let server, browser, origin;
before(async () => {
  server = await createServer(); await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });
async function open(t) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [], external = [], modules = [];
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => modules.push(new URL(request.url()).pathname));
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.goto(origin + '/__ui'); await page.locator('.ui-preview').waitFor();
  return { page, errors, external, modules };
}
test('UI preview uses real controls without application services, upstream requests or persistent writes', async t => {
  const { page, errors, external, modules } = await open(t);
  const initial = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, dbs: [] }));
  await page.getByLabel('预览主题').selectOption('light');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.getByLabel('预览状态').selectOption('loading');
  assert.equal(await page.getByRole('button', { name: '处理中…' }).isDisabled(), true);
  await page.getByLabel('预览状态').selectOption('error');
  assert.equal(await page.getByRole('alert').innerText(), '示例错误：请检查输入。');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  assert.match(await page.locator('.preview-notice').innerText(), /不发送请求/);
  await page.getByLabel('禁用控件', { exact: true }).check();
  assert.equal(await page.locator('#preview-choice').isDisabled(), true);
  const stored = await page.evaluate(async () => ({ local: { ...localStorage }, session: { ...sessionStorage }, dbs: await indexedDB.databases() }));
  assert.deepEqual(stored, initial);
  assert.ok(!modules.some(path => /\/src\/(services\/application|app\/bootstrap|ask\/service)\./.test(path)));
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
});
test('shared menus retain nested Escape, refocus and KeepAlive cleanup with two board consumers', async t => {
  const { page, errors } = await open(t);
  const trigger = page.getByRole('button', { name: 'IMAGE 示例画板', exact: true });
  const parent = page.locator('#preview-board-image');
  await trigger.click(); await parent.locator('.bd-more').first().click();
  await page.keyboard.press('Escape');
  assert.equal(await parent.evaluate(el => el.matches(':popover-open')), true);
  assert.equal(await parent.locator('.bd-more').first().evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await parent.evaluate(el => el.matches(':popover-open')), false);
  await trigger.click();
  // Programmatic deactivation does not first light-dismiss the menu via a pointer event.
  await page.getByLabel('显示画板菜单').evaluate(el => el.click());
  assert.equal(await page.locator(':popover-open').count(), 0);
  await page.evaluate(() => { dispatchEvent(new Event('resize')); dispatchEvent(new Event('scroll')); });
  await page.getByLabel('显示画板菜单').check();
  await page.getByRole('button', { name: 'EDIT 示例画板', exact: true }).click();
  assert.equal(await page.locator('#preview-board-edit').evaluate(el => el.matches(':popover-open')), true);
  const ids = await page.locator('[id]').evaluateAll(elements => elements.map(el => el.id));
  assert.equal(ids.length, new Set(ids).size);
  await page.keyboard.press('Escape');
  const action = page.getByRole('button', { name: '操作菜单', exact: true });
  await action.click();
  await page.waitForFunction(() => document.activeElement?.textContent?.includes('选择操作'));
  await page.evaluate(() => dispatchEvent(new Event('resize')));
  assert.equal(await page.locator('#preview-actions').evaluate(el => el.matches(':popover-open')), true);
  await page.keyboard.press('Tab');
  assert.equal(await action.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('#preview-actions').count(), 0);
  // An open/close in the same Vue tick must not reopen after its awaited nextTick.
  await action.evaluate(el => { el.click(); el.click(); });
  assert.equal(await action.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#preview-actions').count(), 0);
  await action.click(); await page.keyboard.press('Escape');
  assert.equal(await action.evaluate(el => el === document.activeElement), true);
  assert.deepEqual(errors, []);
});
