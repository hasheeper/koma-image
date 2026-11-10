import type { RefEntry } from '../../ask/reference-source.ts';
import type { RefCatalog } from '../refs.ts';
import { REF_LIMITS, refPath, refKind, projectFile, missing, permissionError } from './paths.ts';
import { parseProjectTags, projectObject } from './model.ts';
import type { ProjectCharacter, ProjectData, ProjectReference } from './model.ts';

type Directory = FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle> };
export type MetadataCache = Map<string, { stamp: string; text: string }>;
const title = (path: string) => path.split('/').at(-1)!.replace(/\.[^.]+$/, '');
const note = (e: unknown) => e instanceof Error ? e.message : String(e);
/** Only small manifests and briefs are read during discovery. Original assets stay on disk. */
export async function scanProject(root: FileSystemDirectoryHandle, signal: AbortSignal, cache: MetadataCache = new Map()): Promise<RefCatalog> {
  signal.throwIfAborted();
  const files = new Map<string, RefEntry>(), dirs = new Set<string>(), issues: string[] = [];
  let visited = 0, limited = false;
  function fault(path: string, e: unknown, target = issues) {
    signal.throwIfAborted(); if (permissionError(e)) throw e;
    if (!missing(e)) target.push(`${path}：${note(e)}`);
  }
  async function body(path: string, target: string[], optional = false) {
    try {
      const file = await projectFile(root, path); signal.throwIfAborted();
      if (file.size > REF_LIMITS.metadataBytes) throw new Error('元数据超过 256 KiB，请拆分正文文件');
      const stamp = `${file.lastModified}:${file.size}`, old = cache.get(path);
      const text = old?.stamp === stamp ? old.text : await file.text(); signal.throwIfAborted();
      cache.set(path, { stamp, text }); return text;
    } catch (e) {
      if (!optional && missing(e)) target.push(`${path}：文件不存在`);
      fault(path, e, target); return null;
    }
  }
  async function json(path: string, target: string[]) {
    const raw = await body(path, target, true); if (raw === null) return {};
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('需为 JSON 对象');
      return projectObject(value);
    } catch (e) { target.push(`${path}：${note(e)}`); return {}; }
  }
  const manifest = await json('project.json', issues);
  const paths = { characters: 'characters', lore: 'lore', references: 'references' };
  for (const key of Object.keys(paths) as (keyof typeof paths)[]) {
    const value = projectObject(manifest.paths)[key]; if (value === undefined) continue;
    try {
      if (typeof value !== 'string') throw new Error('路径需为文本');
      const parts = refPath(value);
      if (['live', 'slates', 'assets', 'refs'].includes(parts[0]!) || parts.some(p => /\.(?:json|md)$/i.test(p))) throw new Error('资料目录不能占用协同文件位置');
      paths[key] = value;
    } catch (e) { issues.push(`project.json paths.${key}：${note(e)}`); }
  }
  async function add(path: string, handle: FileSystemFileHandle) {
    if (files.has(path)) return;
    if (files.size >= REF_LIMITS.files) { limited = true; return; }
    try { refKind(path); } catch { return; }
    try { const f = await handle.getFile(); signal.throwIfAborted(); files.set(path, { path, bytes: f.size, modified: f.lastModified }); }
    catch (e) { fault(path, e); }
  }
  async function walk(directory: FileSystemDirectoryHandle, prefix: string, depth: number) {
    dirs.add(prefix.slice(0, -1));
    for await (const handle of (directory as Directory).values()) {
      signal.throwIfAborted();
      if (++visited > REF_LIMITS.entries || files.size >= REF_LIMITS.files) { limited = true; return; }
      const path = prefix + handle.name;
      try { refPath(path); } catch { continue; }
      if (handle.kind === 'file') await add(path, handle as FileSystemFileHandle);
      else if (depth >= REF_LIMITS.depth) limited = true;
      else try { await walk(handle as FileSystemDirectoryHandle, path + '/', depth + 1); } catch (e) { fault(path, e); }
    }
  }
  // Root discovery is shallow. Unrelated source trees are never traversed.
  for await (const h of (root as Directory).values()) {
    signal.throwIfAborted();
    if (++visited > REF_LIMITS.entries) { limited = true; break; }
    if (h.kind === 'file' && h.name !== 'PROTOCOL.md' && (/\.(?:txt|md|markdown)$/i.test(h.name) || h.name === 'project.json')) await add(h.name, h as FileSystemFileHandle);
  }
  for (const path of [...new Set([...Object.values(paths), 'refs', 'slates', 'assets'])]) {
    if (visited > REF_LIMITS.entries || files.size >= REF_LIMITS.files) { limited = true; break; }
    try {
      let dir = root;
      for (const part of refPath(path)) dir = await dir.getDirectoryHandle(part);
      await walk(dir, path + '/', 0);
    } catch (e) { fault(path, e); }
  }
  const list = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  const reference = (file: RefEntry, meta: Record<string, unknown> = {}): ProjectReference => ({ ...file,
    title: typeof meta.title === 'string' && meta.title.trim() ? meta.title : title(file.path),
    ...(typeof meta.category === 'string' ? { category: meta.category } : {}),
    ...(typeof meta.description === 'string' ? { description: meta.description } : {}) });
  function annotated(folder: string, raw: unknown, target: string[]) {
    const map = new Map<string, Record<string, unknown>>();
    if (raw !== undefined && !Array.isArray(raw)) target.push(`${folder}：参考图清单需为数组`);
    for (const item of Array.isArray(raw) ? raw : []) {
      const m = projectObject(item);
      try {
        if (typeof m.file !== 'string') throw new Error('参考图需要 file');
        refPath(m.file); const path = `${folder}/${m.file}`;
        if (!files.has(path) || refKind(path) !== 'image') throw new Error(`参考图不存在：${path}`);
        map.set(path, m);
      } catch (e) { target.push(`${folder}：${note(e)}`); }
    }
    return map;
  }
  const characters: ProjectCharacter[] = [];
  const charFolders = [...dirs].filter(p => p.startsWith(paths.characters + '/') && !p.slice(paths.characters.length + 1).includes('/')).sort();
  for (const folder of charFolders) {
    const errors: string[] = [], manifestPath = `${folder}/char.json`, m = files.has(manifestPath) ? await json(manifestPath, errors) : {};
    function pick(key: string, defaults: string[], kind: 'text' | 'image') {
      if (Object.hasOwn(m, key)) {
        try {
          if (typeof m[key] !== 'string') throw new Error(`${key} 需为相对文件路径`);
          refPath(m[key]); const path = `${folder}/${m[key]}`;
          if (!files.has(path) || refKind(path) !== kind) throw new Error(`${key} 文件缺失或类型不符：${path}`);
          return path;
        } catch (e) { errors.push(note(e)); return null; }
      }
      return defaults.map(p => `${folder}/${p}`).find(p => files.has(p)) ?? null;
    }
    const id = folder.slice(paths.characters.length + 1);
    let brief = '', briefPath: string | null = null;
    if (typeof m.brief === 'string') { brief = m.brief; briefPath = manifestPath; }
    else {
      if (m.brief !== undefined) errors.push('brief 需为文本');
      briefPath = pick('brief_file', ['brief.md', 'brief.txt'], 'text');
      if (briefPath) brief = await body(briefPath, errors) ?? '';
    }
    const c: ProjectCharacter = { id, path: folder, name: typeof m.name === 'string' && m.name.trim() ? m.name : id,
      aliases: Array.isArray(m.aliases) ? m.aliases.filter((a): a is string => typeof a === 'string') : [], brief, brief_path: briefPath,
      tags: { available: false, path: null }, profile: pick('profile', ['profile.md', 'profile.txt'], 'text'),
      portrait: pick('portrait', ['portrait.png', 'portrait.webp', 'portrait.jpg', 'portrait.jpeg'], 'image'), refs: [], issues: errors };
    if (m.tags !== undefined) {
      try { c.tagContent = parseProjectTags(m.tags); c.tags = { available: true, path: manifestPath, field: 'tags' }; }
      catch (e) { errors.push(note(e)); }
    } else { const path = pick('tags_file', ['tags.txt'], 'text'); c.tags = { available: !!path, path }; }
    const refs = annotated(folder, m.refs, errors);
    c.refs = list.filter(f => refKind(f.path) === 'image' && (f.path.startsWith(`${folder}/refs/`) || f.path.startsWith(`${folder}/extra/`) || refs.has(f.path))).map(f => reference(f, refs.get(f.path)));
    characters.push(c);
  }
  const referencesPath = `${paths.references}/references.json`, refMeta = files.has(referencesPath) ? await json(referencesPath, issues) : {};
  const refNotes = annotated(paths.references, refMeta.items, issues);
  const project: ProjectData = {
    title: typeof manifest.title === 'string' && manifest.title.trim() ? manifest.title : root.name,
    description: typeof manifest.description === 'string' ? manifest.description : '', paths, characters,
    lore: list.filter(f => refKind(f.path) === 'text' && (f.path.startsWith(paths.lore + '/') || !f.path.includes('/') && f.path !== 'project.json' || f.path.startsWith('refs/'))).map(f => reference(f)),
    references: list.filter(f => refKind(f.path) === 'image' && (f.path.startsWith(paths.references + '/') || f.path.startsWith('refs/'))).map(f => reference(f, refNotes.get(f.path))), issues,
  };
  for (const path of cache.keys()) if (path !== 'project.json' && !files.has(path)) cache.delete(path);
  signal.throwIfAborted();
  return { files: list, limited, project };
}
