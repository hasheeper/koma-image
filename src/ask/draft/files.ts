import { checkShape } from './schema-check.ts';
import { fileSchema } from './file-schema.ts';
import type { DraftState } from './types.ts';
import { recipeDocument, memoDocument, exportFilename } from '../../bridge/export.ts';
import { slateDocument } from '../../slate/documents.ts';

export interface FileContext { readonly id: string | null; readonly directory: string; readonly available: boolean }
export interface DraftFile {
  readonly id: string; readonly document: 'recipe' | 'memo' | 'slate'; readonly title: string;
  readonly filename: string; readonly format: 'json' | 'md'; readonly text: string;
  readonly context: FileContext; readonly summary: string;
}
export interface FileStep { readonly kind: 'save_ref'; readonly file: DraftFile }
export interface FilePort {
  context(): FileContext;
  apply<T>(files: readonly DraftFile[], undo: boolean, commit: () => Promise<T>): Promise<T>;
}
export function parseFile(step: Readonly<Record<string, unknown>>, base: DraftState): FileStep {
  checkShape(step, fileSchema, "文件草稿");
  const kind = step.document;
  if (kind !== 'recipe' && kind !== 'memo' && kind !== 'slate') throw new Error('文件类型无效');
  const title = step.document_title === undefined ? (base.boardName ?? '创作资料').slice(0, 80) : step.document_title;
  if (typeof title !== 'string' || !title.trim() || title.length > 80) throw new Error('文件标题无效');
  if (step.text !== undefined && (typeof step.text !== 'string' || step.text.length > 24000)) throw new Error('备忘录正文无效');
  const document = kind === 'recipe' ? recipeDocument({ id: base.boardId ?? '', name: base.boardName ?? title, color: '', nextCharacterId: base.nextCharacterId ?? 1, form: base.form }, base.form)
    : kind === 'slate' ? base.slate ? slateDocument(base.slate) : null : memoDocument(title, typeof step.text === 'string' ? step.text : '');
  if (!document) throw new Error('当前没有任务清单');
  const format = kind === 'memo' ? 'md' : 'json', id = crypto.randomUUID();
  return { kind: 'save_ref', file: { id, document: kind, title: kind === 'recipe' ? '画板配方' : kind === 'memo' ? '创作备忘录' : '任务交接资料',
    filename: exportFilename(`${document.stem.slice(0, 70)}-${id.slice(0,8)}`, format), format, text: document.formats[format]!,
    context: structuredClone(base.fileContext ?? { id: null, directory: '', available: true }),
    summary: kind === 'recipe' ? `提议时画板 · ${base.boardName ?? title} · ${base.form.model} · ${base.form.width} × ${base.form.height}` : kind === 'slate' ? base.slate!.title : title } };
}
export function fileIssue(files: readonly DraftFile[], context?: FileContext) {
  return files.some(file => file.context.id !== null && (!context?.available || context.id !== file.context.id)) ? '协同目录已断开或改变，请恢复原目录后应用' : '';
}
