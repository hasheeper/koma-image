import {layerConflict,layerPort,patchedForm,type LayerContext} from '../../layer/planning.ts';
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
import type { DrawingBoard, DrawingForm, ImageRecord } from "../../domain/drawing.ts";
import { imageFileName } from "../../domain/drawing.ts";
import type { DraftPlan, Field, RollbackBase } from "./types.ts";
import type { HandoffImages } from '../handoff-images.ts';

const evolutionChange = (plan: DraftPlan) => plan.evolution ?? (plan.rollbackBase ?? plan.stagedLoad)?.evolution;

const labels: Partial<Record<Field, string>> = { prompt: "Prompt", negative: "Negative", composer: "对话输入框", model: "模型", width: "尺寸", height: "尺寸", seed: "Seed", steps: "步数", scale: "Guidance", cfg: "中转 CFG（旧）", cfgRescale: "Guidance Rescale", varietyPlus: "Variety+", naiMode: "模式", complexity: "Complexity", qualityPreset: "质量预设", negativePreset: "负向预设", transparentBg: "透明底", sampler: "采样器", batchCount: "张数", characters: "角色组", placement: "角色定位" };

/** The only ASK module with write ports. Called exclusively by user actions. */
export interface EvolutionWritePort {
  treeIssue?: (change: NonNullable<DraftPlan['treeChange']>, undo?: boolean) => string;
  commitTree?: (change: NonNullable<DraftPlan['treeChange']>, undo?: boolean) => void;
  treeSnapshot?: (id: string) => NonNullable<DraftPlan['treeChange']>['before'] | undefined;
  treeKey?: (record: NonNullable<DraftPlan['treeChange']>['before']) => string;
  prepareHandoff?: (plan: DraftPlan, receipt: string | null) => NonNullable<DraftPlan['treeChange']> | null;
  moveIssue: (change: RollbackBase['evolution'], undo?: boolean) => string;
  commitMove: (change: RollbackBase['evolution'], undo?: boolean) => void;
  stagedAvailable?: (load: NonNullable<DraftPlan['stagedLoad']>) => boolean;
  available: (base: RollbackBase) => boolean;
}
export function createDraftWriter(drawing: Drawing, chat: Chat, router: AppRouter, slates?: Slates, filePort?: () => FilePort | null, editor?: Pick<Editor, "records" | "record" | "installReferences" | "holdReferences" | "collectReferences" | "askSnapshot" | "writeAskDraft" | "insertAskBoard" | "removeAskBoard">, evolution?: EvolutionWritePort, handoffImages?: HandoffImages, retainedRecord?: (id: string) => ImageRecord | undefined) {
  let retained = new Set<string>();
  const workshopWrites = new Map<DraftPlan, NonNullable<DraftPlan['treeChange']>>();
  const chatKey = () => chatDraftKey(chat.snapshot().current);
  const readBoards = () => new Map((drawing.snapshot().boards ?? []).map(b => [b.id, structuredClone(b)]));
  const handoffTarget = (receipt: string | null) => receipt ? String(JSON.parse(receipt)[0]) : "";
  function conflictAt(plan: DraftPlan, side: "before" | "after", receipt: string | null, fallback: DrawingForm, current: ConversationRecord, boards: ReadonlyMap<string, DrawingBoard>,
    find: (id: string) => ConversationRecord | undefined) {
    if(plan.layerPatch) return layerConflict(router.route.value.workspace==='edit'?layerPort()?.read():undefined,plan.layerPatch,side);
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
    // Current-context drafts freeze the conversation; creating drafts own their target.
    if (plan.handoff || plan.chatChild) {
      if (side === "before") {
        const target = plan.chatChild ? { id: plan.chatChild.source.conversationId, key: plan.chatChild.key } : plan.handoff?.current;
        if (!target) return '';
        const expected = plan.chatChild ? target.key : receipt ?? target.key;
        return current.id !== target.id ? '当前对话已切换' : chatDraftKey(current) !== expected ? '会话或上下文已变化，请重新提议' : '';
      }
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
    const handoff = workshopWrites.get(plan);
    if (handoff && side === 'after') { const issue = evolution?.treeIssue?.(handoff, true) ?? '演进服务不可用'; if (issue) return issue; }
    if (plan.treeChange) {
      const issue = evolution?.treeIssue?.(plan.treeChange, side === 'after') ?? '演进服务不可用';
      if (issue || !plan.changes.length) return issue;
    }
    if (plan.evolution) { const issue = evolution?.moveIssue(plan.evolution, side === 'after') ?? '演进跟踪服务不可用'; if (issue) return issue; }
    if (plan.stagedLoad) {
      const issue = evolution?.moveIssue(plan.stagedLoad.evolution, side === 'after') ?? '演进跟踪服务不可用';
      if (issue) return issue;
      if (side === 'before' && !evolution?.stagedAvailable?.(plan.stagedLoad)) return '预设配方或来源已变化，请重新载入';
    }
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
  function resolveHandoffImages(plan: DraftPlan) {
    const d = drawing.snapshot(), records = [...d.history, ...d.favorites, ...editor?.records() ?? []];
    return plan.handoff!.images.map((image) => {
      if ((image.source === 'project' || image.source === 'attachment')) {
        const item = handoffImages?.get(image.ref); if (!item) throw new Error(`${image.label} 图片附件已失效`);
        return { blob: item.blob, name: item.name, ...(item.origin?.projectId ? { projectSource: { projectId: item.origin.projectId, path: item.origin.path, version: item.origin.version } } : {}), lineage: { via: 'upload' as const, parent_entity_key: item.entity_key, parent_ref: image.binding } };
      }
      if (image.source === "chat") return { asset: image.ref, recordId: image.binding?.record_id };
      const record = records.find((r) => r.id === image.ref) ?? editor?.record?.(image.ref) ?? retainedRecord?.(image.ref);
      if (!record?.blob) throw new Error(`${image.label} 原图已释放或移除`);
      return { blob: record.blob, name: imageFileName(record), lineage:{via:"chat" as const,parent_record_id:record.id,parent_entity_key:record.entity_key,parent_ref:image.binding} };
    });
  }
  function referenceRecord(image: import('./types.ts').HandoffImage): ImageRecord {
    if (image.source==='project'||image.source==='attachment') {
      const a=handoffImages?.get(image.ref);if(!a)throw new Error(`${image.label} 参考原图已失效`);
      return {id:image.ref,entity_key:a.entity_key,blob:a.blob,thumbBlob:null,size:a.size,params:{...(a.origin?.projectId?{projectSource:{...a.origin}}:{})},createdAt:Date.now()};
    }
    if(image.source==='chat') {const a=chat.assets.get(image.ref);return {id:image.ref,entity_key:a.entity_key,blob:a.blob,thumbBlob:null,size:{width:a.width,height:a.height},params:{},createdAt:Date.now()};}
    const d=drawing.snapshot(),r=[...d.history,...d.favorites].find(r=>r.id===image.ref)??editor?.record?.(image.ref)??editor?.records().find(r=>r.id===image.ref)??retainedRecord?.(image.ref);
    if(!r?.blob)throw new Error(`${image.label} 参考原图已释放或移除`);return r;
  }
  async function writeLocal(plan: DraftPlan, undo: boolean, receipt: string | null) {
    if(plan.layerPatch) {
      const port=layerPort();
      if (!port || router.route.value.workspace!=='edit') throw new Error('请打开来源分件项目');
      await port.write(plan.layerPatch,undo);
      return null;
    }
    if (plan.treeChange && !plan.changes.length) return null;
    const reason = evolutionChange(plan) || plan.treeChange || plan.handoff || plan.editHandoff ? boardConflict(plan, undo ? "after" : "before", receipt) : conflict(plan, undo ? "after" : "before", receipt);
    if (reason) throw new Error(reason);
    if (!plan.edit && !plan.changes.length && !plan.branch && !plan.handoff && !plan.chatChild && !plan.slate && !plan.files?.length && !plan.rollbackBase && !plan.stagedLoad && !plan.createdBoard) throw new Error("草稿没有可写入内容");
    if (router.route.value.overlay) throw new Error("请先关闭当前面板");
    if(plan.edit) {
      const e=plan.edit,before=undo?e.after:e.before,after=undo?e.before:e.after;
      const releaseReferences=editor?.holdReferences?.([...before.references??[],...after.references??[]].map(r=>r.id));
      let inserted=false;
      try {
      const preparedReferences=!undo ? (plan.editReferences??[]).map(({image,reference})=>({reference,record:referenceRecord(image)})) : [];
      if(!undo&&plan.editHandoff?.created&&!editor?.askSnapshot(e.id)) {
        const h=plan.editHandoff,image=h.image,d=drawing.snapshot();
        const record=(image.source==='project'||image.source==='attachment')?await (async()=>{const a=handoffImages?.get(image.ref);if(!a)return;return {id:image.ref,entity_key:a.entity_key,createdAt:Date.now(),blob:a.blob,thumbBlob:await makeThumb(a.blob),name:a.name,size:a.size,params:{...h.params,...(a.origin?.projectId?{projectSource:{...a.origin}}:{})}};})():image.source==='chat'?await (async()=>{const a=chat.assets.get(image.ref);return {id:image.ref,entity_key:a.entity_key,createdAt:Date.now(),blob:a.blob,thumbBlob:await makeThumb(a.blob),name:a.name,size:{width:a.width,height:a.height},params:h.params,...(a.lineage?{lineage:a.lineage}:{})};})():[...d.history,...d.favorites,...editor?.records()??[]].find(r=>r.id===image.ref)??editor?.record?.(image.ref)??retainedRecord?.(image.ref);
        if(!record?.blob)throw new Error('交接原图已释放或移除');
        await editor!.insertAskBoard({...h.target,config:before},record,h.origin);inserted=true;
      }
      const live=editor!.askSnapshot(e.id);
      const lateIssue=!plan.editRollback&&!undo&&live?(e.sourceKey!==undefined&&e.sourceKey!==editSourceKey(live,after)?'编辑来源或参数声明已变化，请重新提议':checkEditConfiguration(live,after)):'';
      if(lateIssue){if(inserted)editor!.removeAskBoard(e.id);throw new Error(lateIssue);}
      const baseChange=plan.editRollback?{before:undo?plan.editRollback.after.baseId:plan.editRollback.before.baseId,after:undo?plan.editRollback.before.baseId:plan.editRollback.after.baseId}:undefined;
      if(preparedReferences.length)editor!.installReferences(e.id,preparedReferences);
      editor!.writeAskDraft(e.id,before,after,baseChange);
      try { if(plan.slate) {const change=undo?{...plan.slate,before:plan.slate.after,after:plan.slate.before,bindings:[]}:plan.slate;await slates!.commit(change,undefined,true);} }
      catch(error){editor!.writeAskDraft(e.id,after,before,baseChange?{before:baseChange.after,after:baseChange.before}:undefined);if(inserted)editor!.removeAskBoard(e.id);throw error;}
      if(undo&&plan.editHandoff?.created)editor!.removeAskBoard(e.id);
      return plan.editRollback?JSON.stringify(['edit',e.id,editor!.askSnapshot(e.id)!.maskRevision]):null;
      } catch(error) { if(inserted)editor!.removeAskBoard(e.id); throw error; } finally { releaseReferences?.(); }
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
    if (!plan.edit && !plan.changes.length && !plan.branch && !plan.handoff && !plan.chatChild && !plan.rollbackBase && !plan.stagedLoad && !plan.createdBoard) return null;
    const images = plan.handoff && !undo ? resolveHandoffImages(plan) : [];
    router.switchWorkspace(plan.workspace);
    if (router.route.value.workspace !== plan.workspace) throw new Error("未能切换到目标工作区");
    if (plan.handoff) return undo ? chat.undoHandoffDraft(receipt!, false) : chat.writeHandoffDraft({ ...plan.handoff, ...(plan.handoff.current ? { current: { ...plan.handoff.current, key: receipt ?? plan.handoff.current.key } } : {}), images }, false);
    if (plan.chatChild) return undo ? chat.undoHandoffDraft(receipt!, false) : chat.writeImageChildDraft(plan.chatChild.source, plan.chatChild.key);
    if (plan.branch) return chat.writeBranchDraft(undo ? plan.branch.before : plan.branch.after, receipt ?? plan.branch.key, !evolutionChange(plan));
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
      if (evolutionChange(plan)) {
        const move=evolutionChange(plan)!;
        try {
          if (!undo && plan.stagedLoad && !evolution!.stagedAvailable?.(plan.stagedLoad)) throw new Error('预设来源或参考资源已变化，已撤回载入');
          evolution!.commitMove(move, undo);
        }
        catch (error) { await writeLocal(plan, !undo, result); throw error; }
      }
      if (plan.treeChange) {
        try { evolution!.commitTree!(plan.treeChange, undo); }
        catch (error) { if (plan.changes.length) await writeLocal({ ...plan, treeChange: undefined }, !undo, result); throw error; }
      }
      if (plan.handoff || plan.editHandoff) {
        try {
          const change = undo ? workshopWrites.get(plan) : evolution?.prepareHandoff?.(plan, result);
          if (change) { evolution!.commitTree!(change, undo); if (!undo) workshopWrites.set(plan, change); }
        } catch (error) { await writeLocal(plan, !undo, result); throw error; }
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
      const workshop = workshopWrites.get(plan);
      if (committed && workshop) { evolution!.commitTree!(workshop, !undo); await writeLocal(plan, !undo, result); }
      if (committed && plan.treeChange) { evolution!.commitTree!(plan.treeChange, !undo); if (plan.changes.length) await writeLocal(plan, !undo, result); }
      if (committed && (evolutionChange(plan))) {
        await writeLocal(plan, !undo, result);
        evolution!.commitMove(evolutionChange(plan)!, !undo);
      }
      throw error;
    }
  }
  return {
    chatKey, conflict,
    rebaseReceipt: (before: string, after: string) => chat.rebaseHandoffDraft(before, after),
    retainedRecords: () => retained,
    retain(plans: readonly DraftPlan[], handoffReceipts: readonly string[] = []) {
      for (const plan of workshopWrites.keys()) if (!plans.includes(plan)) workshopWrites.delete(plan);
      handoffImages?.retain(plans);
      retained = new Set(plans.flatMap(p => [...p.handoff?.images.map(i => i.ref) ?? [], ...p.editReferences?.map(i=>i.image.ref) ?? [], ...p.edit ? [...p.edit.before.references??[],...p.edit.after.references??[]].map(r=>r.id) : [], ...p.editHandoff ? [p.editHandoff.image.ref] : [],
        ...p.treeChange ? [p.treeChange.before, p.treeChange.after].flatMap(r => Object.values(r.pictureRefs).map(ref => ref.record_id)) : []]));
      for (const change of workshopWrites.values()) for (const record of [change.before, change.after]) for (const ref of Object.values(record.pictureRefs)) retained.add(ref.record_id);
      drawing.retainHistory('draft-undo', retained);
      chat.retainHandoffDrafts(handoffReceipts);
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
      const treeStates = new Map<string, NonNullable<DraftPlan['treeChange']>['before']>();
      const treeState = (id: string) => treeStates.get(id) ?? evolution?.treeSnapshot?.(id);
      const undoTree = (change: NonNullable<DraftPlan['treeChange']>) => {
        const current = treeState(change.id);
        const issue = current ? evolution?.treeKey?.(current) !== evolution?.treeKey?.(change.after) ? '演进已有后续修改' : '' : evolution?.treeIssue?.(change, true) ?? '演进服务不可用';
        if (issue) throw new Error(issue);
        treeStates.set(change.id, change.before); evolutionKeys.set(change.id, change.before.cursorKey);
      };
      let layerState:LayerContext|undefined;
      const edits=new Map<string,import("../../domain/edit-draft.ts").EditDraftState>();
      const tasks = new Map(slates?.list.value.map(s => [s.id, structuredClone(s)]) ?? []);
      let current = conversations.get(snapshot.current.id) ?? structuredClone(snapshot.current);
      return {
        undo(plan: DraftPlan, receipt: string | null, originalReceipt = receipt) {
          if(plan.layerPatch) {
            layerState ??= structuredClone(layerPort()?.read());
            const issue=layerConflict(layerState,plan.layerPatch,'after');
            if(issue || !layerState) throw new Error(issue);
            for(const e of plan.layerPatch.edits) {
              if(e.kind==='todos') layerState.todos=e.before;
              else if(e.kind==='references') layerState.scalpel.references=e.before;
              else if(e.kind==='prompt') layerState.forms[e.key]=patchedForm(layerState.forms[e.key],e,'before');
              else layerState.stack.find(l=>l.id===e.key)!.name=e.before;
            }
            return null;
          }
          const workshop = workshopWrites.get(plan);
          if (workshop) undoTree(workshop);
          if (plan.treeChange) { undoTree(plan.treeChange); if (!plan.changes.length) return null; }
          if (evolutionChange(plan)) {
            const change = evolutionChange(plan)!;
            const simulated = evolutionKeys.get(change.id);
            if (simulated === undefined) { const issue = evolution?.moveIssue(change, true) ?? '演进跟踪服务不可用'; if (issue) throw new Error(issue); }
            else if (simulated !== change.after.key) throw new Error('演进基底已变化');
            evolutionKeys.set(change.id, change.before.key);
            const currentTree = treeState(change.id);
            if (currentTree) treeStates.set(change.id, { ...currentTree, cursor: change.before.cursor, cursorKey: change.before.key, destination: change.before.destination ?? null });
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
          if (plan.handoff || plan.chatChild) {
            const id = handoffTarget(receipt), target = conversations.get(id)!, origin = chat.handoffOrigin(originalReceipt!);
            if (!origin) throw new Error("交接撤销记录已释放");
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
