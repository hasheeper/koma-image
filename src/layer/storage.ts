import type { ApplicationServices } from '../services/application.ts';
import { idbRequest, transactionDone } from '../storage/databases.ts';
import { names } from '../storage/names.ts';
import { migrateProject, type LayerProject } from './project.ts';

export interface LayerSummary {
  id: string;
  title: string;
  revision: number;
  updated: number;
}

interface PixelCheckpoint {
  format: 'koma-layer.checkpoint.v1';
  project: unknown;
  pixelIds: string[];
}

// Layer state consists of plain metadata, immutable pixel planes and preview Blobs.
// Only traverse metadata. In particular, never enumerate individual pixels.
function mapFields(value: unknown, replace: (field: unknown) => unknown): unknown {
  const mapped = replace(value);
  if (mapped !== value) return mapped;
  if (Array.isArray(value)) return value.map(item => mapFields(item, replace));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, mapFields(field, replace)]));
  }
  return value;
}

export function layerStorage(services: ApplicationServices) {
  const db = names.databases.layer;
  const planeIds = new WeakMap<Uint8Array, string>();
  async function read(id: string): Promise<LayerProject | undefined> {
    const records = services.databases.transaction(db, 'projects').objectStore('projects');
    const raw = await idbRequest<PixelCheckpoint | LayerProject | undefined>(records.get(id));
    if (!raw) return;
    if (raw.format !== 'koma-layer.checkpoint.v1') return migrateProject(raw);
    // Queue all reads in this transaction, so a concurrent edit cannot remove a plane mid-read.
    const planes = new Map(await Promise.all(raw.pixelIds.map(async key => {
      const blob = await idbRequest<Blob | undefined>(records.get([id, key]));
      if (!(blob instanceof Blob)) throw new Error('分件存档缺少像素数据');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      planeIds.set(bytes, key);
      return [key, bytes] as const;
    })));
    return migrateProject(mapFields(raw.project, field => {
      if (field && typeof field === 'object' && '$layerPlane' in field && typeof field.$layerPlane === 'string') {
        const bytes = planes.get(field.$layerPlane);
        if (!bytes) throw new Error('分件存档的像素引用无效');
        return bytes;
      }
      return field;
    }));
  }
  async function list(): Promise<LayerSummary[]> {
    const items: LayerSummary[] = await idbRequest(
      services.databases.transaction(db, 'index').objectStore('index').getAll(),
    );
    return items.sort((a, b) => b.updated - a.updated);
  }
  function save(next: LayerProject): Promise<LayerProject> {
    return services.data.write(async () => {
      const tx = services.databases.transaction(db, ['projects', 'index'], 'readwrite'),
        done = transactionDone(tx);
      try {
        const index = tx.objectStore('index'), records = tx.objectStore('projects');
        const current: LayerSummary | undefined = await idbRequest(index.get(next.id));
        if ((current?.revision ?? 0) !== next.revision) {
          throw new Error('另一页面已更新此项目，可先导出本页图层，再打开最新存档');
        }
        const saved: LayerProject = { ...next, revision: next.revision + 1 };
        const planes = new Map<string, Uint8Array>();
        const metadata = mapFields(saved, field => {
          if (!(field instanceof Uint8Array)) return field;
          const key = planeIds.get(field) ?? crypto.randomUUID();
          planeIds.set(field, key);
          planes.set(key, field);
          return { $layerPlane: key };
        });
        // Project headers use string keys. Project-scoped compound keys hold the binary planes.
        const range = IDBKeyRange.bound([next.id], [next.id, []]);
        const previous = await idbRequest<IDBValidKey[]>(records.getAllKeys(range));
        const existing = new Set<string>();
        for (const key of previous) {
          if (Array.isArray(key) && typeof key[1] === 'string') {
            if (planes.has(key[1])) existing.add(key[1]);
            else records.delete(key);
          }
        }
        for (const [key, bytes] of planes) {
          if (!existing.has(key)) {
            const data = bytes.buffer instanceof ArrayBuffer
              ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
            records.put(new Blob([data]), [next.id, key]);
          }
        }
        records.put({ format: 'koma-layer.checkpoint.v1', project: metadata, pixelIds: [...planes.keys()] } satisfies PixelCheckpoint, next.id);
        index.put(
          { id: next.id, title: next.title, revision: saved.revision, updated: Date.now() },
          next.id,
        );
        await done;
        return saved;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* Already aborted */
        }
        await done.catch(() => {});
        throw error;
      }
    });
  }
  return { read, list, save };
}
