import { boardForm } from "../domain/drawing.ts";
import type { DrawingBoard, DrawingForm } from "../domain/drawing.ts";
import { safePath } from "./fs-driver.ts";

export interface ExportDocument { readonly title: string; readonly stem: string; readonly formats: Readonly<Partial<Record<"json" | "md", string>>> }
const stemOf = (value: string) => value.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").trim().replace(/^\.+|[. ]+$/g, "").slice(0, 90) || "创作资料";
export function recipeDocument(board: DrawingBoard, form: DrawingForm, now = new Date().toISOString()): ExportDocument {
  const recipe = { schema: "koma.bridge.recipe.v1", exported_at: now, kind: "board-form",
    board: { id: board.id, name: board.name, color: board.color, nextCharacterId: board.nextCharacterId, form: boardForm({ ...form, ...board.form }) },
    note: "当前画板表单，不是图片生成回执；参考资产标识为本机依赖，不附带原图或编码。" };
  const json = JSON.stringify(recipe, null, 2);
  return { title: "保存画板配方", stem: `${stemOf(board.name)}-配方`, formats: { json, md: `# 画板配方\n\n来源画板：${board.name.replace(/[\r\n]/g, " ")}\n\n导出时间：${now}\n\n${recipe.note}\n\n\`\`\`json\n${json}\n\`\`\`\n` } };
}
export function memoDocument(title: string, body: string): ExportDocument {
  if (!body.trim()) throw new Error("没有可保存的备忘录正文");
  return { title: "保存创作备忘录", stem: `${stemOf(title)}-备忘录`, formats: { md: body } };
}
export function exportFilename(stem: string, format: "json" | "md") {
  if (!stem.trim() || stem !== stem.trim() || stem.length > 100 || /[\\/:*?"<>|\x00-\x1f]/.test(stem) || stem.startsWith(".") || /[. ]$/.test(stem) || safePath(stem).length !== 1) throw new Error("文件名需为 1–100 个有效字符，不能包含目录路径");
  return `${stem}.${format}`;
}
