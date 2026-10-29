import { createServer as createViteServer, mergeConfig } from 'vite';
import { basename, resolve } from 'node:path';

/** Each Node test file owns its optimizer cache; the interactive dev server stays separate. */
export function createServer(config = {}) {
  return createViteServer(mergeConfig(config, {
    cacheDir: resolve('.local/test-cache', basename(process.argv[1], '.mjs')),
    server: { host: '127.0.0.1', port: 0, open: false, hmr: false },
    optimizeDeps: {
      noDiscovery: true,
      include: ['vue', 'marked', 'entities', '@huggingface/tokenizers'],
    },
  }));
}
