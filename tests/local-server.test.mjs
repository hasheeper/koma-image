import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalServer } from "../server.mjs";
import { readRuntime, readTagRuntime } from "../src/config/runtime.ts";
import { createTagSearch } from "../src/services/tag-search.ts";
import { createConnections } from "../src/services/connections.ts";
import { createTransport } from "../src/gateway/transport.ts";
import { standardProfile } from "../src/gateway/profile.ts";
import { names } from "../src/storage/names.ts";
import {
  collectBackupPreferences,
  readBackupPreferences,
} from "../src/storage/backup-schema.ts";

let directory;
const env = {
  KOMA_GATEWAY_URL: "https://gateway.example.test/prefix",
  KOMA_GATEWAY_KEY: "synthetic-server-secret",
};
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "koma-server-"));
  await writeFile(
    join(directory, "index.html"),
    "<!doctype html><html><head></head><body>Koma</body></html>",
  );
  await writeFile(join(directory, ".env"), "synthetic-private-file");
});
after(() => rm(directory, { recursive: true, force: true }));
async function open(options = {}) {
  const server = createLocalServer({ directory, env, ...options });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const mount = options.env?.KOMA_BASE_PATH || "/";
  const html = await (await fetch(origin + mount)).text();
  const token = JSON.parse(
    html.match(/id="koma-runtime"[^>]*>(.*?)<\/script>/)?.[1] || "{}",
  ).token;
  return {
    server,
    origin,
    html,
    url: origin + mount,
    headers: {
      "X-Koma-Local-Token": token,
      "Content-Type": "application/json",
    },
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
function tagRuntime(t) {
  const text = t.html.match(/id="koma-tags-runtime"[^>]*>(.*?)<\/script>/)?.[1];
  return readTagRuntime({ baseURI: t.url, getElementById: id => id === 'koma-tags-runtime' && text ? { textContent: text } : null });
}

test('Danbooru local: isolated runtime, fixed post routes, no credentials forwarded and no model connection lock', async () => {
  const calls = [], post = { id: 123456, rating: 'g', tag_string_artist: 'sample_artist' };
  const t = await open({ env: { KOMA_BASE_PATH: '/app/' }, fetcher: async (url, init) => {
    calls.push({ url: new URL(url), init });
    return Response.json(url.pathname === '/posts.json' ? [] : post, { headers: { 'Set-Cookie': 'never-forward', 'X-Upstream': 'never-forward' } });
  } });
  try {
    const local = tagRuntime(t), headers = { 'X-Koma-Local-Token': local.token };
    assert.equal(local.baseUrl, t.url + 'api/danbooru/');
    assert.equal(readRuntime({ getElementById: () => null }), undefined);
    assert.equal(t.html.includes('id="koma-runtime"'), false, 'public tags do not enable readonly model connections');
    const tags = createTagSearch(() => [0], fetch, local);
    assert.deepEqual((await tags.post(123456)).tags.artist, ['sample_artist']);
    assert.deepEqual(await tags.samples('sample_artist', 'g'), []);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url.href, 'https://danbooru.donmai.us/posts/123456.json');
    assert.equal(calls[1].url.searchParams.get('tags'), 'sample_artist rating:g order:score');
    assert.equal(calls[1].url.searchParams.get('limit'), '8');
    const response = await fetch(local.baseUrl + 'posts/123456.json', { headers: { ...headers, Cookie: 'browser-cookie', Authorization: 'Bearer browser-secret' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('x-upstream'), null);
    const request = calls.at(-1).init;
    assert.deepEqual(Object.keys(request.headers).sort(), ['Accept', 'User-Agent']);
    assert.match(request.headers['User-Agent'], /^Koma-Image\//);
    assert.equal(request.redirect, 'error');
    assert.equal(request.credentials, 'omit');
    assert.equal(request.referrerPolicy, 'no-referrer');
    const before = calls.length;
    for (const [suffix, status] of [
      ['posts/0.json', 404], ['users.json', 404], ['posts/1.json?api_key=secret', 400],
      ['posts.json?tags=a&limit=21', 400], ['posts.json?tags=a&tags=b&limit=8', 400],
      ['posts.json?tags=a&url=https://evil.example', 400], ['posts.json?tags=%0a&limit=8', 400],
      ['https://evil.example/posts/1.json', 404],
    ]) assert.equal((await fetch(local.baseUrl + suffix, { headers })).status, status, suffix);
    assert.equal((await fetch(local.baseUrl + 'posts/1.json')).status, 403);
    assert.equal((await fetch(local.baseUrl + 'posts/1.json', { method: 'POST', headers })).status, 405);
    assert.equal((await fetch(local.baseUrl + 'posts/1.json', { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    assert.equal(calls.length, before, 'invalid requests never reach the upstream');
  } finally { await t.close(); }
});

test('Danbooru local: bounded JSON, challenge, upstream errors, no retry and no upstream HTML leakage', async () => {
  let reply, calls = 0;
  const t = await open({ env: {}, fetcher: async () => { calls++; return reply(); } });
  try {
    const local = tagRuntime(t), tags = createTagSearch(() => [0], fetch, local);
    reply = () => new Response('<html>challenge-private</html>', { status: 403, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' } });
    await assert.rejects(tags.post(1), /需要站点验证/);
    assert.equal(calls, 1);
    reply = () => Response.json({}, { status: 404 });
    await assert.rejects(tags.post(1), /没有这条帖子/);
    reply = () => Response.json({}, { status: 429 });
    await assert.rejects(tags.post(1), /过于频繁/);
    reply = () => { throw new TypeError('private-address-or-secret'); };
    await assert.rejects(tags.post(1), /本地服务无法连接 Danbooru.*代理配置/);
    reply = () => new Response('invalid', { headers: { 'content-type': 'application/json' } });
    await assert.rejects(tags.post(1), /JSON 格式异常/);
    reply = () => new Response('[]', { headers: { 'content-type': 'application/json', 'content-length': 5 * 1024 * 1024 } });
    await assert.rejects(tags.post(1), /数据过大/);
    reply = () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } });
    await assert.rejects(tags.post(1), /数据过大/);
    reply = () => Response.json({ id: 1, rating: 'g' });
    assert.equal((await tags.post(1)).id, 1, 'failures are not cached');
    assert.equal(calls, 8);
  } finally { await t.close(); }
});

test('Danbooru local: timeout and client cancellation abort the upstream request', async () => {
  let aborted = 0, start;
  const t = await open({ env: {}, timeout: 50, fetcher: async (_url, { signal }) => new Promise((_, reject) => {
    start?.();
    signal.addEventListener('abort', () => { aborted++; reject(signal.reason); }, { once: true });
  }) });
  try {
    const local = tagRuntime(t), url = local.baseUrl + 'posts/1.json', headers = { 'X-Koma-Local-Token': local.token };
    const timed = await fetch(url, { headers });
    assert.equal(timed.status, 504);
    assert.match((await timed.json()).error, /请求超时/);
    const started = new Promise(resolve => { start = resolve; });
    const controller = new AbortController(), pending = fetch(url, { headers, signal: controller.signal });
    await started;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await new Promise(resolve => setTimeout(resolve, 70));
    assert.equal(aborted, 2);
  } finally { await t.close(); }
});

test('Danbooru local: tag session tokens cannot authorize model endpoints', async () => {
  const t = await open({ fetcher: async () => { throw new Error('must not call'); } });
  try {
    const local = tagRuntime(t);
    assert.notEqual(local.token, t.headers['X-Koma-Local-Token']);
    assert.equal((await fetch(t.url + 'api/v1/image/models', { headers: { 'X-Koma-Local-Token': local.token } })).status, 403);
    assert.equal((await fetch(local.baseUrl + 'posts/1.json', { headers: t.headers })).status, 403);
  } finally { await t.close(); }
});

test('Danbooru local: only hash-addressed CDN images, exact bytes, anonymous headers and bounded image types', async () => {
  const calls = [], bytes = new Uint8Array([137, 80, 78, 71]), hash = 'abcd0123456789abcdef0123456789ab';
  let reply = () => new Response(bytes, { headers: { 'content-type': 'image/png', 'set-cookie': 'never-forward' } });
  const t = await open({ env: {}, fetcher: async (url, init) => { calls.push({ url: String(url), init }); return reply(); } });
  try {
    const local = tagRuntime(t), tags = createTagSearch(() => [0], fetch, local),
      src = `https://cdn.donmai.us/sample/ab/cd/sample-${hash}.png`, target = tags.imageUrl(src);
    assert.equal(target, `${local.baseUrl}media/sample/ab/cd/sample-${hash}.png`);
    assert.ok(!target.includes(local.token));
    const image = await fetch(target, { headers: { Cookie: 'private-cookie', Authorization: 'Bearer private-key' } });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('set-cookie'), null);
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), bytes);
    assert.equal(calls[0].url, src);
    assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ['Accept', 'User-Agent']);
    const file = await tags.postImage({ id: 1, image: { src, ext: 'png' } });
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
    for (const suffix of [`sample/ef/01/${hash}.png`, `sample/ab/cd/${hash}.svg`, 'https://evil.example/a.png', 'users.json']) {
      assert.equal((await fetch(local.baseUrl + 'media/' + suffix)).status, 404);
    }
    assert.equal((await fetch(target + '?url=https://evil.example')).status, 400);
    assert.equal((await fetch(target, { method: 'POST' })).status, 405);
    assert.equal((await fetch(target, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(target, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal(calls.length, 2);
    reply = () => new Response('<svg>private-upstream</svg>', { headers: { 'content-type': 'image/svg+xml' } });
    await assert.rejects(tags.postImage({ id: 1, image: { src, ext: 'png' } }), /返回格式异常/);
    reply = () => new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': 65 * 1024 * 1024 } });
    await assert.rejects(tags.postImage({ id: 1, image: { src, ext: 'png' } }), /图片数据过大/);
  } finally { await t.close(); }
});
test("local server: empty configuration stays static, no secret marker; rejects partial configuration and private files", async () => {
  assert.throws(
    () =>
      createLocalServer({ env: { KOMA_GATEWAY_URL: env.KOMA_GATEWAY_URL } }),
    /同时配置/,
  );
  assert.throws(
    () =>
      createLocalServer({
        env: { ...env, KOMA_GATEWAY_URL: "http://example.test" },
      }),
    /HTTPS/,
  );
  const t = await open({ env: {} });
  try {
    assert.equal(t.html.includes("koma-runtime"), false);
    for (const path of [".env", "%2eenv", "../server.mjs", "src/main.ts"])
      assert.equal((await fetch(t.url + path)).status, 404);
    assert.equal((await fetch(t.url + "api/v1/image/models")).status, 503);
    assert.equal(
      (await fetch(t.url, { method: "HEAD" })).headers.get("content-type"),
      "text/html; charset=utf-8",
    );
  } finally {
    await t.close();
  }
});
test("local server: fixed protocol paths, server-only authentication, original payload/bytes and subpath bootstrap", async () => {
  const requests = [],
    binary = new Uint8Array([137, 80, 78, 71, 13, 10]);
  const t = await open({
    env: { ...env, KOMA_BASE_PATH: "/app/" },
    fetcher: async (url, init) => {
      requests.push({ url: new URL(url), ...init });
      return new Response(binary, {
        headers: {
          "Content-Type": "image/png",
          "Set-Cookie": "private",
          "X-Upstream": "private",
        },
      });
    },
  });
  try {
    assert.equal(t.html.includes(env.KOMA_GATEWAY_KEY), false);
    assert.equal(t.html.includes(env.KOMA_GATEWAY_URL), false);
    for (const [kind, path] of Object.entries(
      standardProfile.transport.paths,
    )) {
      const get = ["catalog", "quota", "stats"].includes(kind);
      const suffix = (kind === "native" ? "" : "/v1") + path;
      const payload = '{"prompt":"  keep exact  ","max_cost":2,"seed":0}';
      const response = await fetch(
        t.url + "api" + suffix + (kind === "stats" ? "?days=1" : ""),
        {
          method: get ? "GET" : "POST",
          headers: {
            ...t.headers,
            Authorization: "Bearer must-not-forward",
            Cookie: "must-not-forward",
          },
          body: get ? undefined : payload,
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), binary);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("x-upstream"), null);
      const request = requests.at(-1);
      assert.equal(request.url.pathname, "/prefix" + suffix);
      assert.equal(request.headers.Cookie, undefined);
      assert.equal(request.headers["X-Koma-Local-Token"], undefined);
      assert.equal(request.redirect, "error");
      if (kind === "stats") {
        assert.equal(
          request.url.searchParams.get("api_key"),
          env.KOMA_GATEWAY_KEY,
        );
        assert.equal(request.url.searchParams.get("days"), "1");
      } else
        assert.equal(
          request.headers.Authorization,
          `Bearer ${env.KOMA_GATEWAY_KEY}`,
        );
      if (!get) assert.equal(request.body.toString(), payload);
      if (kind === "native")
        assert.equal(request.headers["X-Media-Provider"], "novelai");
    }
    assert.equal(requests.length, 8);
  } finally {
    await t.close();
  }
});
test("local server: rejects foreign origins, rebinding, wrong tokens, arbitrary targets and invalid bodies before forwarding", async () => {
  let called = 0;
  const t = await open({
    fetcher: async () => {
      called++;
      return Response.json({});
    },
  });
  try {
    for (const headers of [
      {},
      { ...t.headers, Origin: "https://example.test" },
      { ...t.headers, "Sec-Fetch-Site": "cross-site" },
      { ...t.headers, "X-Koma-Local-Token": "wrong" },
    ])
      assert.equal(
        (await fetch(t.url + "api/v1/image/models", { headers })).status,
        403,
      );
    // Fetch controls Host itself; use a raw HTTP request to exercise rebinding protection.
    const foreignHost = await new Promise((resolve, reject) => {
      const request = http.get(
        t.url + "api/v1/image/models",
        {
          headers: { ...t.headers, Host: "example.test" },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        },
      );
      request.on("error", reject);
    });
    assert.equal(foreignHost, 403);
    for (const [path, status] of [
      ["api/v1/unknown", 404],
      ["api/v1/image/models?target=https://example.test", 400],
      ["api/v1/token_stats_data?api_key=override", 400],
      ["api/https://example.test", 404],
    ])
      assert.equal(
        (await fetch(t.url + path, { headers: t.headers })).status,
        status,
      );
    assert.equal(
      (
        await fetch(t.url + "api/v1/studio/image/generate", {
          headers: t.headers,
        })
      ).status,
      405,
    );
    for (const [body, headers, status] of [
      ["bad", t.headers, 400],
      ["[]", t.headers, 400],
      ["{}", { "X-Koma-Local-Token": t.headers["X-Koma-Local-Token"] }, 415],
    ])
      assert.equal(
        (
          await fetch(t.url + "api/v1/studio/image/generate", {
            method: "POST",
            headers,
            body,
          })
        ).status,
        status,
      );
    const tooLarge = await new Promise((resolve, reject) => {
      const request = http.request(
        t.url + "api/v1/studio/image/generate",
        {
          method: "POST",
          headers: { ...t.headers, "Content-Length": 64 * 1024 * 1024 + 1 },
        },
        (response) => {
          response.resume();
          response.on("end", () => {
            resolve(response.statusCode);
            request.destroy();
          });
        },
      );
      request.on("error", reject);
      request.end();
    });
    assert.equal(tooLarge, 413);
    assert.equal(called, 0);
  } finally {
    await t.close();
  }
});
test("local server: hides upstream details in errors, preserves status and never retries failed requests", async () => {
  let status = 429,
    called = 0;
  const t = await open({
    fetcher: async () => {
      called++;
      return Response.json(
        {
          error: {
            message: `failure ${env.KOMA_GATEWAY_URL} ${env.KOMA_GATEWAY_KEY}`,
          },
        },
        { status },
      );
    },
  });
  try {
    for (status of [429, 200]) {
      const response = await fetch(t.url + "api/v1/image/models", {
        headers: t.headers,
      });
      assert.equal(response.status, status);
      const text = await response.text();
      assert.equal(text.includes(env.KOMA_GATEWAY_KEY), false);
      assert.equal(text.includes("gateway.example.test"), false);
      assert.match(text, /failure/);
    }
    assert.equal(called, 2);
  } finally {
    await t.close();
  }
});
test("local server: client cancellation aborts upstream and timeouts fail once", async () => {
  let started, aborted;
  const began = new Promise((r) => (started = r)),
    ended = new Promise((r) => (aborted = r));
  const t = await open({
    fetcher: async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        started();
        signal.addEventListener(
          "abort",
          () => {
            aborted();
            reject(signal.reason);
          },
          { once: true },
        );
      }),
  });
  try {
    const controller = new AbortController();
    const waiting = fetch(t.url + "api/v1/image/models", {
      headers: t.headers,
      signal: controller.signal,
    }).catch((e) => e);
    await began;
    controller.abort();
    await waiting;
    await ended;
  } finally {
    await t.close();
  }
  const timeout = await open({
    timeout: 20,
    fetcher: async (_url, { signal }) =>
      new Promise((_r, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      ),
  });
  try {
    assert.equal(
      (
        await fetch(timeout.url + "api/v1/image/models", {
          headers: timeout.headers,
        })
      ).status,
      504,
    );
  } finally {
    await timeout.close();
  }
});
test("local runtime: isolated model preferences and backup, readonly connection, transport never requests the upstream key", async () => {
  const stored = new Map([
    [names.routing, JSON.stringify({ version: 1, connections: {}, links: {} })],
  ]);
  const storage = {
    getItem: (k) => stored.get(k) ?? null,
    setItem: (k, v) => stored.set(k, v),
  };
  const browserConfig = storage.getItem(names.routing);
  const connections = createConnections(storage, async (work) => work(), {
    baseUrl: "http://127.0.0.1:3218/api",
    token: "a".repeat(64),
  });
  connections.reload();
  const context = connections.context("local-gateway");
  assert.throws(() => context.key(), /不向浏览器/);
  assert.equal(connections.hasCredential("local-server"), true);
  const requests = [];
  const transport = createTransport(
    context,
    standardProfile,
    async (url, options) => {
      requests.push({ url, options });
      return Response.json({});
    },
  );
  await transport.request(standardProfile.transport.paths.stats, {
    stats: true,
  });
  assert.equal(requests[0].url.search, "?days=1");
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.equal(
    requests[0].options.headers["X-Koma-Local-Token"],
    "a".repeat(64),
  );
  const changed = structuredClone(connections.configuration);
  changed.connections["local-gateway"].baseUrl = "https://example.test";
  await assert.rejects(connections.save(changed), /服务端/);
  const next = structuredClone(connections.configuration);
  next.links["local-gateway"] = {
    "gpt-image-2": { id: "custom-image", manual: true, on: true },
  };
  await connections.save(next);
  assert.equal(storage.getItem(names.routing), browserConfig);
  assert.throws(context.assertCurrent, /改变/);
  const backup = collectBackupPreferences(storage);
  assert.deepEqual(JSON.parse(backup.localModels), next.links["local-gateway"]);
  assert.equal(JSON.stringify(backup).includes("127.0.0.1"), false);
  assert.equal(JSON.stringify(backup).includes("a".repeat(64)), false);
  assert.throws(() =>
    readBackupPreferences({ localModels: '{"gpt-image-2":{"id":""}}' }),
  );
  connections.dispose();
});

const askEnv={KOMA_ASK_OPENAI_URL:'https://reasoning.example.test/compat/v1',KOMA_ASK_OPENAI_KEY:'synthetic-reasoning-only-secret',KOMA_ASK_ANTHROPIC_URL:'https://messages.example.test/prefix',KOMA_ASK_ANTHROPIC_KEY:'synthetic-messages-only-secret'};
test('ASK local: independent optional pairs, fixed routes for both reasoning profiles, runtime has no secrets and no image connection required',async()=>{
 for(const prefix of ['KOMA_ASK_OPENAI','KOMA_ASK_ANTHROPIC'])assert.throws(()=>createLocalServer({env:{[`${prefix}_KEY`]:'test'}}),/同时配置/);
 const calls=[];
 const t=await open({env:{...askEnv,KOMA_BASE_PATH:'/app/'},fetcher:async(url,init)=>{calls.push({url:new URL(url),...init});return new Response('data: {"text":"模拟输出"}\n\n',{headers:{'Content-Type':'text/event-stream','Set-Cookie':'never'}});}});
 try{
  const marker=JSON.parse(t.html.match(/id="koma-runtime"[^>]*>(.*?)<\/script>/)[1]);assert.equal(marker.image,false);assert.deepEqual(marker.reasoning,['openai-chat-v1','anthropic-messages-v1']);
  for(const value of Object.values(askEnv))assert.equal(t.html.includes(value),false);
  const payload='{"model":"arbitrary-id","messages":[],"stream":true}';
  for(const path of ['ask/openai/chat/completions','ask/anthropic/v1/messages']){
   const response=await fetch(t.url+'api/'+path,{method:'POST',headers:{...t.headers,Authorization:'Bearer client-key',Cookie:'client-cookie'},body:payload});
   assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);assert.equal(await response.text(),'data: {"text":"模拟输出"}\n\n');
  }
  assert.equal(calls[0].url.href,'https://reasoning.example.test/compat/v1/chat/completions');assert.equal(calls[0].headers.Authorization,`Bearer ${askEnv.KOMA_ASK_OPENAI_KEY}`);
  assert.equal(calls[1].url.pathname,'/prefix/v1/messages');assert.equal(calls[1].headers['x-api-key'],askEnv.KOMA_ASK_ANTHROPIC_KEY);assert.equal(calls[1].headers['anthropic-version'],'2023-06-01');assert.equal(calls[1].headers['anthropic-dangerous-direct-browser-access'],undefined);
  for(const c of calls){assert.equal(c.body.toString(),payload);assert.equal(c.headers.Cookie,undefined);assert.equal(c.headers['X-Koma-Local-Token'],undefined);}
  assert.equal((await fetch(t.url+'api/ask/openai/chat/completions?target=elsewhere',{method:'POST',headers:t.headers,body:'{}'})).status,400);
  for(const [path,status] of [['ask/openai/images/generations',404],['v1/image/models',503]])assert.equal((await fetch(t.url+'api/'+path,{headers:t.headers})).status,status);
 }finally{await t.close();}
});
test('ASK local: SSE streams before completion, redacts secret echoes across byte boundaries and preserves Unicode',async()=>{
 let source;const encoder=new TextEncoder();
 const t=await open({env:askEnv,fetcher:async()=>new Response(new ReadableStream({start(c){source=c;c.enqueue(encoder.encode('data: '+ 'x'.repeat(200)+'\n\n'));}}),{headers:{'Content-Type':'text/event-stream'}})});
 try{
  const response=await fetch(t.url+'api/ask/openai/chat/completions',{method:'POST',headers:t.headers,body:'{}'}),reader=response.body.getReader();
  const first=await reader.read();assert.ok(first.value.length>50,'response delivered while upstream is open');
  const rest='data: '+JSON.stringify({error:`${askEnv.KOMA_ASK_OPENAI_KEY} ${askEnv.KOMA_ASK_ANTHROPIC_URL} 中文 🌙🙂`})+'\n\n';
  for(const byte of encoder.encode(rest))source.enqueue(Uint8Array.of(byte));source.close();
  const chunks=[first.value];while(true){const next=await reader.read();if(next.done)break;chunks.push(next.value);}
  const output=Buffer.concat(chunks).toString();assert.match(output,/中文 🌙🙂/);assert.doesNotMatch(output,/synthetic-reasoning-only-secret|messages.example.test/);assert.match(output,/已隐藏/);
 }finally{await t.close();}
});
test('ASK local: closing a streamed response cancels upstream, errors redact both credentials and catalogs allow only the fixed query',{timeout:10000},async()=>{
 let cancelled,mode='stream';const ended=new Promise(r=>cancelled=r);const calls=[];
 const t=await open({env:askEnv,fetcher:async(url,{signal})=>{
  calls.push(new URL(url));
  if(mode==='error')return Response.json({error:{message:Object.values(askEnv).join(' ')}},{status:429});
  if(mode==='catalog')return Response.json({data:[{id:'m'}]});
  return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+ 'x'.repeat(200)+'\n\n'));},cancel(){cancelled();}}),{headers:{'Content-Type':'text/event-stream'}});
 }});
 try{
  const abort=new AbortController();const response=await fetch(t.url+'api/ask/openai/chat/completions',{method:'POST',headers:t.headers,body:'{}',signal:abort.signal});await response.body.getReader().read();abort.abort();await ended;
  mode='error';const error=await fetch(t.url+'api/ask/anthropic/v1/messages',{method:'POST',headers:t.headers,body:'{}'});assert.equal(error.status,429);const detail=await error.text();for(const v of Object.values(askEnv))assert.equal(detail.includes(v),false);
  mode='catalog';assert.equal((await fetch(t.url+'api/ask/anthropic/v1/models?limit=1000',{headers:t.headers})).status,200);assert.equal(calls.at(-1).search,'?limit=1000');
  assert.equal((await fetch(t.url+'api/ask/anthropic/v1/models?limit=1001',{headers:t.headers})).status,400);
 }finally{await t.close();}
});
test('ASK local connections: two managed reasoning profiles remain readonly, isolated and never return credentials',async()=>{
 const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
 const c=createConnections(storage,async f=>f(),{baseUrl:'http://127.0.0.1:3218/api',token:'b'.repeat(64),image:false,reasoning:['openai-chat-v1','anthropic-messages-v1']});c.reload();
 const routing=c.configuration;assert.equal(Object.keys(routing.connections).length,2);assert.equal(c.hasCredential('local-ask-openai-server'),true);
 assert.throws(()=>c.context('local-ask-openai').key(),/不向浏览器/);await c.save(routing);assert.equal(memory.has(names.routing),false);
 const changed=structuredClone(routing);delete changed.connections['local-ask-openai'];await assert.rejects(c.save(changed),/服务端/);c.dispose();
});
