import http from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { standardProfile } from "./src/gateway/profile.ts";
import { normalizeBaseUrl } from "./src/config/connections.ts";
import { endpoint } from "./src/gateway/transport.ts";

const root = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 64 * 1024 * 1024;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
const paths = standardProfile.transport.paths;
const routes = new Map(
  Object.entries(paths).map(([kind, path]) => [
    (kind === "native" ? "" : standardProfile.transport.apiPrefix) + path,
    {
      kind,
      path,
      method: ["catalog", "quota", "stats"].includes(kind) ? "GET" : "POST",
    },
  ]),
);
function basePath(value = "/") {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(value))
    throw new Error("KOMA_BASE_PATH 必须是以 / 开头和结尾的路径");
  return value;
}
function configuration(env) {
  const url = env.KOMA_GATEWAY_URL?.trim(),
    key = env.KOMA_GATEWAY_KEY?.trim();
  if (Boolean(url) !== Boolean(key))
    throw new Error("请同时配置 KOMA_GATEWAY_URL 和 KOMA_GATEWAY_KEY");
  if (key && /[\r\n\x00-\x1f\x7f]/.test(key))
    throw new Error("KOMA_GATEWAY_KEY 格式无效");
  return url && key ? { url: normalizeBaseUrl(url), key } : undefined;
}
function send(res, status, value) {
  const bytes = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(bytes),
  });
  res.end(bytes);
}
async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || ""))
    throw Object.assign(new Error("仅支持 JSON 请求"), { status: 415 });
  if (Number(req.headers["content-length"]) > MAX_BODY)
    throw Object.assign(new Error("请求图片总量过大"), { status: 413 });
  const chunks = [];
  let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > MAX_BODY)
      throw Object.assign(new Error("请求图片总量过大"), { status: 413 });
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
  } catch {
    throw Object.assign(new Error("JSON 请求格式无效"), { status: 400 });
  }
  return bytes;
}

/** A loopback-only static server and fixed-profile proxy. No upstream discovery or retries. */
export function createLocalServer({
  env = process.env,
  directory = join(root, "dist"),
  fetcher = fetch,
  timeout = 240_000,
} = {}) {
  const gateway = configuration(env),
    mount = basePath(env.KOMA_BASE_PATH || "/");
  const token = randomBytes(32).toString("hex"),
    tokenBytes = Buffer.from(token);
  const runtime = `<script id="koma-runtime" type="application/json">${JSON.stringify({ version: 1, mode: "local", token })}</script>`;
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    const address = server.address(),
      port = typeof address === "object" && address?.port;
    const hosts = new Set([
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `[::1]:${port}`,
    ]);
    if (!hosts.has(req.headers.host))
      return send(res, 403, { error: "只允许本机访问" });
    const origin = `http://${req.headers.host}`;
    if (
      (req.headers.origin && req.headers.origin !== origin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return send(res, 403, { error: "不允许跨站访问" });
    let url;
    try {
      url = new URL(req.url, origin);
    } catch {
      return send(res, 400, { error: "请求地址无效" });
    }
    if (url.origin !== origin || !url.pathname.startsWith(mount))
      return send(res, 404, { error: "未找到" });
    const path = url.pathname.slice(mount.length);
    try {
      if (path.startsWith("api/")) {
        if (!gateway) return send(res, 503, { error: "本地网关尚未配置" });
        const supplied = Buffer.from(
          typeof req.headers["x-koma-local-token"] === "string"
            ? req.headers["x-koma-local-token"]
            : "",
        );
        if (
          supplied.length !== tokenBytes.length ||
          !timingSafeEqual(supplied, tokenBytes)
        )
          return send(res, 403, { error: "本地会话已失效，请刷新页面" });
        const route = routes.get(path.slice(3));
        if (!route) return send(res, 404, { error: "协议路径无效" });
        if (req.method !== route.method)
          return send(res, 405, { error: "请求方法无效" });
        if (url.search && !(route.kind === "stats" && url.search === "?days=1"))
          return send(res, 400, { error: "查询参数无效" });
        const controller = new AbortController();
        const abort = () =>
          controller.abort(new DOMException("客户端已断开", "AbortError"));
        req.once("aborted", abort);
        res.once("close", abort);
        try {
          const target = endpoint(gateway.url, route.path, standardProfile);
          const headers = {
            Accept: "application/json, image/png, image/jpeg, image/webp",
          };
          if (route.kind === "stats") {
            target.searchParams.set("days", "1");
            target.searchParams.set(
              standardProfile.auth.statsQueryKey,
              gateway.key,
            );
          } else headers.Authorization = `Bearer ${gateway.key}`;
          if (route.kind === "native") headers["X-Media-Provider"] = "novelai";
          const bytes = route.method === "POST" ? await body(req) : undefined;
          if (bytes) headers["Content-Type"] = "application/json";
          const response = await fetcher(target, {
            method: route.method,
            headers,
            body: bytes,
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(timeout),
            ]),
            redirect: "error",
          });
          const type =
            response.headers.get("content-type") || "application/octet-stream";
          const json = /^application\/json(?:\s*;|$)/i.test(type);
          const result = json
            ? Buffer.from(await response.arrayBuffer())
            : undefined;
          let data;
          if (result) {
            try {
              data = JSON.parse(result.toString("utf8"));
            } catch {
              return send(res, 502, { error: "网关返回 JSON 格式无效" });
            }
          }
          if (!response.ok || data?.error) {
            if (!json) await response.body?.cancel();
            const detail =
              data?.error?.message ||
              data?.detail ||
              data?.error ||
              data?.message;
            let message =
              typeof detail === "string"
                ? detail
                : `网关请求失败 (${response.status})`;
            // Error responses may echo authentication or addresses; never expose those values.
            for (const secret of [
              gateway.key,
              encodeURIComponent(gateway.key),
              gateway.url,
              new URL(gateway.url).origin,
              new URL(gateway.url).hostname,
            ])
              message = message.split(secret).join("[已隐藏]");
            return send(res, response.status, {
              error: message.slice(0, 2000),
            });
          }
          if (
            !/^(application\/(?:json|zip|octet-stream)|image\/(?:png|jpeg|webp))(?:\s*;|$)/i.test(
              type,
            )
          ) {
            await response.body?.cancel();
            return send(res, 502, { error: "网关返回格式无效" });
          }
          res.writeHead(response.status, { "Content-Type": type });
          if (result) res.end(result);
          else if (response.body)
            await pipeline(Readable.fromWeb(response.body), res);
          else res.end();
        } finally {
          req.off("aborted", abort);
          res.off("close", abort);
        }
        return;
      }
      if (!["GET", "HEAD"].includes(req.method))
        return send(res, 405, { error: "请求方法无效" });
      const relative = decodeURIComponent(path || "index.html");
      if (
        relative.split("/").some((part) => part.startsWith(".")) ||
        relative.includes("\\") ||
        relative.includes("\0")
      )
        return send(res, 404, { error: "未找到" });
      const base = await realpath(directory),
        file = await realpath(resolve(base, relative)).catch(() => "");
      if (!file.startsWith(base + sep) || !(await stat(file)).isFile())
        return send(res, 404, { error: "未找到" });
      let bytes = await readFile(file);
      if (relative === "index.html" && gateway)
        bytes = Buffer.from(
          bytes.toString("utf8").replace("</head>", `${runtime}</head>`),
        );
      res.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Content-Length": bytes.length,
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      if (error.status === 413) res.setHeader("Connection", "close");
      const status =
        error.status ||
        (error.name === "TimeoutError"
          ? 504
          : error.code === "ENOENT"
            ? 503
            : 502);
      send(res, status, {
        error: error.status
          ? error.message
          : status === 504
            ? "网关请求超时"
            : status === 503
              ? "请先构建网页"
              : "本地代理请求失败，请检查服务端配置",
      });
    }
  });
  server.requestTimeout = 300_000;
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const port = Number(process.env.KOMA_PORT || 3218);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("KOMA_PORT 无效");
    const server = createLocalServer();
    server.on("error", (error) => {
      console.error(
        error.code === "EADDRINUSE" ? "本地端口已被占用" : "本地服务启动失败",
      );
      process.exitCode = 1;
    });
    server.listen(port, "127.0.0.1", () =>
      console.log(
        `Koma Image: http://127.0.0.1:${port}${basePath(process.env.KOMA_BASE_PATH || "/")}`,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
