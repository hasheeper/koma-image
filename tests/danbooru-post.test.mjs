import { test } from "node:test";
import assert from "node:assert/strict";
import { createTagSearch } from "../src/services/tag-search.ts";
import { droppedLink, postId, postParams, postPrompt, readPost } from "../src/domain/danbooru-post.ts";
import { readTagRuntime } from "../src/config/runtime.ts";

const local = { baseUrl: "http://127.0.0.1/api/danbooru/", token: "synthetic-tag-token" };

const variant = (type, ext, host = "cdn.donmai.us") => ({ type, url: `https://${host}/${type}/ab/cd/abcd.${ext}`, width: 600, height: 800, file_ext: ext });
const raw = (fields = {}) => ({
  id: 123456, rating: "q", image_width: 1200, image_height: 1600,
  tag_string: "wlop hatsune_miku vocaloid 1girl long_hair highres",
  tag_string_artist: "wlop", tag_string_character: "hatsune_miku", tag_string_copyright: "vocaloid",
  tag_string_general: "1girl long_hair", tag_string_meta: "highres",
  media_asset: { variants: [variant("180x180", "jpg"), variant("360x360", "jpg"), variant("720x720", "webp"), variant("sample", "jpg"), variant("original", "png")] },
  ...fields,
});

test("danbooru post: only a post link on danbooru.donmai.us yields an ID", () => {
  for (const link of [
    "https://danbooru.donmai.us/posts/123456",
    "  https://danbooru.donmai.us/posts/123456?q=wlop  ",
    "http://danbooru.donmai.us/posts/123456/",
    "danbooru.donmai.us/posts/123456#comments",
    "https://Danbooru.Donmai.us/posts/123456?q=a+b&page=2",
  ]) assert.equal(postId(link), 123456, link);
  for (const text of [
    "", "123456", "https://danbooru.donmai.us/posts?tags=wlop", "https://danbooru.donmai.us/posts/12a",
    "https://safebooru.donmai.us/posts/1", "https://danbooru.donmai.us.evil.example/posts/1",
    "see https://danbooru.donmai.us/posts/1", "https://danbooru.donmai.us/posts/0",
  ]) assert.equal(postId(text), null, text);
  assert.equal(droppedLink("# comment\r\nhttps://danbooru.donmai.us/posts/7\r\nhttps://x.test/"), "https://danbooru.donmai.us/posts/7");
});

test("danbooru post: category groups, sample before 720, CDN images only", () => {
  const post = readPost(raw());
  assert.deepEqual(post.tags, { artist: ["wlop"], character: ["hatsune_miku"], copyright: ["vocaloid"], general: ["1girl", "long_hair"] });
  assert.equal(post.image.src, "https://cdn.donmai.us/sample/ab/cd/abcd.jpg");
  assert.equal(post.original.src, "https://cdn.donmai.us/original/ab/cd/abcd.png");
  assert.equal(post.preview.src, "https://cdn.donmai.us/360x360/ab/cd/abcd.jpg");
  assert.deepEqual([post.width, post.height], [1200, 1600]);
  // No sample, or a sample off the CDN or not a picture: the 720px variant.
  for (const sample of [null, variant("sample", "jpg", "evil.example"), variant("sample", "webm")]) {
    const variants = [variant("720x720", "webp"), ...(sample ? [sample] : [])];
    assert.equal(readPost(raw({ media_asset: { variants } })).image.src, "https://cdn.donmai.us/720x720/ab/cd/abcd.webp");
  }
  assert.equal(readPost(raw({ media_asset: {} })).image, null);
  assert.equal(readPost(raw({ media_asset: {}, file_url: "https://cdn.donmai.us/abcd.png", file_ext: "png" })).original.src, "https://cdn.donmai.us/abcd.png");
  for (const id of [-1, 0, 1.5]) assert.throws(() => readPost(raw({ id })), /格式异常/);
  assert.throws(() => readPost({ id: 1, rating: "x" }), /格式异常/);
  assert.throws(() => readPost(null), /格式异常/);
});

test("danbooru post: prompt groups in panel order, ASK metadata as posted", () => {
  const post = readPost(raw());
  assert.equal(postPrompt(post, ["general", "artist"]), "wlop, 1girl, long hair");
  assert.equal(postPrompt(post, ["artist", "character", "copyright", "general"]), "wlop, hatsune miku, vocaloid, 1girl, long hair");
  assert.deepEqual(postParams(post), {
    name: "danbooru-123456.jpg", dialect: "Danbooru", source: "https://danbooru.donmai.us/posts/123456", fields: {},
    extras: [
      { label: "post_id", value: "123456" }, { label: "rating", value: "q" },
      { label: "artist", value: "wlop" }, { label: "character", value: "hatsune_miku" },
      { label: "copyright", value: "vocaloid" }, { label: "general", value: "1girl, long_hair" },
    ],
  });
});

test("danbooru post: one local request per post, proxied image, failures not kept", async () => {
  const calls = [];
  let reply = () => new Response(JSON.stringify(raw()));
  const tags = createTagSearch(() => [0], async (url, init) => {
    calls.push({ url: String(url), init });
    return reply(String(url));
  }, local);
  const post = await tags.post(123456);
  assert.equal(calls[0].url, local.baseUrl + "posts/123456.json");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.referrerPolicy, "no-referrer");
  await tags.post(123456);
  assert.equal(calls.length, 1);

  reply = () => new Response(new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }));
  const file = await tags.postImage(post);
  assert.equal(calls[1].url, local.baseUrl + "media/sample/ab/cd/abcd.jpg");
  assert.equal(calls[1].init.credentials, "omit");
  assert.deepEqual([file.name, file.type, file.size], ["danbooru-123456.jpg", "image/jpeg", 3]);
  reply = () => new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
  const original = await tags.postImage(post, undefined, true);
  assert.equal(calls.at(-1).url, local.baseUrl + "media/original/ab/cd/abcd.png");
  assert.equal(original.name, "danbooru-123456.png");
  reply = () => new Response("<html>", { headers: { "content-type": "text/html" } });
  await assert.rejects(tags.postImage(post), /不是图片/);
  reply = () => new Response("", { status: 403 });
  await assert.rejects(tags.postImage(post), /图片暂不可用 \(403\)/);
  await assert.rejects(tags.postImage({ ...post, image: null }), /没有可用的图片/);
  await assert.rejects(tags.postImage({ ...post, original: null }, undefined, true), /没有可用的原图/);

  reply = () => new Response("{}", { status: 404 });
  await assert.rejects(tags.post(9), /没有这条帖子/);
  reply = () => { throw new TypeError("network"); };
  await assert.rejects(tags.post(7), /本地词典服务连接失败/);
  assert.equal(calls.filter((c) => c.url.endsWith("/posts/7.json")).length, 1);

  const before = calls.length, aborted = new AbortController();
  aborted.abort();
  await assert.rejects(tags.post(123456, aborted.signal), { name: "AbortError" });
  await assert.rejects(tags.postImage(post, aborted.signal), { name: "AbortError" });
  await assert.rejects(tags.post(0), /ID 无效/);
  assert.equal(calls.length, before, "invalid or cancelled requests never leave the page, even with a cached post");
  reply = () => new Response(JSON.stringify(raw({ id: 88 })));
  await assert.rejects(tags.post(99), /ID 不一致/);
  reply = () => new Response(JSON.stringify(raw({ id: 99 })));
  assert.equal((await tags.post(99)).id, 99, "a mismatched response was not cached");
});

test("danbooru post: Chinese names by exact match, a few lookups at a time, stopping at a failure", async () => {
  let open = 0, peak = 0, fail = false;
  const asked = [];
  const tags = createTagSearch(() => [0], async (url) => {
    const q = new URL(url).searchParams.get("q");
    asked.push(q);
    open++; peak = Math.max(peak, open);
    await new Promise((r) => setTimeout(r, 5));
    open--;
    if (fail) throw new TypeError("network");
    return new Response(JSON.stringify({ results: [
      { name: `${q}_extra`, cn_name: "错配", count: 1, category: 0 },
      ...(q === "nothing" ? [] : [{ name: q, cn_name: `中文 ${q}`, count: 42, category: 0 }]),
    ] }));
  });
  const names = ["a", "b", "c", "d", "e", "f", "nothing", "a"];
  const found = await tags.translate(names);
  assert.equal(peak, 4);
  assert.deepEqual(asked.sort(), ["a", "b", "c", "d", "e", "f", "nothing"]);
  assert.equal(found.get("a").cnName, "中文 a");
  assert.equal(found.get("a").count, 42);
  assert.equal(found.has("nothing"), false);

  fail = true; asked.length = 0;
  const none = await tags.translate(["p", "q", "r", "s", "t", "u", "v", "w", "x", "y"]);
  assert.equal(none.size, 0);
  // Each of the four lanes retries the network once (shared helper), then all stop.
  assert.ok(asked.length <= 8, `asked ${asked.length}`);
});

test('danbooru post: static mode blocks posts, samples and images without requests; keyword search stays available', async () => {
  assert.equal(readTagRuntime({ getElementById: () => null }), undefined);
  const calls = [];
  const tags = createTagSearch(() => [0], async url => {
    calls.push(String(url));
    return Response.json({ results: [{ name: 'blue_hair', cn_name: '蓝发', count: 42, category: 0 }] });
  });
  assert.equal(tags.postsAvailable, false);
  const unsupported = /云端静态版不支持/;
  assert.match(tags.postsUnavailableReason, unsupported);
  await assert.rejects(tags.post(123456), unsupported);
  await assert.rejects(tags.samples('studio_artist', 'g'), unsupported);
  await assert.rejects(tags.postImage(readPost(raw())), unsupported);
  await assert.rejects(tags.postImage(readPost(raw()), undefined, true), unsupported);
  assert.equal(calls.length, 0, 'no direct calls or local proxy probes');
  assert.equal((await tags.page('蓝发')).items[0].cnName, '蓝发');
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).host, 'tagsuggest.zeabur.app');
});
