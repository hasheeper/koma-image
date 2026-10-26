import type { DraftPlan } from './types.ts';
import type { BoardForm } from '../../domain/drawing.ts';
export interface FilePreview {
  readonly id: string; readonly title: string; readonly path: string; readonly target: string; readonly source?: string;
  readonly details: readonly { readonly label: string; readonly value: string }[];
  readonly text?: readonly string[]; readonly related?: readonly string[];
}
/** Readable review data, never a write request or a raw JSON viewer. */
export function filePreviews(plan: DraftPlan): readonly FilePreview[] {
  const rows: FilePreview[] = (plan.files ?? []).map(file => {
    const details = [{ label: '内容', value: file.summary }];
    const prose: string[] = [];
    if (file.document === 'recipe') {
      const form = (JSON.parse(file.text) as { board: { form: BoardForm } }).board.form;
      details.push({ label: '模型', value: form.model }, { label: '画幅', value: `${form.width} × ${form.height}` }, { label: '参数', value: `${form.steps} 步 · Guidance ${form.scale} · Seed ${form.seed || '随机'}` });
      if (form.prompt) prose.push(form.prompt);
      if (form.negative) prose.push(`Negative: ${form.negative}`);
    } else if (file.document === 'memo') prose.push(file.text);
    return { id: file.id, title: file.title, path: `${file.context.id === null ? '' : 'refs/'}${file.filename}`, target: file.context.id === null ? '下载' : 'refs/',
      details: [{ label: '去向', value: file.context.id === null ? '浏览器下载' : file.context.directory }, ...details], text: prose };
  });
  for (const request of plan.slate?.bindings ?? []) {
    const todo = plan.slate?.after?.todos.find(t => t.binding?.assetId === request.assetId); if (!todo?.binding) continue;
    const path = todo.binding.target_path;
    rows.push({ id: request.assetId, title: todo.title, path, target: plan.slate!.directoryRequired ? 'assets/' : '成果', source: request.label,
      details: [{ label: '来源', value: request.label }, { label: '去向', value: plan.slate!.directoryRequired ? '本机与协同目录' : '本机；已映射目录时同步' }], related: [path + '.json', path + '.txt'] });
  }
  return rows;
}
