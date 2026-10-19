import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalServer } from "../server.mjs";
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
