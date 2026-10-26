import type { DraftFile, FilePort } from '../ask/draft/files.ts';
import { fileIssue } from '../ask/draft/files.ts';
import { fileDriver } from './fs-driver.ts';
import { exportFilename } from './export.ts';
import { download } from '../shared/files.ts';
import type { bridgeStorage } from './storage.ts';

/** User-confirmed exports. Names are frozen in the card; existing foreign files are never overwritten. */
export function draftFilePort(options: {
  context: FilePort['context']; ready(): boolean;
  session(): { id: string; root: FileSystemDirectoryHandle; signal: AbortSignal } | null;
  storage: ReturnType<typeof bridgeStorage>; changed(): void;
}): FilePort {
  return { context: options.context, async apply(files, undo, commit) {
    const issue = fileIssue(files, options.context()); if (issue) throw new Error(issue);
    if (!options.ready()) throw new Error('数据维护期间暂不能保存文件');
    const session = options.session(), directoryFiles = files.filter(file => file.context.id !== null);
    const driver = session ? fileDriver(session.root) : null;
    const changed: { file: DraftFile; removed: boolean; complete?: boolean }[] = [];
    for (const file of files) if (exportFilename(file.filename.slice(0, -(file.format.length + 1)), file.format) !== file.filename) throw new Error('导出文件名无效');
    async function read(path: string) {
      try { return (await driver!.read(path, 1024 * 1024))?.text ?? null; }
      catch (e) { if (e instanceof DOMException && e.name === 'NotFoundError') return null; throw e; }
    }
    for (const file of directoryFiles) {
      if (!session || session.id !== file.context.id) throw new Error('协同目录已改变');
      const path = `refs/${file.filename}`, existing = await read(path);
      const owner = await options.storage.read<string>(`export:${session.id}:${file.id}`);
      if (existing !== null && (existing !== file.text || owner !== file.filename)) throw new Error(`${file.filename} 已存在或被修改，请重新提议`);
    }
    try {
      for (const file of directoryFiles) {
        session!.signal.throwIfAborted();
        const path = `refs/${file.filename}`, existing = await read(path);
        if (undo) { if (existing !== null) { await driver!.remove(path, session!.signal); changed.push({ file, removed: true }); } }
        else if (existing === null) {
          await options.storage.put(`export:${session!.id}:${file.id}`, file.filename);
          const pending = { file, removed: false, complete: false }; changed.push(pending);
          await driver!.write(path, file.text, session!.signal); pending.complete = true;
        }
      }
      const stale = fileIssue(files, options.context()); if (stale) throw new Error(stale);
      const result = await commit();
      if (!undo) for (const file of files.filter(file => file.context.id === null)) download(new Blob([file.text], { type: file.format === 'json' ? 'application/json' : 'text/markdown' }), file.filename);
      options.changed(); return result;
    } catch (error) {
      const signal = new AbortController().signal;
      for (const { file, removed, complete } of changed.reverse()) {
        const path = `refs/${file.filename}`, current = await read(path);
        if (removed && current === null) await driver!.write(path, file.text, signal);
        else if (!removed && (current === file.text || !complete && current === '')) await driver!.remove(path, signal);
      }
      throw error;
    }
  } };
}
