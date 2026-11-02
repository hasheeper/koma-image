import { test } from "node:test";
import assert from "node:assert/strict";
import { createTagSearch } from "../src/services/tag-search.ts";
import { postsUrl, readSamples, sampleMark, samplesQuery, sampleTier } from "../src/domain/tag-samples.ts";

const post = (id, rating, tags = "", variant = { type: "360x360", url: `https://cdn.donmai.us/360x360/${id}.webp`, width: 270, height: 360 }) => ({
  id, rating, tag_string: tags,
  media_asset: { variants: [{ type: "180x180", url: `https://cdn.donmai.us/180x180/${id}.jpg`, width: 135, height: 180 }, variant] },
});

test("tag samples: one Danbooru rating step per switch under 自由创作", () => {
  assert.equal(sampleTier(false, true, true), "g");
  assert.equal(sampleTier(true, false, true), "s");
  assert.equal(sampleTier(true, true, false), "q");
  assert.equal(sampleTier(true, true, true), "e");
  assert.equal(samplesQuery("hatsune_miku", "g"), "hatsune_miku rating:g order:score");
  assert.equal(samplesQuery("hatsune_miku", "s"), "hatsune_miku rating:g,s order:score");
  assert.equal(samplesQuery("hatsune_miku", "q"), "hatsune_miku rating:g,s,q order:score");
  assert.equal(samplesQuery("hatsune_miku", "e"), "hatsune_miku order:score");
  assert.equal(new URL(postsUrl(samplesQuery("a_b", "s"))).searchParams.get("tags"), "a_b rating:g,s order:score");
});

test("tag samples: filter strictly by Danbooru rating tiers, keep only valid CDN thumbnails", () => {
  const rows = readSamples([
    post(1, "g", "1girl"),
    post(2, "s", "1girl school_uniform"),
    post(3, "q", "1girl"),
    post(4, "e", "1girl"),
    post(5, "e", "1girl portrait"),
    post(6, "x"),                                        // 无效 rating 丢弃
    post(7, "s", "", { type: "360x360", url: "http://cdn.donmai.us/360x360/7.webp", width: 1, height: 1 }), // http 丢弃
    post(8, "s", "", { type: "720x720", url: "https://cdn.donmai.us/720x720/8.webp", width: 1, height: 1 }), // 非 360 变体丢弃
    post(9, "g", "", { type: "360x360", url: "https://other.example/9.webp" }),
    { rating: "g" },
    null,
  ], "e");
  assert.deepEqual(rows.map((v) => v.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(rows[0], { id: 1, rating: "g", src: "https://cdn.donmai.us/360x360/1.webp", width: 270, height: 360 });
  assert.deepEqual(rows.map(sampleMark), ["", "", "R15", "R18", "R18"]);
  assert.throws(() => readSamples({ success: false }, "g"), /格式异常/);

  // 各档位严格只显示自己的范围
  const all = ["g", "s", "q", "e"].map((rating, i) => post(10 + i, rating));
  assert.deepEqual(readSamples(all, "g").map((v) => v.rating), ["g"]);
  assert.deepEqual(readSamples(all, "s").map((v) => v.rating), ["g", "s"]);
  assert.deepEqual(readSamples(all, "q").map((v) => v.rating), ["g", "s", "q"]);
  assert.deepEqual(readSamples(all, "e").map((v) => v.rating), ["g", "s", "q", "e"]);
});

test("tag samples: one anonymous request per tier and name, failures neither kept nor retried", async () => {
  const calls = [];
  let reply = () => new Response(JSON.stringify([post(1, "g"), post(2, "s")]));
  const tags = createTagSearch(() => [0], async (url, init) => {
    calls.push({ url: new URL(url), init });
    return reply();
  });
  const first = await tags.samples("blue_hair", "s");
  assert.deepEqual(first.map((v) => v.id), [1, 2]);
  first.length = 0;
  assert.equal((await tags.samples("blue_hair", "s")).length, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin + calls[0].url.pathname, "https://danbooru.donmai.us/posts.json");
  assert.equal(calls[0].url.searchParams.get("tags"), "blue_hair rating:g,s order:score");
  assert.equal(calls[0].url.searchParams.get("limit"), "20");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.referrerPolicy, "no-referrer");
  await tags.samples("blue_hair", "g");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.searchParams.get("limit"), "8");

  reply = () => new Response("{}", { status: 429 });
  await assert.rejects(tags.samples("red_hair", "q"), /过于频繁/);
  assert.equal(calls.length, 3);
  reply = () => new Response("{}", { status: 503 });
  await assert.rejects(tags.samples("red_hair", "q"), /暂不可用 \(503\)/);
  reply = () => new Response("<html>");
  await assert.rejects(tags.samples("red_hair", "q"), /格式异常/);
  reply = () => { throw new TypeError("network"); };
  await assert.rejects(tags.samples("red_hair", "q"), /无法读取 Danbooru.*网络或站点验证/);
  assert.equal(calls.length, 6);
  reply = () => new Response(JSON.stringify([post(3, "q")]));
  assert.deepEqual((await tags.samples("red_hair", "q")).map(sampleMark), ["R15"]);

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(tags.samples("green_hair", "g", aborted.signal), { name: "AbortError" });
});
