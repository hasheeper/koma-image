import type { RefEntry, RefIndex, RefSnapshot } from '../ask/reference-source.ts';
import type { ProjectData, ProjectCharacter } from './project/model.ts';
import { REF_LIMITS, refPath, refKind, projectFile, missing } from './project/paths.ts';
export { REF_LIMITS, refPath, refKind } from './project/paths.ts';
export { scanProject as scanRefs } from './project/scan.ts';

export interface RefCatalog { readonly files: readonly RefEntry[]; readonly limited: boolean; readonly project?: ProjectData }
const shortCharacter = ({ tagContent: _tags, ...c }: ProjectCharacter) => ({ ...c, name: c.name.slice(0, 120), aliases: c.aliases.slice(0, 8), brief: c.brief.slice(0, 160),
  ...(c.brief.length > 160 ? { brief_truncated: true } : {}), refs: c.refs.slice(0, 8).map(r => ({ ...r, description: r.description?.slice(0, 160) })), refs_omitted: Math.max(0, c.refs.length - 8) });
export function refIndex(catalog: RefCatalog): RefIndex {
  const p = catalog.project;
  const grouped = new Set([...(p?.lore ?? []), ...(p?.references ?? [])].map(f => f.path));
  const files = p ? catalog.files.filter(f => !grouped.has(f.path) && !f.path.startsWith(p.paths.characters + '/') && f.path !== 'project.json' && f.path !== `${p.paths.references}/references.json`) : catalog.files;
  const page = <T>(items: readonly T[]) => items.slice(0, REF_LIMITS.listed);
  const group = (items: readonly unknown[], path: string) => ({ total: items.length, omitted: Math.max(0, items.length - REF_LIMITS.listed), path });
  return { available: true, files: page(files), total: catalog.files.length, omitted: Math.max(0, files.length - REF_LIMITS.listed), limited: catalog.limited,
    ...(p ? { project: { title: p.title.slice(0, 120), description: p.description.slice(0, 320) },
      characters: page(p.characters).map(shortCharacter), lore: page(p.lore), references: page(p.references).map(r => ({ ...r, description: r.description?.slice(0, 160) })),
      groups: { characters: group(p.characters, p.paths.characters + '/'), lore: group(p.lore, p.paths.lore + '/'), references: group(p.references, p.paths.references + '/'), all_files: group(catalog.files, './'), assets: group(catalog.files.filter(f => f.path.startsWith('assets/')), 'assets/'), slates: group(catalog.files.filter(f => f.path.startsWith('slates/')), 'slates/') } } : {}) };
}
/** Captures one project and catalog. Pending disk reads never follow a later mount. */
export function referenceSnapshot(root: FileSystemDirectoryHandle, catalog: RefCatalog, lifetime: AbortSignal, projectId = ''): RefSnapshot {
  const paths = new Set(catalog.files.map(f => f.path));
  function resolve(path: string) {
    refKind(path);
    if (paths.has(path)) return path;
    const matches = [...paths].filter(p => p.split('/').at(-1) === path);
    if (matches.length > 1) throw new Error(`资料同名，请使用完整相对路径：${matches.join('、')}`);
    if (matches.length === 1) return matches[0]!;
    throw new Error('资料不在本轮清单中，请刷新清单后重新提问');
  }
  return { index: refIndex(catalog), resolve, kind: refKind,
    list(path, offset) {
      lifetime.throwIfAborted();
      const folder = path.replace(/\/$/, ''); if (folder !== '.') refPath(folder);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset 需为非负安全整数');
      const project = catalog.project;
      const items: readonly unknown[] = folder === '.' ? catalog.files : project && folder === project.paths.characters ? project.characters.map(shortCharacter)
        : project && folder === project.paths.lore ? project.lore
        : project && folder === project.paths.references ? project.references
        : catalog.files.filter(f => f.path.startsWith(folder + '/'));
      const known = items.length || ['.', 'refs', 'slates', 'assets', ...Object.values(project?.paths ?? {})].includes(folder);
      if (!known) throw new Error('目录不在本轮清单中');
      if (offset > items.length) throw new Error('offset 超过目录条目数');
      const end = Math.min(items.length, offset + REF_LIMITS.listed);
      return { type: 'directory', path: folder + '/', items: items.slice(offset, end), total: items.length, offset, next_offset: end < items.length ? end : null, limited: catalog.limited };
    },
    async read(request, signal, maxBytes) {
      const path = resolve(request), abort = AbortSignal.any([signal, lifetime]); abort.throwIfAborted();
      try {
        const file = await projectFile(root, path); abort.throwIfAborted();
        if (file.size > maxBytes) throw new Error('资料超过附件大小或本页容量限制');
        const bytes = await file.arrayBuffer(); abort.throwIfAborted();
        const hash = await crypto.subtle.digest('SHA-256', bytes); abort.throwIfAborted();
        return { file: new File([bytes], path, { type: file.type, lastModified: file.lastModified }),
          origin: { path, modified: file.lastModified, version: [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join(''), ...(projectId ? { projectId } : {}) } };
      } catch (e) { if (missing(e)) throw new Error(`资料已移除：${path}`); throw e; }
    },
  };
}
