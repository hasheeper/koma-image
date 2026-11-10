import { checkEditConfiguration } from "./edit-configuration.ts";
import { editSourceKey } from './edit-options.ts';
import { makeThumb } from "../../services/image-response.ts";
import type { Editor } from "../../services/editor.ts";
import { fileIssue } from "./files.ts";
import type { FilePort } from "./files.ts";
import type { Slates, BoardWrite } from "../../slate/service.ts";
import { contentKey } from "../../slate/model.ts";
import { applyChatSelection, chatDraftKey, sortConversations } from "../../domain/conversation.ts";
import { sameValue } from "../../domain/characters.ts";
import type { ConversationRecord } from "../../storage/records.ts";
import type { Drawing } from "../../services/drawing.ts";
import type { Chat } from "../../services/chat.ts";
import type { AppRouter } from "../../app/router.ts";
import type { DrawingBoard, DrawingForm } from "../../domain/drawing.ts";
import { imageFileName } from "../../domain/drawing.ts";
import type { DraftPlan, Field, RollbackBase } from "./types.ts";
import type { ProjectImages } from '../project-images.ts';

const labels: Partial<Record<Field, string>> = { prompt: "Prompt", negative: "Negative", composer: "对话输入框", model: "模型", width: "尺寸", height: "尺寸", seed: "Seed", steps: "步数", scale: "Guidance", cfg: "中转 CFG（旧）", cfgRescale: "Guidance Rescale", varietyPlus: "Variety+", naiMode: "模式", complexity: "Complexity", qualityPreset: "质量预设", negativePreset: "负向预设", transparentBg: "透明底", sampler: "采样器", batchCount: "张数", characters: "角色组", placement: "角色定位" };

/** The only ASK module with write ports. Called exclusively by user actions. */
export interface EvolutionWritePort {
  moveIssue: (change: RollbackBase['evolution'], undo?: boolean) => string;
  commitMove: (change: RollbackBase['evolution'], undo?: boolean) => void;
  available: (base: RollbackBase) => boolean;
}
export function createDraftWriter(drawing: Drawing, chat: Chat, router: AppRouter, slates?: Slates, filePort?: () => FilePort | null, editor?: Pick<Editor, "records" | "askSnapshot" | "writeAskDraft" | "insertAskBoard" | "removeAskBoard">, evolution?: EvolutionWritePort, projectImages?: ProjectImages) {
  const chatKey = () => chatDraftKey(chat.snapshot().current);
  const readBoards = () => new Map((drawing.snapshot().boards ?? []).map(b => [b.id, structuredClone(b)]));
  const handoffTarget = (receipt: string | null) => receipt ? String(JSON.parse(receipt)[0]) : "";
  function conflictAt(plan: DraftPlan, side: "before" | "after", receipt: string | null, fallback: DrawingForm, current: ConversationRecord, boards: ReadonlyMap<string, DrawingBoard>,
    find: (id: string) => ConversationRecord | undefined) {
    if(plan.edit) {
      const state=editor?.askSnapshot(plan.edit.id);
      if(plan.editHandoff?.created&&side==='before'&&!state)return '';
      if(!state)return '编辑画板已关闭';
      if(state.blocked)return state.blocked;
      const expectedBase=plan.editRollback?(side==='before'?plan.editRollback.before.baseId:plan.editRollback.after.baseId):plan.edit.baseId;
      if(state.baseId!==expectedBase)return '编辑底图已变化';
      if(plan.editRollback&&(receipt!==null?String(state.maskRevision)!==String(JSON.parse(receipt)[2]):side==='before'&&state.maskRevision!==plan.editRollback.before.maskRevision))return '编辑蒙版已变化';
      if(!sameValue(state.config,plan.edit[side]))return '编辑配置已变化';
      if(!plan.editRollback&&side==='before'&&plan.edit.sourceKey!==undefined&&plan.edit.sourceKey!==editSourceKey(state,plan.edit.after))return '编辑来源或参数声明已变化，请重新提议';
      return side==='before'?checkEditConfiguration(plan.editRollback?{...state,...plan.editRollback.after,models:state.models}:state,plan.edit.after):'';
    }
    // A handoff opens its own conversation; only undo depends on CHAT's current state.
    if (plan.handoff) {
      if (side === "before") return "";
      const target = find(handoffTarget(receipt));
      return !target ? "新对话已删除" : chatDraftKey(target) !== receipt ? "新对话已继续编辑" : "";
    }
    if (plan.workspace === "chat" && current.id !== plan.conversationId) return "对话已切换";
    if (plan.branch) return chatDraftKey(current) === (receipt ?? (side === "before" ? plan.branch.key : "")) ? "" : "对话分支已变化";
    if (plan.workspace === "image" && plan.boardId && !boards.has(plan.boardId)) return "来源画板已删除";
    if (plan.createdBoard) {
      const b = boards.get(plan.createdBoard.id);
      return side === "before" ? b ? "目标画板已存在" : "" : !b ? "新画板已删除" : !sameValue(b.form, plan.createdBoard.form) ? "新画板已继续编辑" : "";
    }
    const state = plan.workspace === "image" ? plan.boardId ? boards.get(plan.boardId)!.form : fallback : { composer: current.prompt };
    const fields = plan.changes.filter(c => !sameValue((state as Record<string, unknown>)[c.field], c[side]));
    return fields.length ? `${[...new Set(fields.map(c => labels[c.field] ?? c.field))].join("、")} 已变化` : "";
  }
  const boardConflict = (plan: DraftPlan, side: "before" | "after", receipt: string | null = null) =>
    conflictAt(plan, side, receipt, drawing.snapshot().form, chat.snapshot().current, readBoards(), (id) => chat.snapshot().conversations.find((c) => c.id === id));
  const conflict = (plan: DraftPlan, side: "before" | "after", receipt: string | null = null) => {
    if(plan.editRollback){const issue=evolution?.moveIssue(plan.editRollback.evolution,side==='after')??'演进跟踪服务不可用';if(issue)return issue;}
    if (plan.rollbackBase) {
      const issue = evolution?.moveIssue(plan.rollbackBase.evolution, side === 'after') ?? '演进跟踪服务不可用';
      if (issue) return issue;
      if (side === 'before' && (!evolution?.available(plan.rollbackBase) || plan.steps.some(s => s.enabled && s.issue))) return '回退基底不可用或草稿有冲突，请重新提议';
      if (plan.createdBoard) return '回退草稿只能写回当前跟踪画板';
    }
    if(side==="before"&&plan.workspace==="edit"&&plan.steps.some(step=>step.issue))return "草稿有冲突，请重新提议";
    const issue = fileIssue(plan.files ?? [], filePort?.()?.context()); if (issue) return issue;
    if (plan.slate && (!slates || contentKey(slates.get(plan.slate.id)) !== contentKey(plan.slate[side]))) return "任务板已变化";
    return boardConflict(plan, side, receipt);
  };
  /** Recheck workspace records at write time; history or EDIT versions may have been removed. */
  function handoffImages(plan: DraftPlan) {
    const d = drawing.snapshot(), records = [...d.history, ...d.favorites, ...editor?.records() ?? []];
    return plan.handoff!.images.map((image) => {
      if (image.source === 'project') {
        const item = projectImages?.get(image.ref); if (!item) throw new Error(`${image.label} 企划图片已失效`);
        return { blob: item.blob, name: item.name, projectSource: { projectId: item.origin!.projectId!, path: item.origin!.path, version: item.origin!.version } };
      }
      if (image.source === "chat") return { asset: image.ref };
      const record = records.find((r) => r.id === image.ref);
      if (!record) throw new Error(`${image.label} 已移除`);
      return { blob: record.blob, name: imageFileName(record), lineage:{via:"chat" as const,parent_record_id:record.id,parent_entity_key:record.entity_key,parent_ref:image.binding} };
    });
  }
  async function writeLocal(plan: DraftPlan, undo: boolean, receipt: string | null) {
    const reason = plan.rollbackBase || plan.editRollback ? boardConflict(plan, undo ? "after" : "before", receipt) : conflict(plan, undo ? "after" : "before", receipt);
    if (reason) throw new Error(reason);
    if (!plan.edit && !plan.changes.length && !plan.branch && !plan.handoff && !plan.slate && !plan.files?.length && !plan.rollbackBase && !plan.createdBoard) throw new Error("草稿没有可写入内容");
    if (router.route.value.overlay) throw new Error("请先关闭当前面板");
    if(plan.edit) {
      const e=plan.edit,before=undo?e.after:e.before,after=undo?e.before:e.after;
      let inserted=false;
      if(!undo&&plan.editHandoff?.created&&!editor?.askSnapshot(e.id)) {
        const h=plan.editHandoff,image=h.image,d=drawing.snapshot();
        const record=image.source==='project'?await (async()=>{const a=projectImages?.get(image.ref);if(!a)return;return {id:image.ref,entity_key:a.entity_key,createdAt:Date.now(),blob:a.blob,thumbBlob:await makeThumb(a.blob),name:a.name,size:a.size,params:{...h.params,projectSource:a.origin?{...a.origin}:null}};})():image.source==='chat'?await (async()=>{const a=chat.assets.get(image.ref);return {id:image.ref,entity_key:a.entity_key,createdAt:Date.now(),blob:a.blob,thumbBlob:await makeThumb(a.blob),name:a.name,size:{width:a.width,height:a.height},params:h.params,...(a.lineage?{lineage:a.lineage}:{})};})():[...d.history,...d.favorites,...editor?.records()??[]].find(r=>r.id===image.ref);
        if(!record)throw new Error('交接来源已移除');
        await editor!.insertAskBoard({...h.target,config:before},record,h.origin);inserted=true;
      }
      const live=editor!.askSnapshot(e.id);
      const lateIssue=!plan.editRollback&&!undo&&live?(e.sourceKey!==undefined&&e.sourceKey!==editSourceKey(live,after)?'编辑来源或参数声明已变化，请重新提议':checkEditConfiguration(live,after)):'';
      if(lateIssue){if(inserted)editor!.removeAskBoard(e.id);throw new Error(lateIssue);}
      const baseChange=plan.editRollback?{before:undo?plan.editRollback.after.baseId:plan.editRollback.before.baseId,after:undo?plan.editRollback.before.baseId:plan.editRollback.after.baseId}:undefined;
      editor!.writeAskDraft(e.id,before,after,baseChange);
      try { if(plan.slate) {const change=undo?{...plan.slate,before:plan.slate.after,after:plan.slate.before,bindings:[]}:plan.slate;await slates!.commit(change,undefined,true);} }
      catch(error){editor!.writeAskDraft(e.id,after,before,baseChange?{before:baseChange.after,after:baseChange.before}:undefined);if(inserted)editor!.removeAskBoard(e.id);throw error;}
      if(undo&&plan.editHandoff?.created)editor!.removeAskBoard(e.id);
      return plan.editRollback?JSON.stringify(['edit',e.id,editor!.askSnapshot(e.id)!.maskRevision]):null;
    }
    if (plan.slate) {
      const board: BoardWrite | undefined = plan.changes.length || plan.createdBoard ? { id: plan.boardId!,
        before: Object.fromEntries(plan.changes.map(c => [c.field, c[undo ? "after" : "before"]])),
        after: Object.fromEntries(plan.changes.map(c => [c.field, c[undo ? "before" : "after"]])),
        ...(plan.createdBoard ? { created: plan.createdBoard, remove: undo } : {}) } : undefined;
      const change = undo ? { ...plan.slate, before: plan.slate.after, after: plan.slate.before, bindings: [] } : plan.slate;
      await slates!.commit({ ...change, before: slates!.get(change.id) }, board, true);
      if (board) router.switchWorkspace("image");
      return null;
    }
    if (!plan.edit && !plan.changes.length && !plan.branch && !plan.handoff && !plan.rollbackBase && !plan.createdBoard) return null;
    const images = plan.handoff && !undo ? handoffImages(plan) : [];
    router.switchWorkspace(plan.workspace);
    if (router.route.value.workspace !== plan.workspace) throw new Error("未能切换到目标工作区");
    if (plan.handoff) return undo ? chat.undoHandoffDraft(receipt!) : chat.writeHandoffDraft({ ...plan.handoff, images });
    if (plan.branch) return chat.writeBranchDraft(undo ? plan.branch.before : plan.branch.after, receipt ?? plan.branch.key);
    if (plan.createdBoard && plan.boardId) {
      if (undo) await drawing.removeBoardDraft(plan.createdBoard.id, plan.createdBoard, plan.boardId);
      else await drawing.insertBoardDraft(plan.createdBoard, plan.boardId);
      return null;
    }
    const values = Object.fromEntries(plan.changes.map(c => [c.field, c[undo ? "before" : "after"]]));
    const expected: Record<string, unknown> = !undo && plan.rollbackBase ? plan.rollbackBase.expected : Object.fromEntries(plan.changes.map(c => [c.field, c[undo ? "after" : "before"]]));
    if (plan.workspace === "image") { await drawing.writeDraft(values as Partial<DrawingForm>, expected, plan.boardId); return null; }
    await chat.writeDraft(String(values.composer), plan.conversationId, String(expected.composer));
    return chatKey();
  }
  async function write(plan: DraftPlan, undo: boolean, receipt: string | null) {
    const reason = conflict(plan, undo ? "after" : "before", receipt); if (reason) throw new Error(reason);
    const local = async () => {
      const result = await writeLocal(plan, undo, receipt);
      if (plan.rollbackBase || plan.editRollback) {
        const move=plan.rollbackBase?.evolution??plan.editRollback!.evolution;
        try { evolution!.commitMove(move, undo); }
        catch (error) { await writeLocal(plan, !undo, result); throw error; }
      }
      return result;
    };
    if (!plan.files?.length) return local();
    const port = filePort?.(); if (!port) throw new Error("文件保存服务未就绪");
    let committed = false, result: string | null = null;
    try {
      return await port.apply(plan.files, undo, async () => {
        result = await local(); committed = true; return result;
      });
    } catch (error) {
      if (committed && (plan.rollbackBase || plan.editRollback)) {
        await writeLocal(plan, !undo, result);
        evolution!.commitMove((plan.rollbackBase ?? plan.editRollback)!.evolution, !undo);
      }
      throw error;
    }
  }
  return {
    chatKey, conflict,
    retain(plans: readonly DraftPlan[]) {
      projectImages?.retain(plans);
      if (!slates) return;
      const ids = plans.flatMap(p => p.slate ? [p.slate.before, p.slate.after].flatMap(s => s?.todos.flatMap(t => t.binding?.assetId ?? []) ?? []) : []);
      void slates.retain(ids).then(() => slates.cleanAssets()).catch(() => {});
    },
    apply: (plan: DraftPlan, receipt: string | null = null) => write(plan, false, receipt),
    undo: (plan: DraftPlan, receipt: string | null = null) => write(plan, true, receipt),
    canUndo: (plan: DraftPlan, receipt: string | null = null) => !conflict(plan, "after", receipt),
    /** Synchronous W4 preflight across every affected board, without write ports. */
    simulate() {
      const form = structuredClone(drawing.snapshot().form), boards = readBoards(), snapshot = chat.snapshot(),
        conversations = new Map(snapshot.conversations.map((c) => [c.id, structuredClone(c)]));
      const evolutionKeys = new Map<string, string>();
      const edits=new Map<string,import("../../domain/edit-draft.ts").EditDraftState>();
      const tasks = new Map(slates?.list.value.map(s => [s.id, structuredClone(s)]) ?? []);
      let current = conversations.get(snapshot.current.id) ?? structuredClone(snapshot.current);
      return {
        undo(plan: DraftPlan, receipt: string | null) {
          if (plan.rollbackBase || plan.editRollback) {
            const change = (plan.rollbackBase ?? plan.editRollback)!.evolution;
            const simulated = evolutionKeys.get(change.id);
            if (simulated === undefined) { const issue = evolution?.moveIssue(change, true) ?? '演进跟踪服务不可用'; if (issue) throw new Error(issue); }
            else if (simulated !== change.after.key) throw new Error('演进基底已变化');
            evolutionKeys.set(change.id, change.before.key);
          }
          if (plan.slate && contentKey(tasks.get(plan.slate.id) ?? null) !== contentKey(plan.slate.after)) throw new Error("任务板已变化");
          if(plan.edit) {
            const e=plan.edit,current=edits.get(e.id)??editor?.askSnapshot(e.id);
            if(!current||!sameValue(current.config,e.after))throw new Error('编辑配置已变化');
            if(current.blocked)throw new Error(current.blocked);
            if(current.baseId!==(plan.editRollback?.after.baseId??e.baseId))throw new Error('编辑底图已变化');
            if(plan.editRollback&&receipt&&current.maskRevision!==JSON.parse(receipt)[2])throw new Error('编辑蒙版已变化');
            if(plan.slate){if(plan.slate.before)tasks.set(plan.slate.id,structuredClone(plan.slate.before));else tasks.delete(plan.slate.id);}
            edits.set(e.id,{...current,config:structuredClone(e.before),baseId:plan.editRollback?.before.baseId??current.baseId});
            return plan.editRollback?JSON.stringify(['edit',e.id,current.maskRevision]):null;
          }
          const reason = conflictAt(plan, "after", receipt, form, current, boards, (id) => conversations.get(id));
          if (reason) throw new Error(reason);
          if (plan.slate) { if (plan.slate.before) tasks.set(plan.slate.id, structuredClone(plan.slate.before)); else tasks.delete(plan.slate.id); }
          if (plan.handoff) {
            const id = handoffTarget(receipt), target = conversations.get(id)!, origin = chat.handoffOrigin(id);
            if (origin?.before) Object.assign(target, origin.before, { selectionRevision: target.selectionRevision + 1 });
            else conversations.delete(id);
            if (current === target || !conversations.has(current.id))
              current = conversations.get(origin?.source ?? "") ?? sortConversations([...conversations.values()])[0] ?? current;
          }
          else if (plan.branch) { applyChatSelection(current, plan.branch.before); current.selectionRevision++; }
          else if (plan.createdBoard) boards.delete(plan.createdBoard.id);
          else if (plan.workspace === "image") Object.assign(plan.boardId ? boards.get(plan.boardId)!.form : form, Object.fromEntries(plan.changes.map(c => [c.field, structuredClone(c.before)])));
          else if (plan.changes.length) current.prompt = String(plan.changes.find(c => c.field === "composer")!.before);
          return plan.workspace === "chat" ? chatDraftKey(current) : null;
        },
      };
    },
  };
}
