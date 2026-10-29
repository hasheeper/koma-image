import { createServer as createViteServer, mergeConfig } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Isolated per server, removed on close; no accumulating cache under .local. */
export async function createServer(config = {}) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'koma-test-'));
  let server;
  try {
    server = await createViteServer(mergeConfig(config, {
      cacheDir,
      server: { host: '127.0.0.1', port: 0, open: false, hmr: false },
      optimizeDeps: {
        noDiscovery: true,
        include: ['vue', 'marked', 'entities', '@huggingface/tokenizers'],
      },
    }));
  } catch (error) {
    await rm(cacheDir, { recursive: true, force: true });
    throw error;
  }
  const close = server.close.bind(server);
  server.close = async () => {
    try { await close(); }
    finally { await rm(cacheDir, { recursive: true, force: true }); }
  };
  return server;
}
