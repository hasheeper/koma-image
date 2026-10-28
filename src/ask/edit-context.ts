import type { Editor } from "../services/editor.ts";
import type { Picture } from "./library.ts";
import type { Ids } from "./ids.ts";
import type { ImageTagBinding } from "../domain/image-identity.ts";
import { editLabel, qualifiedEditLabel } from "../domain/edit-identity.ts";

export type PictureRefs = Readonly<Record<string, ImageTagBinding>>;
export interface PictureScopes { page: string; favorites: string; ask: string; chat: string }
export function editPictures(editor: Editor | undefined, ids: Ids, chat: readonly Picture[] = []): readonly Picture[] {
  if (!editor) return [];
  const records = new Map(editor.records().map(r => [r.id, r]));
  return editor.boards().flatMap(board => board.versions.map(v => {
    const r = records.get(v.recordId)!;
    const local = board.id === editor.session.id;
    const aliases = [qualifiedEditLabel(board, v), ...(local ? [editLabel(v)] : [])];
    const selected = v.director && (board.directorChoices[v.director.group] ?? board.versions.find(p => p.director?.group === v.director!.group)?.id) === v.id;
    if (v.director?.variant && selected) aliases.push(qualifiedEditLabel(board, v, false), ...(local ? [editLabel(v, false)] : []));
    const source = board.versions.find(p => p.sequence === 1)?.sourceId;
    const sourceRecord = source?.replace(/^(?:record|history|favorite):/, "");
    const origin = source ? ids.label(sourceRecord!) ?? chat.find(p => p.id === source || p.id === sourceRecord)?.label ?? null : null;
    return Object.freeze({ id: r.id, lineage:v.lineage, entity_key: v.entity_key, label: qualifiedEditLabel(board,v), aliases: Object.freeze(aliases), createdAt: r.createdAt, blob: r.blob,
      origins: Object.freeze(aliases.map(label => ({ source: "edit" as const, label, boardId: board.id, origin, order: v.id }))),
      size: Object.freeze({ ...r.size }), params: Object.freeze(structuredClone(r.params)),
    });
  }));
}
/** Keep recipes per record; only add aliases when the occurrence really is the same record. */
export function withEditPictures(base: readonly Picture[], edits: readonly Picture[]): readonly Picture[] {
  const result = new Map(base.map(p => [p.id, p]));
  for (const p of edits) {
    const other = result.get(p.id);
    result.set(p.id, other ? { ...other, scope: other.scope ?? p.scope, aliases: [...new Set([...other.aliases, ...p.aliases])], origins: [...other.origins, ...p.origins] } : p);
  }
  return [...result.values()];
}
export function freezePictureRefs(pictures: readonly Picture[], scopes: PictureScopes): PictureRefs {
  return Object.fromEntries(pictures.flatMap(p => p.aliases.map(tag => [tag, p.bindings?.[tag] ?? {
    tag, entity_key: p.entity_key ?? "", record_id: p.id,
    scope: tag.startsWith("#f") ? { kind:"favorites", id:scopes.favorites } : tag.startsWith("#c") ? p.scope ?? {kind:"chat",id:scopes.chat} : tag.startsWith("#a") ? {kind:"ask",id:scopes.ask} : {kind:"page",id:scopes.page, ...(tag.startsWith("#e") ? {board_id:p.origins.find(o=>o.label===tag && o.source==="edit")?.boardId ?? String(p.params.editBoardId ?? "")} : {})},
  } satisfies ImageTagBinding])));
}
export function editContext(editor: Editor | undefined, pictures: readonly Picture[]) {
  if (!editor) return null;
  return { active_board_id: editor.session.id, board_seq: editor.session.boardSeq, read_only: true,
    boards: editor.boards().map(b => ({ id: b.id, board_seq: b.boardSeq, name: b.name,
      selected: b.versions.find(v => v.id === b.viewId) ? qualifiedEditLabel(b, b.versions.find(v => v.id === b.viewId)!) : null,
      base: b.versions.find(v => v.id === b.baseId) ? qualifiedEditLabel(b, b.versions.find(v => v.id === b.baseId)!) : null,
      versions: b.versions.map(v => { const p = pictures.find(p => p.id === v.recordId); return {
        id: qualifiedEditLabel(b,v), local_id: editLabel(v), record_id: v.recordId, entity_key:v.entity_key,
        parent: b.versions.find(p => p.id===v.parentId) ? qualifiedEditLabel(b,b.versions.find(p=>p.id===v.parentId)!) : null,
        lineage: v.lineage ?? null, origin: p?.origins.find(o=>o.source==="edit" && o.boardId===b.id)?.origin ?? null, origin_id: b.versions[0]?.sourceId ?? null,
        width:v.width,height:v.height,tool:v.params?.tool ?? v.mode ?? "source",variant:v.director?.variant ?? null,
        ...(typeof v.params?.seed === "number" ? {seed:v.params.seed} : {}),
      }; }) })) };
}

export function bindPictures(pictures: readonly Picture[], scopes: PictureScopes): Picture[] {
  const refs=freezePictureRefs(pictures,scopes);
  return pictures.map(p=>({...p, bindings:Object.fromEntries(p.aliases.map(tag=>[tag,refs[tag]]))}));
}
