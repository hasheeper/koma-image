import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useAskFixture, open, bind, askSettings, pasteSynthetic, route, scripted, attachedImages, generation, savedAsk, reloadAsk } from './helpers/ask-fixture.mjs';

useAskFixture();
const openLocal = (hash, options) => open(hash, { ...options, localTags: true });
const link = id => `https://danbooru.donmai.us/posts/${id}?q=blue_hair&page=2`;
const categories = [
  ['studio_artist', '示例画师', 1], ['sample_character', '示例角色', 4],
  ['sample_series', '示例作品', 3], ['blue_hair', '蓝发', 0], ['long_hair', '长发', 0],
];
const variant = (id, type, width, height) => ({ type, url: `https://cdn.donmai.us/${type}/${id}.png`, file_ext: 'png', width, height });
const post = id => ({
  id, rating: 'q', image_width: 256, image_height: 384,
  tag_string_artist: 'studio_artist', tag_string_character: 'sample_character',
  tag_string_copyright: 'sample_series', tag_string_general: 'blue_hair long_hair', tag_string_meta: 'highres',
  media_asset: { variants: [variant(id, '360x360', 64, 96), variant(id, '720x720', 128, 192), variant(id, 'sample', 128, 192), variant(id, 'original', 256, 384)] },
});

async function sources(t, direct = false) {
  const state = { posts: [], images: [], postStatus: 200, imageStatus: 200, hold: null, missingSample: false, translateStatus: 200 };
  const buffers = await t.page.evaluate(async () => {
    const result = {};
    for (const [kind, width, height] of [['original', 256, 384], ['sample', 128, 192], ['360x360', 64, 96]]) {
      const canvas = new OffscreenCanvas(width, height), g = canvas.getContext('2d');
      g.fillStyle = '#7968ac'; g.fillRect(0, 0, width, height);
      result[kind] = [...new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())];
    }
    return result;
  });
  await t.context.route(direct ? 'https://danbooru.donmai.us/**' : '**/api/danbooru/posts**', async route => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace('/api/danbooru', '');
    const id = Number(/\/posts\/(\d+)\.json$/.exec(url.pathname)?.[1]);
    state.posts.push({ path: url.pathname, headers: route.request().headers() });
    if (state.hold) await state.hold;
    if (url.pathname === '/posts.json') return route.fulfill({ status: state.postStatus, json: [{ ...post(123456), rating: 'g' }] });
    if (!id) throw new Error(`unexpected post URL ${url}`);
    const result = post(id);
    if (state.missingSample) result.media_asset.variants = result.media_asset.variants.filter(v => v.type !== 'sample');
    return route.fulfill({ status: state.postStatus, json: result });
  });
  await t.context.route(direct ? 'https://cdn.donmai.us/**' : '**/api/danbooru/media/**', route => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace('/api/danbooru/media', '');
    const kind = url.pathname.split('/')[1];
    state.images.push(url.pathname);
    return route.fulfill({ status: state.imageStatus, contentType: 'image/png', body: Buffer.from(buffers[kind === '720x720' ? 'sample' : kind]) });
  });
  await t.context.route('https://tagsuggest.zeabur.app/**', route => {
    const query = new URL(route.request().url()).searchParams.get('q'), row = categories.find(c => c[0] === query);
    return route.fulfill({ status: state.translateStatus, json: { results: row ? [{ name: row[0], cn_name: row[1], category: row[2], count: 42 }] : [] } });
  });
  return state;
}
async function dropLink(page, selector, text, type = 'text/uri-list') {
  return page.locator(selector).evaluate((el, { text, type }) => {
    const data = new DataTransfer(); data.setData(type, text);
    for (const name of ['dragenter', 'dragover', 'drop']) {
      const event = new DragEvent(name, { bubbles: true, cancelable: true, dataTransfer: data });
      el.dispatchEvent(event);
      if (name === 'drop') return event.defaultPrevented;
    }
  }, { text, type });
}
async function prepared(page, count = 1) {
  await page.waitForFunction(count => !ask.preparing.value && ask.tray.value.length === count, count);
}

test('Danbooru TAGS: post URL shows grouped tags, exact Chinese names, preview and existing weights', async () => {
  const t = await openLocal('/#/tags', { ready: '#tagSearch', ask: askSettings() });
  try {
    await bind(t.page); const state = await sources(t);
    assert.equal(state.posts.length, 0);
    await t.page.locator('#tagSearch').fill(link(123456));
    await t.page.locator('.tag-card').filter({ hasText: '蓝发' }).waitFor();
    assert.equal(await t.page.locator('.tag-card').count(), 5);
    assert.deepEqual((await t.page.locator('.tag-group-head').allTextContents()).map(s => s.replace(/\s/g, '')), ['画师1', '角色1', '作品1', '通用2']);
    assert.equal(await t.page.locator('.tag-post-identity .tag-add[data-tag="sample_character"]').count(), 1);
    await t.page.waitForFunction(() => document.querySelector('.tag-post-thumb img')?.naturalWidth > 0);
    assert.equal(await t.page.locator('.tag-post-mark').textContent(), 'R15');
    const more = t.page.getByRole('button', { name: 'blue hair 的更多操作', exact: true });
    await more.click();
    const menu = t.page.getByRole('menu', { name: 'blue hair 的操作', exact: true });
    assert.equal(await menu.getByRole('menuitem').count(), 2, 'general tag exposes copy and source, with no unavailable sample item');
    assert.equal(await menu.getByRole('menuitem', { name: '在 Danbooru 打开 blue hair（新标签页）', exact: true }).getAttribute('href'), 'https://danbooru.donmai.us/posts?tags=blue_hair');
    await menu.press('Escape');
    assert.equal(await more.evaluate(el => el === document.activeElement), true);
    assert.equal(await t.page.locator('.tag-add[data-tag="blue_hair"]').getAttribute('aria-pressed'), 'false', 'menu does not toggle the tag');
    await more.click();
    await t.page.getByRole('menuitem', { name: '复制 blue hair', exact: true }).click();
    await t.page.getByText('已复制 blue hair', { exact: true }).waitFor();
    assert.equal(await menu.count(), 0);
    await t.page.locator('.tag-add[data-tag="blue_hair"]').click();
    await t.page.getByRole('button', { name: '打开 Prompt 组合', exact: true }).click();
    const weight = t.page.getByRole('spinbutton', { name: 'blue hair 权重', exact: true });
    await weight.fill('1.4'); await weight.blur();
    assert.equal(await t.page.locator('#tagCartPrompt').textContent(), '1.4::blue hair::');
    assert.equal(state.posts.length, 1);
    assert.ok(!state.posts[0].headers.authorization && !state.posts[0].headers.cookie && !state.posts[0].headers.referer);
    assert.equal(t.calls.length, 0);
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('Danbooru IMAGE: paste and URI/plain-text drop reuse import selection and original image; cancel leaves prompt intact', async () => {
  const t = await openLocal('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await bind(t.page); const state = await sources(t);
    await t.page.locator('#prompt').fill('keep this');
    assert.equal(await pasteSynthetic(t.page, '#prompt', { text: link(123456) }), true);
    await t.page.locator('#importSheet:not([hidden])').waitFor();
    assert.equal(await t.page.locator('#prompt').inputValue(), 'keep this');
    assert.equal(await t.page.locator('#importSheet .import-text').count(), 4);
    await t.page.waitForFunction(() => document.querySelector('.import-figure img')?.naturalWidth === 256);
    assert.ok(state.images.includes('/original/123456.png'));
    assert.ok(!state.images.includes('/sample/123456.png'));
    for (const value of ['artist', 'copyright', 'general']) await t.page.locator(`#importSheet .import-text[data-key="${value}"] label`).click();
    await t.page.locator('#importApply').click();
    assert.equal(await t.page.locator('#prompt').inputValue(), 'sample character');
    assert.equal(await dropLink(t.page, '#prompt', `# browser link\r\n${link(123457)}`), true);
    await t.page.locator('#importSheet:not([hidden])').waitFor();
    await t.page.locator('#importSheet').getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await t.page.locator('#prompt').inputValue(), 'sample character');
    assert.equal(await dropLink(t.page, '#prompt', link(123458), 'text/plain'), true);
    await t.page.locator('#importSheet:not([hidden])').waitFor();
    await t.page.locator('#importSheet').getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(t.calls.length, 0); assert.deepEqual(generation(t.requests), []); assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

for (const connection of ['chat', 'claude']) test(`Danbooru ASK ${connection}: paste stays in tray, sends known tags only on click, metadata mode and saved recovery`, async () => {
  const t = await openLocal('/#/image', { ready: '.switcher', ask: askSettings({ connectionId: connection }) });
  try {
    await bind(t.page); const state = await sources(t);
    await t.page.evaluate(() => { ask.show(); ask.setInput('请按参考图改写'); });
    assert.equal(await pasteSynthetic(t.page, '#askPrompt', { text: link(123456) }), true);
    await prepared(t.page);
    assert.equal(await t.page.locator('#askPrompt').inputValue(), '请按参考图改写');
    assert.equal(await t.page.locator('#importSheet').isVisible(), false);
    assert.equal(t.calls.length, 0);
    assert.ok(state.images.includes('/sample/123456.png') && !state.images.includes('/original/123456.png'));
    t.llm.push({ body: scripted(connection) });
    await t.page.locator('#askDrawer').getByRole('button', { name: '发送', exact: true }).click();
    await t.page.waitForFunction(() => !ask.running.value && ask.entries.value.some(e => e.type === 'turn'));
    assert.equal(attachedImages(t.calls[0].body).length, 1);
    for (const text of ['post_id', '123456', 'rating', 'artist', 'studio_artist', 'character', 'sample_character', 'copyright', 'sample_series', 'general', 'blue_hair, long_hair']) assert.ok(t.calls[0].raw.includes(text), text);
    assert.ok(!t.calls[0].raw.includes('view_tag_samples'));
    assert.equal(t.calls[0].body.tools.length, 13);
    await t.page.evaluate(() => ask.toggleFavorite());
    const saved = await savedAsk(t.page);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].attachments[0].params.dialect, 'Danbooru');
    assert.deepEqual(saved[0].attachments[0].params.extras.find(e => e.label === 'general'), { label: 'general', value: 'blue_hair, long_hair' });
    const imageCalls = state.images.length;
    await reloadAsk(t.page);
    await t.page.locator('.ask-sent-img').waitFor();
    assert.equal(state.images.length, imageCalls, 'saved attachment restoration needs no CDN request');
    await t.page.evaluate(() => ask.setImages(false));
    state.missingSample = true;
    await dropLink(t.page, '#askPrompt', link(123457));
    await prepared(t.page);
    assert.ok(state.images.includes('/720x720/123457.png'));
    t.llm.push({ body: scripted(connection) });
    await t.page.locator('#askDrawer').getByRole('button', { name: '发送', exact: true }).click();
    await t.page.waitForFunction(() => !ask.running.value && ask.entries.value.filter(e => e.type === 'turn').length === 2);
    assert.equal(attachedImages(t.calls.at(-1).body).length, 0);
    assert.ok(t.calls.at(-1).raw.includes('studio_artist'));
    assert.deepEqual(generation(t.requests), []); assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('Danbooru sample button: failed download can retry; success enters the ASK tray without sending', async () => {
  const t = await openLocal('/#/tags', { ready: '#tagSearch', ask: askSettings() });
  try {
    await bind(t.page); const state = await sources(t);
    await t.page.locator('#tagSearch').fill(link(123456));
    const more = t.page.getByRole('button', { name: 'studio artist 的更多操作', exact: true });
    await more.click();
    await t.page.getByRole('menuitem', { name: '查看 studio artist 的示例图', exact: true }).click();
    await t.page.locator('#tagSamples').waitFor();
    await t.page.keyboard.press('Escape');
    assert.equal(await more.evaluate(el => el === document.activeElement), true);
    await more.click();
    await t.page.getByRole('menuitem', { name: '查看 studio artist 的示例图', exact: true }).click();
    const button = t.page.getByRole('button', { name: '把 #123456 发给 ASK', exact: true });
    await button.waitFor(); state.imageStatus = 503;
    await button.click();
    await t.page.getByText('Danbooru 图片暂不可用 (503)', { exact: true }).waitFor();
    assert.equal(await button.isDisabled(), false);
    assert.equal(await t.page.evaluate(() => ask.tray.value.length), 0);
    state.imageStatus = 200;
    await button.click(); await prepared(t.page);
    assert.equal(await button.isDisabled(), false);
    assert.equal(t.calls.length, 0);
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('Danbooru failures: IMAGE still offers tags if original is unavailable; TAGS preserves untranslated cards', async () => {
  const t = await openLocal('/#/image', { ready: '.switcher', ask: askSettings() });
  try {
    await bind(t.page); const state = await sources(t); state.imageStatus = 403;
    await pasteSynthetic(t.page, '#prompt', { text: link(123456) });
    await t.page.locator('#importSheet:not([hidden])').waitFor();
    assert.equal(await t.page.locator('#importSheet .import-text').count(), 4);
    await t.page.locator('#importSheet summary').click();
    await t.page.getByText('原图未加载', { exact: true }).waitFor();
    await t.page.locator('#importApply').click();
    assert.equal(await t.page.locator('#prompt').inputValue(), 'studio artist, sample character, sample series, blue hair, long hair');
    state.translateStatus = 503; state.imageStatus = 200;
    await route(t.page, '#/tags');
    await dropLink(t.page, '#tagSearch', link(123457));
    await t.page.getByText('点选 Tag 加入 Prompt 组合', { exact: true }).waitFor();
    assert.equal(await t.page.locator('.tag-card').count(), 5);
    assert.equal(await t.page.locator('.tag-add[data-tag="blue_hair"]').textContent().then(s => s.trim()), 'blue hair');
    assert.equal(t.calls.length, 0); assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});

test('Danbooru ASK: a pending download remains owned by the starting conversation; HOME accepts pasted and dropped links', async () => {
  const t = await openLocal('/#/image', { ready: '.switcher', ask: askSettings() });
  let release;
  try {
    await bind(t.page); const state = await sources(t);
    state.hold = new Promise(done => { release = done; });
    const first = await t.page.evaluate(() => { ask.show(); ask.setInput('first'); return ask.conversationId.value; });
    await t.page.evaluate(() => ask.toggleFavorite());
    await pasteSynthetic(t.page, '#askPrompt', { text: link(123456) });
    await t.page.waitForFunction(() => ask.preparing.value > 0);
    await t.page.evaluate(() => { ask.newConversation(); ask.setInput('second'); });
    release(); state.hold = null;
    await t.page.waitForFunction(() => !ask.preparing.value);
    assert.equal(await t.page.evaluate(() => ask.tray.value.length), 0);
    await t.page.evaluate(first => ask.selectConversation(first), first);
    await prepared(t.page);
    await t.page.evaluate(() => { ask.removeAttachment(ask.tray.value[0].id); ask.hide(); });
    await route(t.page, '#/home');
    await pasteSynthetic(t.page, '.home-ask textarea', { text: link(123457) });
    await prepared(t.page);
    await t.page.evaluate(() => { ask.removeAttachment(ask.tray.value[0].id); ask.hide(); });
    await dropLink(t.page, '.home-ask textarea', link(123458));
    await prepared(t.page);
    assert.equal(t.calls.length, 0); assert.deepEqual(t.errors, []);
  } finally { release?.(); await t.context.close(); }
});

test('Danbooru static: tries direct reads; a 403 offers the original site and explicit retry, then TAGS, IMAGE and ASK can succeed', async () => {
  const t = await open('/#/tags', { ready: '#tagSearch', ask: askSettings() });
  try {
    await bind(t.page); const state = await sources(t, true);
    state.postStatus = 403;
    await t.page.locator('#tagSearch').fill(link(123456));
    await t.page.getByRole('heading', { name: '帖子读取失败', exact: true }).waitFor();
    await t.page.getByText(/拒绝了请求（403）.*Cloudflare/).waitFor();
    assert.equal(state.posts.length, 1);
    assert.equal(await t.page.locator('.tags-card').getByRole('link', { name: '打开原站', exact: true }).getAttribute('href'), 'https://danbooru.donmai.us/posts/123456');
    assert.equal(await t.page.getByRole('button', { name: /导入帖子 JSON/ }).count(), 0);
    state.postStatus = 200;
    await t.page.getByRole('button', { name: '重试', exact: true }).click();
    await t.page.locator('.tag-post').waitFor();
    assert.equal(state.posts.length, 2);
    state.postStatus = 403;
    await t.page.getByRole('button', { name: 'studio artist 的更多操作', exact: true }).click();
    await t.page.getByRole('menuitem', { name: '查看 studio artist 的示例图', exact: true }).click();
    await t.page.locator('#tagSamples').getByText(/拒绝了请求（403）/).waitFor();
    assert.equal(new URL(await t.page.locator('#tagSamples').getByRole('link', { name: '打开原站', exact: true }).getAttribute('href')).pathname, '/posts');
    state.postStatus = 200;
    await t.page.locator('#tagSamples').getByRole('button', { name: '重试', exact: true }).click();
    await t.page.getByRole('button', { name: '把 #123456 发给 ASK', exact: true }).waitFor();
    await t.page.keyboard.press('Escape');
    await route(t.page, '#/image');
    await t.page.locator('#prompt').fill('keep my prompt');
    await pasteSynthetic(t.page, '#prompt', { text: link(123457) });
    await t.page.locator('#importSheet:not([hidden])').waitFor();
    await t.page.locator('#importSheet').getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await t.page.locator('#prompt').inputValue(), 'keep my prompt');
    await t.page.evaluate(() => ask.show());
    state.postStatus = 403;
    await pasteSynthetic(t.page, '#askPrompt', { text: link(123458) });
    await t.page.getByText(/拒绝了请求（403）/).last().waitFor();
    await t.page.getByRole('button', { name: '打开原站', exact: true }).waitFor();
    assert.equal(await t.page.evaluate(() => ask.tray.value.length), 0);
    state.postStatus = 200;
    await pasteSynthetic(t.page, '#askPrompt', { text: link(123458) });
    await prepared(t.page);
    assert.ok(state.images.some(path => path.startsWith('/original/')));
    assert.ok(state.images.some(path => path.startsWith('/sample/')));
    assert.equal(t.calls.length, 0);
    assert.deepEqual(t.errors, []);
  } finally { await t.context.close(); }
});
