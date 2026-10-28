import { imageParameters } from "../domain/image-parameters.ts";
export { imageParameters } from "../domain/image-parameters.ts";
import { summary as slateSummary } from "../slate/model.ts";
import { DEFAULTS, boardForm } from "../domain/drawing.ts";
import type { DrawingBoard, DrawingForm } from "../domain/drawing.ts";
import { promptOf } from "../ask/library.ts";
import type { Picture } from "../ask/library.ts";
import { stateHash } from "../ask/draft/validate.ts";
import { LIVE_SCHEMA } from "./protocol.ts";
import type { BridgeSnapshot, InboxReceipt } from "./protocol.ts";
import type { RefIndex } from "../ask/reference-source.ts";

export function pictureIndex(library: readonly Picture[], source: "history" | "favorites") {
  return library.flatMap(p => p.origins.filter(o => o.source === source).map(o => ({ label: o.label, record_id:p.id, entity_key:p.entity_key, width: p.size.width, height: p.size.height,
    ...(typeof p.params.seed === "number" ? { seed: p.params.seed } : {}), prompt_excerpt: [...promptOf(p)].slice(0, 160).join("") })));
}
export function previewPictures(library: readonly Picture[], selectedId: string | null) {
  const recent = [...library].filter(p => p.origins.some(o => o.source === "history"))
    .sort((a, b) => b.origins.find(o => o.source === "history")!.order - a.origins.find(o => o.source === "history")!.order).slice(0, 3);
  const selected = library.find(p => p.id === selectedId) ?? null;
  return { selected, recent, pictures: [...new Map([...(selected ? [selected] : []), ...recent].map(p => [p.id, p])).values()] };
}
export function liveState(snapshot: BridgeSnapshot, input: {
  boards: readonly DrawingBoard[]; workspace: string; selectedId: string | null; scope: string; revision: number;
  receipt: InboxReceipt | null; previews?: ReadonlyMap<string, string>;
  refs?: RefIndex;
}) {
  const { selected, recent } = previewPictures(snapshot.library, input.selectedId);
  const project = (p: Picture) => ({ id: p.id, label: p.label, entity_key:p.entity_key, width: p.size.width, height: p.size.height,
    params: imageParameters(p.params), preview: input.previews?.get(p.id) ?? null });
  const form = Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, snapshot.base.form[k as keyof DrawingForm]]));
  return { schema: LIVE_SCHEMA, picture_ref_version:2, favorites_scope_id:snapshot.favoritesScope, updated_at: new Date().toISOString(), revision: input.revision,
    scope_id: input.scope, picture_scope_id: snapshot.pictureScope, active_workspace: input.workspace,
    active_board_id: snapshot.base.boardId, base_hash: stateHash(snapshot.base),
    boards: input.boards.map(b => ({ id: b.id, name: b.name, color: b.color, nextCharacterId: b.nextCharacterId, form: boardForm({ ...snapshot.base.form, ...b.form }) })),
    form, ...(snapshot.edit ? { edit: snapshot.edit } : {}), active_slate: slateSummary(snapshot.base.slate ?? null), ...(input.refs ? { refs_index: input.refs } : {}), selected_image: selected ? project(selected) : null, recent_history: recent.map(project),
    history_index: pictureIndex(snapshot.library, "history"), favorites_index: pictureIndex(snapshot.library, "favorites"), last_inbox_receipt: input.receipt };
}
