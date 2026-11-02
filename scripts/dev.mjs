import { createServer } from "vite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDanbooruProxy, localRequest } from "../server.mjs";

/** Dev uses only the public tag transport; model URLs and keys remain browser-configured. */
export async function createDevServer(config = {}, transport = {}) {
  const tags = createDanbooruProxy(transport);
  return createServer({
    ...config,
    plugins: [...(config.plugins ?? []), {
      name: "koma-dev-tags",
      apply: "serve",
      configureServer(server) {
        const mount = server.config.base.startsWith("/") ? server.config.base : "/";
        const prefix = `${mount}api/danbooru/`;
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith(prefix)) return next();
          const address = server.httpServer?.address();
          const url = localRequest(req, res, typeof address === "object" && address?.port, mount);
          if (!url) return;
          try { await tags.handle(req, res, url, url.pathname.slice(prefix.length)); }
          catch (error) { next(error); }
        });
      },
      transformIndexHtml: {
        order: "post",
        handler(html, context) {
          const pathname = new URL(context.originalUrl ?? context.path, "http://localhost").pathname;
          return pathname.endsWith("/__ui") ? html : html.replace("</head>", `${tags.runtime}</head>`);
        },
      },
    }],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await createDevServer();
  await server.listen();
  server.printUrls();
  server.bindCLIShortcuts({ print: true });
}
