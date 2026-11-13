import { createEvolutionEvents, evolutionTarget, evolutionMask } from '../domain/evolution-input.ts';
import { chatEvolutionInput, chatInputImage } from '../domain/chat-evolution.ts';
import { annotationMask } from '../native/annotation-canvas.ts';
import { annotationPrompt, annotationAlignment, validateRegions, validateAnnotationSnapshot, validateAnnotationAreas } from "../domain/region-annotation.ts";
import type { AnnotationSnapshot } from "../domain/region-annotation.ts";
import { decodeImage } from "./image-response.ts";
import type { AnnotationReview, AnnotationTarget } from "./annotations.ts";
import type { ApplicationServices } from "./application";
import type { Ui } from "../app/ui";
import { message } from "../app/ui";
import type { CatalogModel } from "../domain/catalog";
import { normalizeOptions, resolveModel, selectCatalogSources } from "../domain/catalog";
import { removedModel } from "../domain/models";
import { buildChatPayload, chatModels } from "../domain/media.ts";
import * as conversation from "../domain/conversation.ts";
import { object } from "../domain/value";
import type { Quote } from "../domain/quote";
import type { SourceSelection } from "./source-priority.ts";
import type { QuotaStatus } from "../domain/quota";
import type {
  ConversationRecord,
  ConversationTurn,
  ConversationVersion,
  AssetRecord,
  Fields,
  MessageBlock,
} from "../storage/records";
import { assetRefs } from "../storage/records";
import { names } from "../storage/names";
import { idbRequest, transactionDone } from "../storage/databases";
import type { Writer } from "./data-lease";
import { AssetStore } from "./assets";
import { consumeMedia } from "./media-response";
import { createHandoff, fitReference } from "./handoff";
import { imageConnections } from "../config/connections.ts";
import { chatImageId, chatImageOrigin } from "../domain/image-origin.ts";
import { makeThumb } from "./image-response.ts";
import { prepareAnnotationMarkup } from "../native/annotation-markup.ts";
import type { ImageRecord } from "../domain/drawing.ts";

export const chatOptions = (c: ConversationRecord) =>
  object(c.settings.options) as Record<string, string>;
export function createChat(services: ApplicationServices, ui: Ui) {
  const evolution=createEvolutionEvents(error=>ui.toast(`版本演进未更新：${message(error)}`,'warn'));
  const finished = new Map<string, number>();
  const assets = new AssetStore(),
    listeners = new Set<() => void>(),
    firstPromptListeners = new Set<(id: string) => void>(),
    titleRevisions = new WeakMap<ConversationRecord, number>(),
    written = new Map<string, string>(),
    removed = new Set<string>();
  let conversations: ConversationRecord[] = [],
    current = conversation.newConversation(
      services.preferences.get<Fields>(names.chatSettings, {}),
    );
  let models: CatalogModel[] = [],
    ready = false,
    loaded = false,
    catalogError = "",
    error = "",
    quote: Quote | null = null,
    quota: QuotaStatus | null = null;
  let busy: {
    cId: string;
    version?: ConversationVersion;
    phase: string;
    startedAt: number;
    controller: AbortController;
  } | null = null;
  let uploading = 0,
    disposed = false,
    catalogRevision = 0,
    quoteRevision = 0,
    storageWarned = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined,
    quoteTimer: ReturnType<typeof setTimeout> | undefined,
    quoteAbort: AbortController | undefined,
    catalogAbort: AbortController | undefined;
  let saving = Promise.resolve(),
    loading: Promise<void> | undefined,
    restoring: Promise<void> | undefined,
    warming: Promise<void> | undefined,
    // Quote and quota requests belong to CHAT itself; ASK only warms it.
    entered = false,
    catalogRequested = false,
    // After an ASK write, quoting waits for the user's next CHAT action.
    held = false;
  /** ASK handoff receipts own the prior conversation state until undo history releases it. */
  const handoffs = new Map<string, { before: ConversationRecord | null; source: string; inputs: Map<string, string> }>();
  // A shared asset hash is not an operation identity. Explicit handoffs bind inputs per conversation.
  const inputSources = new Map<string, Map<string, string>>();
  function bindInput(c: ConversationRecord, asset: string, recordId: string) {
    const inputs = inputSources.get(c.id) ?? new Map<string, string>();
    inputs.set(asset, recordId); inputSources.set(c.id, inputs);
  }
  const reads = new Set<Promise<unknown>>();
  const emit = () => {
    if (!disposed) for (const f of listeners) f();
  };
  const inputImage=(c:ConversationRecord,id:string)=>{const ref=chatInputImage(c,id,true),recordId=inputSources.get(c.id)?.get(id);return recordId?{id:recordId,label:ref.label}:ref;};
  const selected = (c = current) =>
    models.find((m) => m.id === c.settings.model);
  const snapshotFor = (c = current) =>
    conversation.contextSnapshot(
      c,
      c.prompt,
      selected(c)?.maxImages ?? Infinity,
    );
  const collect = () => {
    if (!busy && !uploading) assets.collect([...conversations, ...[...handoffs.values()].flatMap(h => h.before ? [h.before] : [])]);
    for (const [id, at] of finished)
      if (Date.now() - at >= 2000) finished.delete(id);
  };
  const mutable = () => loaded && services.data.phase === "ready" && !disposed;
  function save() {
    if (!loaded || disposed) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flush().catch(() => {}), 400);
  }
  function rename(c: ConversationRecord, title: string) {
    if (!mutable() || !conversations.includes(c) || !conversation.renameConversation(c, title)) return false;
    titleRevisions.set(c, (titleRevisions.get(c) ?? 0) + 1);
    save(); emit();
    return true;
  }
  async function flush(write: Writer = services.data.write) {
    clearTimeout(saveTimer);
    await Promise.allSettled([...reads]);
    clearTimeout(saveTimer);
    const job = saving
      .catch(() => {})
      .then(async () => {
        if (!loaded) return;
        const put = conversations
          // ASK warming never stores the blank placeholder CHAT would create.
          .filter((c) => written.get(c.id) !== JSON.stringify(c) && (entered || written.has(c.id) || !conversation.isBlank(c)))
          .map((c) => structuredClone(c));
        const remove = [...removed];
        if (!put.length && !remove.length) return;
        try {
          await write(async () => {
            const tx = services.databases.transaction(
                names.databases.chat,
                ["conversations", "assets"],
                "readwrite",
              ),
              done = transactionDone(tx);
            void done.catch(() => {});
            const records = tx.objectStore("conversations"),
              images = tx.objectStore("assets");
            try {
              for (const id of remove) records.delete(id);
              for (const c of put) records.put(c);
              const [stored, keys] = await Promise.all([
                idbRequest<ConversationRecord[]>(records.getAll()),
                idbRequest(images.getAllKeys()),
              ]);
              const used = assetRefs(stored),
                have = new Set(keys);
              for (const id of used)
                if (!have.has(id) && assets.assets.has(id))
                  images.put(assets.record(id));
              for (const id of keys)
                if (!used.has(String(id))) images.delete(id);
              await done;
            } catch (e) {
              await done;
              throw e;
            }
          });
          for (const c of put) written.set(c.id, JSON.stringify(c));
          for (const id of remove) {
            removed.delete(id);
            written.delete(id);
          }
          storageWarned = false;
        } catch (e) {
          if (!storageWarned) ui.toast(`对话保存失败：${message(e)}`, "err");
          storageWarned = true;
          throw e;
        }
      });
    saving = job;
    return job;
  }
  async function restore() {
    const tx = services.databases.transaction(names.databases.chat, [
      "conversations",
      "assets",
    ]);
    const [records, images] = await Promise.all([
      idbRequest<ConversationRecord[]>(
        tx.objectStore("conversations").getAll(),
      ),
      idbRequest<AssetRecord[]>(tx.objectStore("assets").getAll()),
    ]);
    assets.clear();
    for (const a of images) assets.adopt(a);
    written.clear();
    removed.clear();
    conversations = records.map((c) => {
      written.set(c.id, JSON.stringify(c));
      return conversation.reviveConversation(c, (id) => assets.assets.has(id));
    });
    const id = services.preferences.get<string | null>(names.chatCurrent, null);
    current =
      conversations.find((c) => c.id === id) ||
      [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0] ||
      conversation.newConversation(
        services.preferences.get(names.chatSettings, {}),
      );
    if (!conversations.includes(current)) conversations.push(current);
    loaded = true;
    emit();
  }
  function normalize(c = current) {
    const wanted = String(c.settings.model || "");
    if (removedModel(services.connections.configuration, wanted)) {
      error = "模型已删除，请重新选择模型";
      return;
    }
    const m = resolveModel(models, wanted) || models[0];
    if (m)
      c.settings = {
        model: m.id,
        options: normalizeOptions(m, chatOptions(c)),
      };
  }
  async function refreshCatalog() {
    catalogRequested = true;
    if (disposed || !loaded || services.data.phase !== "ready") return;
    const revision = ++catalogRevision;
    catalogAbort?.abort();
    catalogAbort = new AbortController();
    const signal = catalogAbort.signal;
    ready = false;
    quota = null;
    cancelQuote();
    emit();
    const configuration = services.connections.configuration;
    const results = await Promise.allSettled(
      imageConnections(configuration).map(
        async ({ id }) =>
          (await services.gateway(id).catalog(false, signal)).models,
      ),
    );
    if (disposed || revision !== catalogRevision || signal.aborted) return;
    const candidates: CatalogModel[] = [];
    catalogError = "";
    for (const r of results)
      if (r.status === "fulfilled") {
        candidates.push(...r.value);
      } else catalogError = message(r.reason);
    models = selectCatalogSources(configuration, chatModels({ models: candidates }));
    normalize();
    ready = !!models.length;
    emit();
    if (!entered || held) return;
    scheduleQuote();
    void refreshQuota();
  }
  const restored = () => (restoring ??= restore());
  /** Stored conversations and the model list, without quote or quota requests.
     The catalog wait is capped; an unready list is reported as such. */
  async function warm() {
    try {
      await restored();
      if (ready || disposed) return;
      const capped = new Promise((resolve) => setTimeout(resolve, 2000));
      warming ??= (entered ? loading! : refreshCatalog()).finally(() => (warming = undefined));
      await Promise.race([warming, capped]);
      // CHAT opening mid-warm supersedes this catalog request.
      if (!ready && entered) await Promise.race([loading, capped]);
    } catch (e) {
      error = message(e);
      emit();
    }
  }
  async function start() {
    entered = true;
    return (loading ??= (async () => {
      try {
        await restored();
        await refreshCatalog();
        save();
      } catch (e) {
        error = message(e);
        emit();
      }
    })());
  }
  function cancelQuote() {
    ++quoteRevision;
    clearTimeout(quoteTimer);
    quoteAbort?.abort();
    quote = null;
  }
  function hold() {
    cancelQuote();
    held = true;
  }
  async function prepare(c: ConversationRecord, turn?: ConversationTurn) {
    const settings = structuredClone(turn?.settings || c.settings),
      model = resolveModel(models, String(settings.model || ""));
    if (!model) throw new Error("请选择可用模型");
    const snapshot = turn
      ? structuredClone(turn.snapshot)
      : conversation.contextSnapshot(c, c.prompt, model.maxImages);
    const prompt = turn ? turn.prompt : c.prompt.trim();
    if (!prompt && !snapshot.annotation) throw new Error("请填写描述或修改要求");
    if (snapshot.imageIds.length > model.maxImages)
      throw new Error(`该模型最多使用 ${model.maxImages} 张图（含底图）`);
    const annotation = snapshot.annotation;
    if(annotation) {
      validateAnnotationSnapshot(annotation.snapshot);
      if (annotation.markup && !model.markupEligible) throw new Error("请选择支持原生标注的模型参考，或切回双图标注");
      if(snapshot.imageIds[0] !== (annotation.markup?.inputAssetId ?? annotation.inputAssetId) || !annotation.markup && !annotation.singleImage && snapshot.imageIds[1]!==annotation.guideAssetId)
        throw new Error("批注改图需要原图和编号图，请换用支持双图的模型，或选择仅方位文字");
      if (annotation.snapshot.references?.some(r=>!annotation.referenceAssets?.some(a=>a.id===r.id)) || annotation.referenceAssets?.some(r => !snapshot.imageIds.includes(r.assetId))) throw new Error('批注参考图超过模型容量或已移除，请调整参考图／模型后再发送');
      if(!assets.assets.has(annotation.sourceAssetId)) throw new Error("批注原图已失效");
    }
    const encoded = await assets.encode([...snapshot.imageIds, ...(annotation?.markup ? [annotation.markup.overlayAssetId] : [])]);
    const markup = annotation?.markup ? encoded.pop() : undefined;
    return {
      payload: { ...buildChatPayload(
        model,
        snapshot.text,
        object(settings.options) as Record<string, string>,
        encoded,
      ), ...(markup ? { markup_image: markup } : {}) },
      snapshot,
      prompt,
      settings,
      model,
    };
  }
  function scheduleQuote() {
    cancelQuote();
    held = false;
    error = removedModel(services.connections.configuration, String(current.settings.model || ""))
      ? "模型已删除，请重新选择模型" : "";
    emit();
    const c = current,
      rev = quoteRevision;
    if (error || !mutable() || !ready || (!c.prompt.trim() && !c.pendingAnnotation) || busy || uploading) return;
    quoteTimer = setTimeout(async () => {
      const controller = (quoteAbort = new AbortController());
      try {
        const p = await prepare(c);
        controller.signal.throwIfAborted();
        const source = await services.selectSource(p.model, controller.signal, p.payload, "chat");
        if (rev !== quoteRevision || current !== c || disposed) return;
        applySource(source);
        quote = source.quote;
        if (source.insufficient) throw new Error("所有可用来源的额度均不足");
      } catch (e) {
        if (rev === quoteRevision && !controller.signal.aborted)
          error = message(e);
      }
      if (rev === quoteRevision) emit();
    }, 650);
  }
  function applySource(source: SourceSelection) {
    models = models.map(m => m.id === source.model.id ? source.model : m);
    if (selected()?.id === source.model.id) {
      quotaModel = source.model;
      quota = source.quota;
    }
  }
  async function refreshQuota() {
    const m = selected();
    if (quotaModel !== m) {
      quotaModel = m;
      quota = null;
      emit();
    }
    if (!m || !ready || services.data.phase !== "ready") return;
    try {
      const source = await services.selectSource(m, undefined, undefined, "chat");
      if (selected() === m) {
        applySource(source);
        emit();
      }
    } catch {
      if (selected() === m) {
        quota = null;
        emit();
      }
    }
  }
  let quotaModel: CatalogModel | undefined;
  function changed(context = false) {
    if (context) current.selectionRevision++;
    save();
    scheduleQuote();
    collect();
    emit();
  }
  /** Switch without quoting; ASK writes leave that to the user. */
  function show(c: ConversationRecord) {
    current = c;
    if (quotaModel !== selected()) quota = null;
    void services.preferences
      .set(names.chatCurrent, c.id)
      .catch((e) => ui.toast(message(e), "err"));
  }
  function switchConversation(c: ConversationRecord) {
    if (!mutable() || !conversations.includes(c)) return;
    current = c;
    normalize();
    void services.preferences
      .set(names.chatCurrent, c.id)
      .catch((e) => ui.toast(message(e), "err"));
    scheduleQuote();
    void refreshQuota();
    emit();
  }
  function addConversation() {
    if (!mutable()) return;
    let c = conversations.find(conversation.isBlank);
    if (c) c.updatedAt = Date.now();
    else {
      c = conversation.newConversation(current.settings);
      conversations.push(c);
    }
    switchConversation(c);
    save();
  }
  async function execute(existing?: ConversationTurn) {
    if (
      !mutable() ||
      !ready ||
      busy ||
      uploading ||
      (!existing && !current.prompt.trim() && !current.pendingAnnotation)
    )
      return;
    const c = current,
      shownCost = existing ? null : (quote?.cost ?? null),
      controller = new AbortController();
    busy = { cId: c.id, phase: "校验报价", startedAt: Date.now(), controller };
    cancelQuote();
    emit();
    let turn: ConversationTurn | undefined,
      version: ConversationVersion | undefined;
    const timer = setTimeout(
      () => controller.abort(new DOMException("请求超时", "TimeoutError")),
      240_000,
    );
    try {
      const p = await prepare(c, existing);
      const sourceAsset=p.snapshot.annotation?.sourceAssetId??p.snapshot.base;
      const retryInput = existing?.versions[existing.selectedVersion]?.evolutionInput;
      const frozenBase = retryInput?.base !== undefined ? retryInput.base : sourceAsset ? inputImage(c, sourceAsset) : null;
      const frozenReferences = retryInput?.references ?? p.snapshot.refs.filter(id => id !== p.snapshot.annotation?.guideAssetId).map(id => inputImage(c, id));
      const landed=evolution.begin(evolutionTarget('chat',c.id), frozenBase?.id ?? null, true, frozenReferences.map(ref => ref.id));
      const frozenMask=await evolutionMask(p.snapshot.annotation&&p.snapshot.annotation.snapshot.regions.length&&p.snapshot.annotation.snapshot.regions.every(r=>r.shape!=='point')?annotationMask(p.snapshot.annotation.snapshot):null);
      controller.signal.throwIfAborted();
      const result = await services.runTask(
        {
          id: crypto.randomUUID(),
          workspace: "chat",
          sessionId: c.id,
          snapshot: p.payload,
        },
        async (task) => {
          if (existing) {
            turn = existing;
            version = conversation.beginVersion(turn);
          } else {
            ({ turn, version } = conversation.beginTurn(
              c,
              p.snapshot,
              p.prompt,
              p.settings,
            ));
            c.prompt = "";
          }
          version!.evolutionInput={...chatEvolutionInput(c,turn!,version!),base:frozenBase,references:frozenReferences,params:{model:p.model.id,...normalizeOptions(p.model,object(p.settings.options) as Record<string,string>)},mask:frozenMask,...(p.snapshot.annotation?{annotations:JSON.stringify(p.snapshot.annotation.snapshot.regions),params:{model:p.model.id,...normalizeOptions(p.model,object(p.settings.options) as Record<string,string>),...p.snapshot.annotation.snapshot.edges}}:{})};
          const revision = c.selectionRevision;
          Object.assign(busy!, {
            version,
            phase: "生成中",
            startedAt: Date.now(),
          });
          save();
          emit();
          if (!existing && c.turns.length === 1) for (const listener of firstPromptListeners) {
            try { listener(c.id); }
            catch (error) { ui.toast(`自动命名未启动：${message(error)}`, "warn"); }
          }
          const output = await task.execute(
            p.model, p.payload,
            (response, native, signal) => {
              if (busy) busy.phase = "图片加载中";
              emit();
              return consumeMedia(response, native, signal, p.payload);
            },
            {
              shownCost,
              onNotice: (notice) => ui.toast(notice),
              signal: controller.signal,
              onSource: source => {
                p.model = source.model;
                if (current === c) {
                  applySource(source);
                  quote = source.quote;
                  emit();
                }
              },
            },
          );
          const blocks: MessageBlock[] = [];
          for (const block of output.value) {
            if (block.type === "text") {
              blocks.push(block);
              continue;
            }
            const a = await assets.add(
              block.blob,
              `Koma-${c.turns.indexOf(turn!) + 1}-v${turn!.versions.indexOf(version!) + 1}`,
              block.size,
            );
            blocks.push({ type: "image", assetId: a.id });
          }
          task.signal.throwIfAborted();
          conversation.completeVersion(
            c,
            turn!,
            version!,
            blocks,
            output.quote as Fields,
            revision,
          );
          if (c.selectionRevision === revision && !turn!.snapshot.annotation && (c.baseFollows || !sourceAsset)) {
            const image = blocks.find(b => b.type === 'image');
            if (image?.type === 'image') bindInput(c, image.assetId, chatImageId(c.id, turn!.id, version!.id, image.assetId));
          }
          version!.via = output.via;
          finished.set(version!.id, Date.now());
          for(const block of blocks)if(block.type==='image')landed(chatImageId(c.id,turn!.id,version!.id,block.assetId));
          // Native CHAT decides which image becomes the next base (held base,
          // multi-image response and annotation review included).
          if(c.mainId)evolution.move(evolutionTarget('chat',c.id),inputImage(c,c.mainId).id);
          save();
          emit();
        },
        controller.signal,
      );
      if (result.status !== "completed")
        ui.toast(
          result.status === "busy"
            ? "另一个绘图任务正在进行"
            : "数据维护中，请稍后再试",
          "warn",
        );
    } catch (e) {
      if (version) {
        version.status =
          e instanceof DOMException && e.name === "AbortError"
            ? "cancelled"
            : "error";
        version.error =
          version.status === "cancelled"
            ? "已取消；上游可能仍在处理或计费。"
            : message(e);
      } else ui.toast(message(e), "err");
    } finally {
      clearTimeout(timer);
      busy = null;
      collect();
      save();
      emit();
      scheduleQuote();
      void refreshQuota();
    }
  }
  async function upload(files: File[], projectSource?: import('../storage/records.ts').AssetRecord['projectSource']) {
    if (!mutable() || !files.length) return;
    const c = current;
    uploading++;
    cancelQuote();
    emit();
    const work = (async () => {
      try {
        const m = selected(c);
        if (!m) throw new Error("请先连接并选择模型");
        if (snapshotFor(c).imageIds.length + files.length > m.maxImages)
          throw new Error(`该模型最多使用 ${m.maxImages} 张图（含底图）`);
        const added = [];
        for (const f of files) {
          const asset = await assets.add(f, f.name || "粘贴图片");
          if (projectSource) asset.projectSource = { ...projectSource };
          added.push(asset);
        }
        if (!conversations.includes(c)) return;
        for (const a of added) conversation.attachUpload(c, a.id);
        c.selectionRevision++;
      } catch (e) {
        ui.toast(message(e), "err");
      } finally {
        uploading--;
        collect();
        save();
        scheduleQuote();
        emit();
      }
    })();
    reads.add(work);
    try {
      await work;
    } finally {
      reads.delete(work);
    }
  }
  async function claim(ticket: string) {
    await start();
    if (!ready || !mutable()) return false;
    uploading++;
    emit();
    let accepted: { target: string; recordId: string } | undefined;
    const work = (async () => {
      try {
        const item = await createHandoff(services).take(ticket);
        if (!item) {
          ui.toast("图片已失效，请从绘图页重新发送", "warn");
          return;
        }
        const a = await assets.add(item.blob, item.name, undefined, "image");
        addConversation();
        conversation.attachUpload(current, a.id);
        if (item.source) bindInput(current, a.id, item.source.recordId);
        current.selectionRevision++;
        save();
        emit();
        if (item.source) accepted = { target: evolutionTarget('chat', current.id), recordId: item.source.recordId };
      } catch (e) {
        ui.toast(`图片导入失败：${message(e)}`, "err");
      } finally {
        uploading--;
        scheduleQuote();
      }
    })();
    reads.add(work);
    try {
      await work;
    } finally {
      reads.delete(work);
    }
    // flush waits for reads, so it must run after this import has left that set.
    try {
      await flush();
      if (accepted) evolution.handoff(accepted.target, accepted.recordId);
    } catch { /* flush already reports storage failure; the imported image stays available. */ }
    return true;
  }
  const unregister = services.data.register({
    flush,
    async reload() {
      if (loaded) await restore();
    },
    ready() {
      if (loaded && catalogRequested && !disposed) void refreshCatalog();
    },
  });
  const unconnect = services.connections.subscribeImages(() => {
    if (loaded && catalogRequested && services.data.phase === "ready") void refreshCatalog();
  });
  const hide = () => {
    if (document.visibilityState === "hidden") void flush().catch(() => {});
  };
  const leave = (e: BeforeUnloadEvent) => {
    if (busy || uploading) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  const pagehide = () => void flush().catch(() => {});
  window.addEventListener("beforeunload", leave);
  window.addEventListener("pagehide", pagehide);
  document.addEventListener("visibilitychange", hide);
  return {
    assets,
    onEvolution: evolution.subscribe,
    onEvolutionMove: evolution.onMove,
    onEvolutionHandoff: evolution.onHandoff,
    evolutionSource(id:string) {const c=conversations.find(c=>c.id===id);return c?.mainId?inputImage(c,c.mainId).id:null;},
    async restoreEvolution(conversationId:string,turnId:string,versionId:string,assetId:string) {
      const c=conversations.find(c=>c.id===conversationId),t=c?.turns.find(t=>t.id===turnId),v=t?.versions.find(v=>v.id===versionId);
      if(!mutable()||busy||uploading||!c||!t||v?.status!=='done'||!assets.assets.has(assetId)||!v.blocks.some(b=>b.type==='image'&&b.assetId===assetId)&&!Object.values(v.composites??{}).includes(assetId))throw new Error('对话图片不可恢复');
      const old=conversation.chatSelection(c), previous=current;
      hold();show(c);
      const next={...old,headId:t.id,mainId:assetId,baseFollows:true,selectedVersions:{...old.selectedVersions,[t.id]:t.versions.indexOf(v)}};
      try {await this.writeBranchDraft(next,conversation.chatDraftKey(c),false);}
      catch(error){show(previous);emit();throw error;}
    },
    isFresh(id: string) {
      return Date.now() - (finished.get(id) || 0) < 2000;
    },
    start,
    /** Local data only; HOME must not warm catalogs, quotes or balances. */
    readStored: restored,
    async favoriteRecord(conversationId: string, turnId: string, versionId: string, assetId: string): Promise<ImageRecord> {
      const c = conversations.find(c => c.id === conversationId), turn = c?.turns.find(t => t.id === turnId);
      const version = turn?.versions.find(v => v.id === versionId), asset = assets.assets.get(assetId);
      if (!c || !turn || !version || version.status !== "done" || !asset || (!version.blocks.some(b => b.type === "image" && b.assetId === assetId) && !Object.values(version.composites??{}).includes(assetId)))
        throw new Error("这张对话图片已不可用");
      const params: Fields = { ...chatImageOrigin(c, turn, version, assetId), tool: "chat", model: String(turn.settings.model ?? ""),
        modelName: models.find(m => m.id === turn.settings.model)?.name ?? String(turn.settings.model ?? ""),
        evolutionInput:JSON.parse(JSON.stringify(chatEvolutionInput(c,turn,version,assetId,asset))), prompt: turn.prompt, chat_options: structuredClone(object(turn.settings.options)) as Fields, width: asset.width, height: asset.height };
      const record = { entity_key: `sha256:${asset.id}`, lineage: { via: "chat" as const }, id: chatImageId(c.id, turn.id, version.id, asset.id), createdAt: version.completedAt ?? Date.now(), blob: asset.blob,
        size: { width: asset.width, height: asset.height }, params, quote: version.quote ? structuredClone(version.quote) : null };
      const thumbBlob = await makeThumb(asset.blob);
      if (disposed || !conversations.includes(c) || !c.turns.includes(turn) || !turn.versions.includes(version)) throw new Error("来源对话已变化");
      return { ...record, thumbBlob };
    },
    warm,
    flush,
    refreshCatalog,
    refreshQuota,
    execute,
    upload,
    claim,
    snapshot: () => ({
      conversations: conversation.sortConversations(conversations),
      current: {
        ...current,
        settings: { ...current.settings },
        turns: [...current.turns],
        attachments: [...current.attachments],
        keepIds: [...current.keepIds],
        skipTurnIds: [...current.skipTurnIds],
      },
      models,
      model: selected(),
      ready,
      loaded,
      error,
      catalogError,
      quote,
      quota,
      busy: busy
        ? {
            cId: busy.cId,
            versionId: busy.version?.id,
            phase: busy.phase,
            startedAt: busy.startedAt,
          }
        : null,
      uploading,
      context: snapshotFor(),
    }),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Emitted only for the first admitted user request, before image generation. */
    onFirstPrompt(fn: (id: string) => void) {
      firstPromptListeners.add(fn);
      return () => firstPromptListeners.delete(fn);
    },
    captureName(id: string) {
      const c = conversations.find(c => c.id === id);
      if (!c || !mutable()) return null;
      const title = c.title, renamed = c.renamed, revision = titleRevisions.get(c);
      const valid = () => mutable() && conversations.includes(c) && c.title === title && c.renamed === renamed && titleRevisions.get(c) === revision;
      return {
        renamed,
        turns: c.turns.map(t => ({ question: t.prompt, reply: t.versions[t.selectedVersion]?.status === "done"
          ? t.versions[t.selectedVersion].blocks.flatMap(b => b.type === "text" ? [b.text] : []).join("\n") : "" })),
        valid,
        async apply(name: string) {
          if (!valid() || !rename(c, name)) return false;
          const appliedRevision = titleRevisions.get(c);
          try { await flush(); }
          catch (error) {
            if (conversations.includes(c) && titleRevisions.get(c) === appliedRevision) {
              c.title = title; c.renamed = renamed;
              titleRevisions.set(c, (appliedRevision ?? 0) + 1);
              save(); emit();
            }
            throw error;
          }
          return true;
        },
      };
    },
    cancel() {
      busy?.controller.abort(new DOMException("已取消", "AbortError"));
    },
    setPrompt(text: string) {
      if (!mutable()) return;
      current.prompt = text;
      changed();
    },
    /** Plain composer drafts only; branch/context operations belong to ASK A3. */
    async writeDraft(text: string, conversationId: string, expected: string) {
      if (!mutable() || current.id !== conversationId || current.prompt !== expected) throw new Error("对话已变化，草稿未写入");
      const owner = current;
      hold();
      owner.prompt = text;
      save();
      emit();
      try { await flush(); }
      catch (error) {
        if (owner.prompt === text) owner.prompt = expected;
        save(); emit(); throw error;
      }
    },
    async writeBranchDraft(next: conversation.ChatSelection, expected: string, track=true) {
      if (!mutable() || busy || conversation.chatDraftKey(current) !== expected) throw new Error("会话或上下文已变化，草稿未写入");
      if (next.mainId && !assets.assets.has(next.mainId)) throw new Error("分支底图已不可用");
      const owner = current, before = conversation.chatSelection(owner);
      hold();
      const turn = owner.turns.find((t) => t.id === next.headId);
      if (turn && next.mainId) conversation.selectSource(owner, turn, next.mainId);
      else owner.selectionRevision += 1;
      conversation.applyChatSelection(owner, next);
      const applied = conversation.chatDraftKey(owner);
      emit();
      try { await flush(); }
      catch (error) {
        if (conversation.chatDraftKey(owner) === applied) { conversation.applyChatSelection(owner, before); owner.selectionRevision += 1; }
        save(); emit(); throw error;
      }
      if (next.mainId) bindInput(owner, next.mainId, chatInputImage(owner, next.mainId, true).id);
      if(track&&next.mainId)evolution.move(evolutionTarget('chat',owner.id),inputImage(owner,next.mainId).id);
      return applied;
    },
    async prepareEditorImages(source: {blob:Blob;name:string;recordId:string;entity_key?:string}, references: readonly import('../domain/edit-references.ts').ReferenceImage[], prompt: string, conversationId?: string) {
      await warm();
      const previous=current,target=conversations.find(c=>c.id===conversationId);
      if(target?.pendingAnnotation)throw new Error('来源对话有待处理批注，请先处理或选择新对话');
      if(target)switchConversation(target);
      const {referenceInstructions}=await import('../domain/edit-references.ts');
      try {
        const m=selected();if(!m)throw new Error('请选择 CHAT 图像模型');
        await this.writeHandoffDraft({...(target?{current:{id:target.id,key:conversation.chatDraftKey(target)}}:{}),model:m.id,options:chatOptions(current),
          text:[target?.prompt,prompt,referenceInstructions(references,2)].filter(Boolean).join('\n'),
          images:[{blob:source.blob,name:source.name,lineage:{via:'upload',parent_record_id:source.recordId,parent_entity_key:source.entity_key}},...references.map(r=>({blob:r.blob,name:r.name}))]});
      } catch(error) { if(target&&current===target&&conversations.includes(previous))switchConversation(previous); throw error; }
    },
    /** Into the image's own conversation while it exists; otherwise the blank one is reused or a new one opens. Nothing is sent. */
    async prepareAnnotations(source: Blob, guide: Blob, snapshot: AnnotationSnapshot, origin?: AnnotationTarget['chat'], references: readonly import('../domain/edit-references.ts').ReferenceImage[] = []) {
      validateAnnotationSnapshot(snapshot);annotationPrompt(snapshot.regions,true,'',undefined,references);await warm();
      if(!mutable()||uploading||busy)throw new Error("请等待对话处理完成");
      const from=current, revision=from.selectionRevision;
      let target:ConversationRecord|undefined, before:ConversationRecord|undefined;
      uploading++;hold();emit();
      try {
        const original=await assets.add(source,'批注原图',{width:snapshot.width,height:snapshot.height},'image');
        if(original.entity_key!==snapshot.image.entity_key)throw new Error("批注原图身份不一致");
        const fitted=await fitReference(source,'批注原图.png'), preview=await fitReference(guide,'编号定位图.png');
        const input=await assets.add(fitted.blob,fitted.name,undefined,'image'), marked=await assets.add(preview.blob,preview.name,undefined,'image');
        const referenceAssets = [];
        for (const r of references) { const fitted = await fitReference(r.blob, r.name), asset = await assets.add(fitted.blob, r.name, undefined, 'image'); referenceAssets.push({id:r.id,assetId:asset.id}); }
        if(!mutable()||from!==current||from.selectionRevision!==revision)throw new Error("对话已切换，未写入批注");
        target=conversations.find(c=>c.id===origin?.conversationId) ?? conversations.find(conversation.isBlank);
        if(target)before=structuredClone(target);else{target=conversation.newConversation(current.settings);conversations.push(target);}
        conversation.clearPendingAnnotation(target);
        const text="";
        target.pendingAnnotation={snapshot:{...structuredClone(snapshot),references:references.map(({blob:_blob,...r})=>r)},sourceAssetId:original.id,inputAssetId:input.id,guideAssetId:marked.id,text,...(referenceAssets.length ? {referenceAssets} : {})};
        target.mainId=input.id;
        if(origin?.turnId&&target.turns.some(t=>t.id===origin.turnId))target.headId=origin.turnId;
        target.attachments=[...new Set([marked.id,...referenceAssets.map(r=>r.assetId),...target.attachments.filter(id=>id!==marked.id&&id!==input.id)])];
        target.keepIds=target.keepIds.filter(id=>id!==marked.id&&id!==input.id);
        target.selectionRevision++;target.updatedAt=Date.now();
        bindInput(target, original.id, snapshot.image.record_id);
        bindInput(target, input.id, snapshot.image.record_id);
        show(target);emit();await flush();
        evolution.handoff(evolutionTarget('chat', target.id), snapshot.image.record_id);
      } catch(e) {
        if(target){if(before){delete target.pendingAnnotation;Object.assign(target,before);}else conversations=conversations.filter(c=>c!==target);if(conversations.includes(from))show(from);}
        throw e;
      } finally {uploading--;collect();save();emit();}
    },
    annotationTextOnly(on: boolean) {
      if(!mutable()||busy||uploading)return;const a=current.pendingAnnotation;if(!a)return;
      if(a.text) current.prompt=current.prompt.replace(a.text,'').trim();
      a.text='';a.singleImage=on;delete a.markup;changed(true);
    },
    async annotationMarkup() {
      if (!mutable() || busy || uploading || !current.pendingAnnotation) return;
      const owner = current, annotation = owner.pendingAnnotation!, model = selected(), revision = owner.selectionRevision;
      if (!model?.markupEligible) return;
      uploading++; hold(); emit();
      try {
        const pair = await prepareAnnotationMarkup(assets.get(annotation.sourceAssetId).blob, annotation.snapshot);
        const size = { width: pair.width, height: pair.height };
        const input = await assets.add(pair.input, '原生标注原图.png', size, 'image');
        const overlay = await assets.add(pair.markup, '透明标注层.png', size, 'image');
        if (!mutable() || owner !== current || owner.pendingAnnotation !== annotation || owner.selectionRevision !== revision || selected()?.id !== model.id)
          throw new Error('图片或模型已变化，未切换标注方式');
        annotation.singleImage = false;
        annotation.markup = { inputAssetId: input.id, overlayAssetId: overlay.id };
        annotation.text = ''; changed(true);
      } catch (e) { if (owner === current) error = message(e); }
      finally { uploading--; collect(); save(); emit(); if (owner === current && annotation.markup) scheduleQuote(); }
    },
    annotationComment(key: string, comment: string) {
      if(!mutable()||busy||uploading)return;const a=current.pendingAnnotation;if(!a)return;
      const regions=a.snapshot.regions.map(r=>r.key===key?{...r,comment}:r);validateRegions(regions);
      if(a.text) current.prompt=current.prompt.replace(a.text,'').trim();
      a.text='';a.snapshot={...a.snapshot,regions};changed(true);
    },
    clearAnnotations(){if(!mutable()||busy||uploading)return;conversation.clearPendingAnnotation(current);changed(true);},
    annotationReview(conversationId:string,turnId:string,versionId:string,assetId:string):AnnotationReview {
      const c=conversations.find(c=>c.id===conversationId),turn=c?.turns.find(t=>t.id===turnId),v=turn?.versions.find(v=>v.id===versionId),a=turn?.snapshot.annotation;
      if(!c||!turn||!v||v.status!=='done'||!a||!v.blocks.some(b=>b.type==='image'&&b.assetId===assetId))throw new Error("批注改图记录已失效");
      validateAnnotationAreas(a.snapshot.regions);
      const raw=assets.get(assetId),source=assets.get(a.sourceAssetId),snapshot=structuredClone(a.snapshot),revision=c.selectionRevision;
      const previousComposite=v.composites?.[assetId];
      const landed=evolution.begin(evolutionTarget('chat',c.id),chatImageId(c.id,turn.id,v.id,assetId));
      const alive=()=>conversations.includes(c)&&c.turns.includes(turn)&&turn.versions.includes(v)&&v.blocks.some(b=>b.type==='image'&&b.assetId===assetId);
      const valid=()=>current===c&&alive()&&v.composites?.[assetId]===previousComposite;
      return {source:source.blob,raw:raw.blob,snapshot,title:'审核批注改图',key:`${conversationId}:${turnId}:${versionId}:${assetId}`,valid,alive,apply:async(blob,settings={colorMatch:true,method:'local'})=>{
        if(!valid())throw new Error('改图记录已变化，请重新打开');
        if(!mutable()||busy||uploading||!conversations.includes(c))throw new Error("对话暂不可写入");
        if(!annotationAlignment(snapshot,raw))throw new Error("模型直出的方向或宽高比不符，无法应用蒙版");
        uploading++;emit();
        const old=v.composites?.[assetId],oldSettings=v.compositeSettings?.[assetId],previousMain=c.mainId,previousHead=c.headId;
        try{
          const size=await decodeImage(blob);if(blob.type!=='image/png'||size.width!==snapshot.width||size.height!==snapshot.height)throw new Error("回贴结果尺寸或格式无效");
          const result=await assets.add(blob,`${raw.name}-回贴.png`,{width:snapshot.width,height:snapshot.height});
          if(!mutable()||!valid())throw new Error("改图记录已变化");
          v.composites={...v.composites,[assetId]:result.id};
          v.compositeSettings={...v.compositeSettings,[assetId]:{...settings,boundaryColorVersion:1}};
          if(current===c&&c.selectionRevision===revision&&c.baseFollows){c.mainId=result.id;c.headId=turn.id;c.selectionRevision++;bindInput(c,result.id,chatImageId(c.id,turn.id,v.id,result.id));}
          c.updatedAt=Date.now();await flush();emit();landed(chatImageId(c.id,turn.id,v.id,result.id));
          if(c.mainId)evolution.move(evolutionTarget('chat',c.id),inputImage(c,c.mainId).id);
        }catch(e){if(oldSettings)v.compositeSettings={...v.compositeSettings,[assetId]:oldSettings};else if(v.compositeSettings)delete v.compositeSettings[assetId];if(old)v.composites={...v.composites,[assetId]:old};else if(v.composites)delete v.composites[assetId];if(c.mainId!==previousMain&&c.selectionRevision===revision+1){c.mainId=previousMain;c.headId=previousHead;c.selectionRevision=revision;}throw e;}
        finally{uploading--;collect();save();emit();}
      }};
    },
    async writeHandoffDraft(draft: {
      current?: { id: string; key: string };
      model: string;
      options: Readonly<Record<string, string>>;
      text: string;
      images: readonly ({ asset: string; recordId?: string } | { blob: Blob; name: string; lineage?: import("../domain/image-identity.ts").ImageLineage; projectSource?: import('../storage/records.ts').AssetRecord['projectSource'] })[];
    }, track = true) {
      const model = () => models.find((m) => m.id === draft.model),
        missing = () => draft.images.some((i) => "asset" in i && !assets.assets.has(i.asset));
      const contextIssue = () => !draft.current ? '' : current.id !== draft.current.id || conversation.chatDraftKey(current) !== draft.current.key ? '会话或上下文已变化，请重新提议' : busy?.cId === current.id ? '当前对话正在生成，暂不能修改图片组合' : current.pendingAnnotation ? '当前对话有未处理的批注' : '';
      if (contextIssue()) throw new Error(contextIssue());
      if (!mutable() || uploading) throw new Error("对话正在导入图片或暂不可写入，草稿未写入");
      if (!model()) throw new Error("对话模型已变化，草稿未写入");
      if (draft.images.length > model()!.maxImages) throw new Error(`该模型最多使用 ${model()!.maxImages} 张图`);
      if (missing()) throw new Error("参考图已不可用");
      hold();
      const ids: string[] = [];
      let failure: unknown = null;
      uploading++;
      emit();
      const work = (async () => {
        for (const image of draft.images) {
          if ("asset" in image) ids.push(image.asset);
          else {
            const fitted = await fitReference(image.blob, image.name);
            const asset=await assets.add(fitted.blob, fitted.name, undefined, "image");
            if(image.projectSource) asset.projectSource={...image.projectSource};
            if(image.lineage && !asset.lineage) asset.lineage={...image.lineage,...(asset.entity_key!==image.lineage.parent_entity_key?{tool_detail:'reference-fit'}:{})};
            ids.push(asset.id);
          }
        }
      })();
      reads.add(work);
      try {
        await work;
      } catch (error) {
        failure = error;
      } finally {
        reads.delete(work);
        uploading--;
      }
      const m = model();
      const imageIssue = m && ids.length > m.maxImages ? `该模型最多使用 ${m.maxImages} 张图` : new Set(ids).size !== ids.length ? '图片转换后出现重复，请重新提议图片组合' : '';
      if (failure || !mutable() || !m || missing() || contextIssue() || imageIssue) {
        collect();
        emit();
        throw failure ?? new Error(contextIssue() || imageIssue || (!m ? "对话模型已变化，草稿未写入" : "参考图已不可用"));
      }
      const source = current,
        blank = draft.current ? current : conversations.find(conversation.isBlank),
        before = blank ? structuredClone(blank) : null,
        target = blank ?? conversation.newConversation();
      const priorInputs = new Map(inputSources.get(target.id));
      if (!blank) conversations.push(target);
      draft.images.forEach((image, index) => { const recordId = "asset" in image ? image.recordId : image.lineage?.parent_record_id; if (recordId) bindInput(target, ids[index], recordId); });
      target.settings = { model: m.id, options: normalizeOptions(m, { ...chatOptions(source), ...draft.options }) };
      if (draft.current) { target.keepIds = []; target.attachments = []; }
      for (const id of ids) conversation.attachUpload(target, id);
      target.mainId = ids[0] ?? null;
      target.prompt = draft.text;
      target.selectionRevision++;
      target.updatedAt = Date.now();
      show(target);
      const applied = conversation.chatDraftKey(target);
      emit();
      try {
        await flush();
      } catch (error) {
        if (conversation.chatDraftKey(target) === applied) {
          if (before) Object.assign(target, before, { selectionRevision: target.selectionRevision + 1 });
          else conversations = conversations.filter((c) => c !== target);
          if (current === target && conversations.includes(source)) show(source);
        }
        inputSources.set(target.id, priorInputs);
        collect();
        save();
        emit();
        throw error;
      }
      handoffs.set(applied, { before, source: source.id, inputs: priorInputs });
      while (handoffs.size > 50) handoffs.delete(handoffs.keys().next().value!);
      if(track&&ids[0])evolution.handoff(evolutionTarget('chat',target.id),inputImage(target,ids[0]).id);
      return applied;
    },
    /** Restore the prior context or remove a newly created conversation, only while unchanged. */
    async undoHandoffDraft(receipt: string, track = true) {
      const id = String(JSON.parse(receipt)[0]),
        target = conversations.find((c) => c.id === id),
        origin = handoffs.get(receipt);
      if (!mutable()) throw new Error("对话暂不可写入");
      if (!target) throw new Error("目标对话已删除");
      if (!origin) throw new Error("交接撤销记录已释放");
      if (busy?.cId === target.id) throw new Error("当前对话正在生成，暂不能回退");
      if (conversation.chatDraftKey(target) !== receipt) throw new Error("新对话已继续编辑");
      hold();
      const list = conversations,
        shown = current,
        fields = structuredClone(target),
        dropped = !origin?.before;
      if (origin?.before) Object.assign(target, structuredClone(origin.before), { selectionRevision: target.selectionRevision + 1 });
      else {
        conversations = conversations.filter((c) => c !== target);
        removed.add(id);
      }
      if (current === target || !conversations.includes(current)) {
        const next =
          conversations.find((c) => c.id === origin?.source) ??
          conversation.sortConversations(conversations)[0];
        if (next) show(next);
        else {
          const blank = conversation.newConversation(services.preferences.get(names.chatSettings, {}));
          conversations.push(blank);
          normalize(blank);
          show(blank);
        }
      }
      emit();
      try {
        await flush();
      } catch (error) {
        conversations = list;
        // The exact applied state, so the same receipt can retry this undo.
        if (dropped) removed.delete(id);
        else Object.assign(target, fields);
        show(shown);
        save();
        emit();
        throw error;
      }
      inputSources.set(target.id, new Map(origin.inputs));
      handoffs.delete(receipt);
      if (track && target.mainId && conversations.includes(target)) evolution.move(evolutionTarget('chat',target.id),inputImage(target,target.mainId).id);
      collect();
      return conversation.chatDraftKey(current);
    },
    /** The shared ASK undo stack owns these snapshots and their original assets. */
    retainHandoffDrafts(receipts: readonly string[]) {
      const keep = new Set(receipts);
      for (const key of handoffs.keys()) if (!keep.has(key)) handoffs.delete(key);
      collect();
    },
    rebaseHandoffDraft(before: string, after: string) {
      const origin = handoffs.get(before);
      if (origin) { handoffs.delete(before); handoffs.set(after, origin); }
    },
    /** Read-only for the writer's synchronous undo preflight. */
    handoffOrigin: (receipt: string) => {
      const o = handoffs.get(receipt);
      return o ? { before: o.before && structuredClone(o.before), source: o.source } : null;
    },
    setModel(id: string) {
      if (!mutable()) return;
      const m = models.find((m) => m.id === id);
      if (!m) return;
      current.settings = {
        model: m.id,
        options: normalizeOptions(m, current.settings.model === id ? chatOptions(current) : {}),
      };
      void services.preferences
        .set(names.chatSettings, current.settings)
        .catch(() => {});
      changed();
      void refreshQuota();
      const cut = snapshotFor().dropped.length;
      if (cut)
        ui.toast(
          `${m.name} 每轮最多使用 ${m.maxImages} 张图，其余 ${cut} 张不会发送，可在上下文中调整顺序`,
          "warn",
        );
    },
    setOption(key: string, value: string) {
      if (!mutable()) return;
      current.settings.options = { ...chatOptions(current), [key]: value };
      void services.preferences
        .set(names.chatSettings, current.settings)
        .catch(() => {});
      changed();
    },
    addConversation,
    switchConversation,
    locateImage(conversationId: string, turnId: string, versionId: string, assetId: string) {
      if (!mutable()) return false;
      const c=conversations.find(c=>c.id===conversationId), t=c?.turns.find(t=>t.id===turnId), index=t?.versions.findIndex(v=>v.id===versionId) ?? -1;
      if (!c || !t || index<0 || (!t.versions[index].blocks.some(b=>b.type==="image" && b.assetId===assetId) && !Object.values(t.versions[index].composites??{}).includes(assetId))) return false;
      switchConversation(c); t.selectedVersion=index; c.headId=t.id; changed(true); return true;
    },
    rename,
    pin(c: ConversationRecord) {
      if (mutable()) {
        c.pinned = !c.pinned;
        save();
        emit();
      }
    },
    duplicate(c: ConversationRecord) {
      if (!mutable()) return;
      if (busy?.cId === c.id) {
        ui.toast("正在生成，请完成后再复制");
        return;
      }
      const copy = conversation.duplicateConversation(c);
      conversations.push(copy);
      switchConversation(copy);
      save();
    },
    async remove(c: ConversationRecord) {
      if (!mutable()) return;
      if (busy?.cId === c.id) {
        ui.toast("正在生成，请先停止再删除");
        return;
      }
      if (
        !(await ui.confirm({
          title: `删除「${c.title}」？`,
          message: "对话和其中的图片会一起删除，无法撤销。",
          confirmLabel: "删除",
          tone: "danger",
        }))
      )
        return;
      if (!mutable() || busy?.cId === c.id) return;
      removed.add(c.id);
      conversations = conversations.filter((v) => v !== c);
      if (current === c) {
        const next = conversation.sortConversations(conversations)[0];
        if (next) switchConversation(next);
        else addConversation();
      }
      collect();
      save();
      emit();
    },
    mutate(fn: (c: ConversationRecord) => void, selection = false) {
      if (!mutable()) return;
      const old=current.mainId;fn(current);
      if(selection&&current.mainId&&old!==current.mainId)evolution.move(evolutionTarget('chat',current.id),inputImage(current,current.mainId).id);
      if(current.pendingAnnotation && current.mainId!==current.pendingAnnotation.inputAssetId) conversation.clearPendingAnnotation(current);
      changed(selection);
    },
    setBase(id: string) {
      if (!mutable() || conversation.isAnnotationGuide(current,id)) return;
      const old = current.mainId;
      if(current.pendingAnnotation && current.pendingAnnotation.inputAssetId!==id) conversation.clearPendingAnnotation(current);
      current.mainId = id;
      bindInput(current, id, chatInputImage(current, id, true).id);
      evolution.move(evolutionTarget('chat',current.id),inputImage(current,id).id);
      if (old && old !== id && (selected()?.maxImages ?? Infinity) > 1)
        conversation.retainImage(current, old);
      changed(true);
    },
    removeReference(id: string) {
      if (mutable()) {
        conversation.forgetImage(current, id);
        changed(true);
      }
    },
    placeRef(id: string, to: number) {
      if (!mutable() || conversation.isAnnotationGuide(current,id)) return;
      const full = conversation.contextSnapshot(current),
        order = full.refs.filter((x) => x !== id);
      order.splice(Math.max(0, Math.min(to, order.length)), 0, id);
      conversation.retainImage(current, id);
      conversation.reorderRefs(
        current,
        !current.mainId && full.base ? [full.base, ...order] : order,
      );
      changed();
    },
    async useEditorResult(
      cId: string,
      result: {
        recordId?: string;
        blob: Blob;
        name: string;
        size: { width: number; height: number };
      },
    ) {
      if (!mutable() || !ready) throw new Error("请先配置供应商和 API Key");
      if (busy) throw new Error("请等待当前绘图任务完成");
      const c = conversations.find((v) => v.id === cId);
      if (!c) throw new Error("来源对话已删除");
      if (selected(c)?.maxImages === 1 && snapshotFor(c).imageIds.length)
        throw new Error("该模型每轮仅支持 1 张图，请先移除已有底图");
      if (result.blob.size > 8 * 1024 * 1024)
        throw new Error("结果超过参考图的 8MB 限制，请下载后缩小再上传");
      const a = await assets.add(result.blob, result.name, result.size);
      if (result.recordId) bindInput(c, a.id, result.recordId);
      conversation.retainImage(c, a.id);
      c.selectionRevision++;
      save();
      scheduleQuote();
      emit();
      await flush();
      if (result.recordId) evolution.handoff(evolutionTarget('chat', c.id), result.recordId);
    },
    dispose() {
      disposed = true;
      busy?.controller.abort();
      catalogAbort?.abort();
      cancelQuote();
      clearTimeout(saveTimer);
      unregister();
      unconnect();
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("pagehide", pagehide);
      document.removeEventListener("visibilitychange", hide);
      assets.dispose();
      finished.clear();
      evolution.dispose(); listeners.clear(); firstPromptListeners.clear();
    },
  };
}
export type Chat = ReturnType<typeof createChat>;
