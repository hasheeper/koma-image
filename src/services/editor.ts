import { canonical } from "../ask/canonical.ts";
import { naiAccountSnapshot, naiSourceKey } from "./nai-awareness.ts";
import type { MaskSummary } from "../domain/mask-summary.ts";
import type { EditDraftState, EditConfiguration } from "../domain/edit-draft.ts";
import { imageEntity } from "../domain/image-identity.ts";
import type { ImageLineage } from "../domain/image-identity.ts";
import { editLabel, qualifiedEditLabel } from "../domain/edit-identity.ts";
import type { ImageRecord } from "../domain/drawing.ts";
import { validateNaiText } from "../domain/nai-input.ts";
import { supportsFocusedInpaint, inpaintFocusPlan, snapFocusRect, readInpaintFocus } from "../domain/inpaint-focus.ts";
import type { FocusRect } from "../domain/inpaint-focus.ts";
import { prepareFocusedInpaint, composeFocusedInpaint } from "../native/inpaint-focus.ts";
import { activeCharacters, readCharacters, characterCapability, nextCharacterId } from "../domain/characters.ts";
import { compileNaiPrompt, naiCapabilities, readNaiSettings, NAI_OFFICIAL_UPSCALE } from "../domain/nai.ts";
import { modelSamplers, editStrengthRange, naiNoiseSchedule, supportsNaiVariety } from "../domain/nai-parameters.ts";
import { supportsNaiEnhance, availableEnhanceScales, naiEnhanceSize, naiEnhanceMagnitudes, isEnhanceScale } from "../domain/nai-enhance.ts";
import type { EnhanceScale } from "../domain/nai-enhance.ts";
import { randomSeed } from "../domain/drawing.ts";
import { emptyReferences, readReferences, referencePlan, referenceModel, referenceOperation, referenceSurcharge } from "../domain/nai-references.ts";
import type { NaiReferences } from "../domain/nai-references.ts";
import { insufficientFunds } from "../domain/source-funding.ts";
import type { ImagePayload } from "../gateway/routes.ts";
import type { NaiSettings } from "../domain/nai.ts";
import type { Character, Placement } from "../domain/characters.ts";
import type { ApplicationServices } from "./application";
import { profileFor, STANDARD_PROFILE_ID } from "../gateway/profile.ts";
import type { Ui } from "../app/ui";
import { message } from "../app/ui";
import type { AppRouter } from "../app/router";
import type { Drawing } from "./drawing";
import type { Chat } from "./chat";
import { normalizeOptions, resolveModel } from "../domain/catalog";
import type { SourceSelection } from "./source-priority.ts";
import type { CatalogModel } from "../domain/catalog";
import {
  editorModels,
  validateEditorSource,
  buildEditorPayload,
} from "../domain/media.ts";
import type { EditMode, EditorMode, EditorFields } from "../domain/media.ts";
import type { Fields } from "../storage/records";
import type { Quote } from "../domain/quote";
import type { QuotaStatus } from "../domain/quota";
import type { MaskState } from "../native/mask-editor.ts";
import { createMaskEditor, copyMaskState, emptyMask, withMaskBitmap } from "../native/mask-editor.ts";
import { maskStateBitmap } from "../native/photopea-input.ts";
import { decodeMask, editPixelHash, validateEditImage } from "../native/edit-input.ts";
import type { MaskFormat } from "../native/edit-input.ts";
import { imageParameters, sourceRecipe } from "../domain/image-parameters.ts";
import { imageOrigin, chatImageOrigin, chatImageId } from "../domain/image-origin.ts";
import { consumeMedia } from "./media-response";
import { dataUrl } from "./assets";
import { imageConnections } from "../config/connections.ts";
import { composeInpaint } from "../native/inpaint-result.ts";
import { directorName, directorSize, emptyDirectorSettings, isDirectorTool, directorEmotions } from "../domain/director-tools.ts";
import type { DirectorSettings, DirectorTool, DirectorVariant } from "../domain/director-tools.ts";
import { prepareDirectorImage, consumeDirector } from "../native/director-tools.ts";
export const modeNames = {
  img2img: "图生图",
  inpaint: "重绘",
  upscale: "放大",
  director: "工具处理",
};
export interface EditorVersion {
  entity_key: string;
  lineage?: ImageLineage;
  sourceRecord?: ImageRecord;
  id: number;
  sequence: number;
  recordId: string;
  createdAt: number;
  parentId: number;
  kind: "source" | "result" | "manual";
  mode?: EditorMode;
  blob: Blob;
  url: string;
  width: number;
  height: number;
  name: string;
  model?: CatalogModel;
  params?: Fields;
  quote?: Quote;
  original?: Promise<string>;
  png?: Promise<string>;
  sourceId?: string;
  director?: { tool: DirectorTool; group: string; variant?: DirectorVariant };
}
export type EditReturn =
  | { mode: "image"; image: Blob }
  | { mode: "selection" | "image-selection" | "auto" | "mask"; image: Blob; mask: Blob; format: MaskFormat };
export interface EditorSession {
  id: string;
  boardSeq: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  error: string;
  sourceKey?: string;
  viewport?: { zoom: number | null; hand: boolean; left: number; top: number };
  controls?: { brush: number; eraser: boolean; tab: "prompt" | "negative_prompt" };
  origin: "image" | "chat" | "edit";
  conversationId?: string;
  versions: EditorVersion[];
  baseId: number;
  viewId: number;
  mode: EditMode;
  chosen: Record<EditorMode, string>;
  strength: Record<EditMode, number>;
  noise: Record<EditMode, number>;
  focus: { on: boolean; rect: FocusRect | null };
  enhance: { on: boolean; scale: EnhanceScale; magnitude: number | null; strength: number; noise: number };
  options: Record<string, Record<string, string>>;
  director: DirectorSettings;
  directorChoices: Record<string, number>;
  characters: Character[];
  placement: Placement;
  nextCharacterId: number;
  naiReferences: NaiReferences;
  provenance: Fields;
  fields: NaiSettings & {
    transparentBg: boolean;
    prompt: string;
    negative_prompt: string;
    sampler: string;
    steps: number;
    scale: number;
    seed: string;
    detail: string;
  };
  maskFor: number;
  mask?: MaskState;
  maskRevision: number;
  appliedMaskRevision?: number;
  externalPending?: boolean;
  nextId: number;
  nextSequence: number;
  resultCount: number;
  initialized: boolean;
}
const session = (
  id: string,
  origin: "image" | "chat" | "edit",
  conversationId?: string,
  boardSeq = 1,
): EditorSession => ({
  id, boardSeq,
  name: "编辑画板", createdAt: Date.now(), updatedAt: Date.now(), error: "",
  origin,
  conversationId,
  versions: [],
  baseId: 0,
  viewId: 0,
  mode: "img2img",
  chosen: { img2img: "", inpaint: "", upscale: "" },
  strength: { img2img: 0.5, inpaint: 1 },
  noise: { img2img: 0, inpaint: 0 },
  focus: { on: false, rect: null },
  enhance: { on: false, scale: 2, magnitude: 3, strength: .5, noise: 0 },
  options: {},
  director: emptyDirectorSettings(), directorChoices: {},
  characters: [], placement: "auto", nextCharacterId: 1, naiReferences: emptyReferences(), provenance: {},
  fields: {
    ...readNaiSettings({}),
    transparentBg: false,
    prompt: "",
    negative_prompt: "",
    sampler: "k_euler_ancestral",
    steps: 25,
    scale: 5,
    seed: "",
    detail: "",
  },
  maskFor: 0,
  maskRevision: 0,
  nextId: 1, nextSequence: 1,
  resultCount: 0,
  initialized: false,
});
const stem = (name: string) =>
  name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "-") ||
  "image";
const failure = (e: unknown) =>
  message(e).includes("Could not verify the free-pool subscription")
    ? "NAI 暂时无法验证订阅，请稍后重试或换专用放大模型"
    : message(e);
async function normalizedPng(blob: Blob) {
  const b = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(b.width, b.height);
    canvas.getContext("2d")!.drawImage(b, 0, 0);
    return dataUrl(await canvas.convertToBlob({ type: "image/png" }));
  } finally {
    b.close();
  }
}
export function createEditor(
  services: ApplicationServices,
  ui: Ui,
  router: AppRouter,
  drawing: Drawing,
  chat: Chat,
) {
  const sessions = new Map<string, EditorSession>(),
    listeners = new Set<() => void>();
  let nextBoard = 2;
  let current = session(crypto.randomUUID(), "edit");
  let taskOwner: EditorSession | undefined;
  const locked = () => (busy || preparing) && taskOwner === current;
  sessions.set(current.id, current);
  let models: CatalogModel[] = [],
    samplers = ["k_euler_ancestral"],
    quota: QuotaStatus | null = null,
    quotaAt = 0,
    open = false,
    upscaleOpen = false,
    directorOpen = false,
    reading = false,
    busy = false,
    preparing = false,
    running: EditorMode | "director" = "img2img",
    runningDirector: DirectorTool = "bg-removal",
    runningEnhance = false,
    startedAt = 0,
    disposed = false;
  let readSequence = 0,
    openSequence = 0,
    taskAbort: AbortController | undefined,
    catalogAbort: AbortController | undefined;
  const connectionSamplers = new Map<string, string[]>();
  const blank = () => ({
    quote: null as Quote | null,
    error: "",
    price: "",
    revision: 0,
    quoteAt: 0,
    configKey: "",
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    abort: undefined as AbortController | undefined,
  });
  const jobs = { edit: blank(), upscale: blank(), director: blank() };
  type Job = "edit" | "upscale";
  const maskCoverage = new WeakMap<EditorSession, { revision: number; value: boolean }>();
  const maskSummaries = new WeakMap<EditorSession,{revision:number;value:MaskSummary}>();
  const geometryJobs = new Map<EditorSession,{cancel:()=>void;done:Promise<void>}>();
  const askPanels = new WeakMap<EditorSession,{upscaleOpen:boolean;directorOpen:boolean}>();
  const draftPaused = new WeakSet<EditorSession>();
  const photopeaUsed = new WeakSet<EditorSession>();
  function maskSummary(s:EditorSession):MaskSummary {
    const cached=maskSummaries.get(s); if(cached?.revision===s.maskRevision) return cached.value;
    if(!s.mask) return {has_mask:false,status:'ready',coverage_ratio:0,region_count:0,regions:[]};
    if(!geometryJobs.has(s)) {
      let finish!:()=>void;
      const done=new Promise<void>(resolve=>{finish=resolve;});
      const compute=()=>{
        geometryJobs.delete(s);
        if(!sessions.has(s.id)||disposed){finish();return;}
        const revision=s.maskRevision, renderer=createMaskEditor(document.createElement('canvas'),()=>{});
        try { if(s.mask) {renderer.restore(s.mask);maskSummaries.set(s,{revision,value:renderer.geometry()});} }
        catch {maskSummaries.set(s,{revision,value:{has_mask:false,status:'error'}});}
        finally {renderer.dispose();finish();}
        emit();
      };
      const idle=typeof requestIdleCallback==='function';
      const timer=idle?requestIdleCallback(compute,{timeout:200}):setTimeout(compute,16);
      geometryJobs.set(s,{done,cancel:()=>{if(idle)cancelIdleCallback(timer);else clearTimeout(timer);finish();}});
    }
    return {has_mask:false,status:'pending'};
  }
  function configuration(s:EditorSession):EditConfiguration {
    const {mode,chosen,strength,noise,focus,enhance,fields,characters,placement,naiReferences,director,options}=s;
    return structuredClone({mode,chosen,strength,noise,focus,enhance,fields,characters,placement,naiReferences,director,options,
      upscaleOpen:s===current?upscaleOpen:askPanels.get(s)?.upscaleOpen??false,directorOpen:s===current?directorOpen:askPanels.get(s)?.directorOpen??false});
  }
  function askSnapshot(id=current.id):EditDraftState|undefined {
    const s=sessions.get(id);if(!s)return;
    const v=s.versions.find(v=>v.id===s.baseId), viewing=s.versions.find(v=>v.id===s.viewId), config=configuration(s);
    const catalog=models.length?models:drawing.snapshot().models;
    const m=catalog.find(m=>m.id===config.chosen[config.upscaleOpen?'upscale':config.mode]);
    const j=s===current?jobs[config.upscaleOpen?'upscale':'edit']:undefined;
    return {sourceKey:s.sourceKey,recordIds:s.versions.map(v=>v.recordId),id:s.id,name:s.name,boardSeq:s.boardSeq,present:true,ready:!!v,baseId:s.baseId,viewId:s.viewId,maskRevision:s.maskRevision,
      source:v?{width:v.width,height:v.height,bytes:v.blob.size,recordId:v.recordId}:null,sourceTag:v?qualifiedEditLabel(s,v):undefined,viewing:viewing?{width:viewing.width,height:viewing.height,bytes:viewing.blob.size,recordId:viewing.recordId}:null,config,nextCharacterId:s.nextCharacterId,
      pricing:{sourceKey:canonical(m?[m.id,naiSourceKey(m),m.upstreamId]:null),configKey:j?.configKey??"",quoteAt:j?.quoteAt,quote:j?.quote?{status:"ready",quote:structuredClone(j.quote)}:undefined,account:m===quotaModel?naiAccountSnapshot(quota?.media.subscription):undefined,accountAt:m===quotaModel?quotaAt:undefined,referenceCosts:Object.fromEntries(catalog.map(m=>[m.id,services.references.cachedCost(s.naiReferences,m.id)]))},
      models:structuredClone(catalog),samplers:[...samplers],mask:maskSummary(s),photopeaUsed:photopeaUsed.has(s),
      blocked:preparing&&taskOwner===s?'正在准备生成，请稍后应用':s===current&&external||s.externalPending?'请先完成高级编辑回传':s===current&&maskPort?.isDrawing()?'请完成当前蒙版笔画':''};
  }
  const saves = new Map<EditorVersion, Promise<void>>();
  let external: {
    id: string; context: string; owner: EditorSession; source: EditorVersion;
    baseId: number; maskRevision: number; recipe: Fields; mask: MaskState;
  } | undefined;
  let maskPort:
    | {
        getMask: () => string | null;
        isDrawing: () => boolean;
        save: () => void;
      }
    | undefined;
  const emit = () => {
    if (!disposed) for (const f of listeners) f();
  };
  const base = () => current.versions.find((v) => v.id === current.baseId),
    viewed = () =>
      current.versions.find((v) => v.id === current.viewId) || base();
  const focusing = () => current.mode === "inpaint" && current.focus.on;
  const focusAvailable = () => models.some(m => m.id === current.chosen.inpaint && supportsFocusedInpaint(m));
  const enhancing = () => current.mode === "img2img" && current.enhance.on;
  const enhanceAvailable = () => models.some(m => m.id === current.chosen.img2img && supportsNaiEnhance(m));
  const selected = (mode: EditorMode = current.mode) =>
    (mode === "inpaint" && focusing() ? models.find(m => m.id === current.chosen[mode] && supportsFocusedInpaint(m)) : undefined) ??
    (mode === "img2img" && enhancing() ? models.find(m => m.id === current.chosen[mode] && supportsNaiEnhance(m)) : undefined) ??
    editorModels({ models }, mode).find((m) => m.id === current.chosen[mode]);
  // The catalog model supplies connection identity only. Augment has no model
  // field and is independent of the generation model selected in the left form.
  const directorModel = () => models.find(m => m.profileId === "nai-official-v1" && m.tools.includes("director"));
  const directorActive = () => directorOpen || locked() && running === "director";
  const quotaSelection = () => directorActive() ? directorModel() : selected(upscaleOpen || locked() && running === "upscale" ? "upscale" : current.mode);
  const directorWarning = () => {
    if (!directorModel()) return "请先配置 NovelAI 官方连接";
    const v = viewed();
    if (!v) return "请先打开图片";
    try { directorSize(v); return ""; } catch (e) { return message(e); }
  };
  const source = (key: Job) => (key === "upscale" ? viewed() : base());
  const target = (key: Job): EditorMode =>
    key === "upscale" ? "upscale" : current.mode;
  const referenceSupported = () => models.some(m => m.id === current.chosen[current.mode] &&
    m.profileId === "nai-official-v1" && referenceModel(m.id) &&
    m.upstreamId.replace(/@local$/, "") === m.id.replace(/@local$/, "") && m.tools.includes(current.mode));
  const referenceKinds = () => referenceSupported() ? (["vibe", "precise"] as const).filter(kind => referenceOperation(current.chosen[current.mode], kind, current.mode)) : [];
  const referenceProblem = () => current.naiReferences.active && current.naiReferences[current.naiReferences.active].some(r => r.on) && !referenceKinds().includes(current.naiReferences.active)
    ? current.mode === "inpaint" && current.naiReferences.active === "vibe" ? "局部重绘暂不支持 Vibe Transfer，配置已保留" : "当前模型或操作不支持已启用的参考，配置已保留" : "";
  const characterProblem = () => {
    const cap = characterCapability(current.chosen[current.mode]);
    return cap.max > 0 && current.characters.filter(c => c.on).length > cap.max ? `当前模型最多 ${cap.max} 个启用角色` : "";
  };
  const contextId = () => `${current.id}:${openSequence}`;
  const warning = (key: Job) => {
    const v = source(key);
    if (key === "edit" && (referenceProblem() || characterProblem())) return referenceProblem() || characterProblem();
    if (key === "edit" && focusing()) {
      if (!focusAvailable()) return "聚焦重绘仅支持 NovelAI 官方连接，设置已保留";
      if (!current.focus.rect) return "请框选聚焦范围，包含蒙版与周边参考";
      if (v) try { inpaintFocusPlan(v, current.focus.rect); } catch (e) { return message(e); }
    }
    if (key === "edit" && enhancing()) {
      if (!enhanceAvailable()) return "Enhance 仅支持 NovelAI 官方连接，设置已保留";
      if (v) try { naiEnhanceSize(v, current.enhance.scale, current.chosen.img2img); } catch (e) { return message(e); }
    }
    return v
      ? validateEditorSource(target(key), selected(target(key)), {
          width: v.width,
          height: v.height,
          bytes: v.blob.size,
        })
      : null;
  };
  function cancelQuote(key: keyof typeof jobs) {
    const j = jobs[key];
    j.revision++;
    clearTimeout(j.timer);
    j.abort?.abort();
    j.quote = null;
    j.error = "";
    j.price = "";
  }
  function normalize() {
    for (const mode of ["img2img", "inpaint", "upscale"] as const) {
      const list = editorModels({ models }, mode);
      if (!list.some((m) => m.id === current.chosen[mode]))
        current.chosen[mode] =
          (mode === "upscale"
            ? list.find((m) => m.id === "nai-diffusion-5-full")
            : null
          )?.id ||
          list[0]?.id ||
          "";
    }
    const m = selected();
    samplers = modelSamplers(m, m
      ? connectionSamplers.get(m.connection) || ["k_euler_ancestral"]
      : ["k_euler_ancestral"]);
    if (!naiCapabilities(m?.id ?? "").medium && !samplers.includes(current.fields.sampler))
      current.fields.sampler = samplers[0];
  }
  async function catalog() {
    if (services.data.phase !== "ready") return;
    catalogAbort?.abort();
    const controller = (catalogAbort = new AbortController());
    quota = null;
    cancelQuote("edit");
    cancelQuote("upscale");
    cancelQuote("director");
    emit();
    const configuration = services.connections.configuration;
    const results = await Promise.allSettled(
      imageConnections(configuration).map(
        async ({ id }) => ({
          id,
          c: await services.gateway(id).catalog(false, controller.signal),
        }),
      ),
    );
    if (controller.signal.aborted || disposed) return;
    const candidates: CatalogModel[] = [];
    connectionSamplers.clear();
    for (const r of results)
      if (r.status === "fulfilled") {
        connectionSamplers.set(r.value.id, r.value.c.samplers);
        candidates.push(...r.value.c.models);
      } else current.error = failure(r.reason);
    models = candidates;
    normalize();
    emit();
    requote();
    void refreshQuota();
  }
  function applySource(source: SourceSelection) {
    models = [source.model, ...models.filter(m => !(m.id === source.model.id && m.connection === source.model.connection))];
    if (quotaSelection() === source.model) {
      quotaModel = source.model;
      quota = source.quota;quotaAt=Date.now();
    }
  }
  async function refreshQuota() {
    if(draftPaused.has(current)) return;
    const m = quotaSelection();
    if (quotaModel !== m) {
      quotaModel = m;
      quota = null;
      emit();
    }
    if (!m || services.data.phase !== "ready") return;
    const stillSelected = () =>
      !disposed && quotaSelection() === m;
    try {
      const request = directorActive() && viewed() ? directorPayload(m, viewed()!, structuredClone(current.director)) : undefined;
      const source = await services.selectSource(m, undefined, request, directorActive() ? "director" : m.provider === "novelai" ? upscaleOpen ? "upscale" : focusing() ? "focused-inpaint" : enhancing() ? "enhance" : current.mode : "image-edit");
      if (stillSelected()) { applySource(source); emit(); }
    } catch {
      if (stillSelected()) quota = null;
    }
    if (stillSelected()) emit();
  }
  let quotaModel: CatalogModel | undefined;
  async function payload(key: Job, execution = false) {
    const mode = target(key),
      v = source(key),
      m = selected(mode);
    if (!v || !m) throw new Error("请先选择底图和模型");
    const w = warning(key);
    if (w) throw new Error(w);
    const owner = current, characters = structuredClone(current.characters), placement = current.placement;
    const focus = mode === "inpaint" && focusing() && current.focus.rect ? inpaintFocusPlan(v, current.focus.rect) : undefined;
    const enhance = mode === "img2img" && enhancing() ? { ...current.enhance } : undefined;
    const references = readReferences(current.naiReferences), provenance = structuredClone(current.provenance), isRandom = !!enhance || current.fields.seed.trim() === "" || Number(current.fields.seed) === -1;
    const f: EditorFields = {
      ...current.fields,
      seed:
        isRandom ? execution ? randomSeed() : -1 : Number(current.fields.seed),
      strength: enhance ? enhance.strength : current.strength[current.mode],
      noise: enhance ? enhance.noise : current.noise[current.mode],
      ...(focus ? { inpaintFocus: focus } : {}),
      ...(enhance ? { enhance: true, enhanceScale: enhance.scale, enhanceMagnitude: enhance.magnitude } : {}),
      detail: current.fields.detail.trim(),
      options: current.options[m.id] || normalizeOptions(m),
    };
    let mask =
      mode === "inpaint" && current.maskFor === v.id
        ? maskPort?.getMask()
        : null;
    const encoded =
      mode === "upscale"
        ? {
            original: await (v.original ??= dataUrl(v.blob).catch((e) => {
              v.original = undefined;
              throw e;
            })),
          }
        : {
            png: await (v.png ??= normalizedPng(v.blob).catch((e) => {
              v.png = undefined;
              throw e;
            })),
          };
    const focusOriginal = focus && mask && encoded.png ? { png: encoded.png, mask, focus } : undefined;
    if (focus) {
      if (!focusOriginal) throw new Error("请先涂抹需要重绘的区域");
      const prepared = await prepareFocusedInpaint(focusOriginal.png, focusOriginal.mask, focus);
      encoded.png = prepared.png; mask = prepared.mask;
    }
    const compiled = compileNaiPrompt({ ...f, prompt: f.prompt ?? "", negative: f.negative_prompt ?? "" }, m);
    const roles = mode === "upscale" ? [] : activeCharacters(characters, m.id).map(c => naiCapabilities(m.id).medium ? { ...c, negative: "" } : c);
    const plan = mode === "upscale" ? undefined : referencePlan(references);
    const request: ImagePayload = { ...buildEditorPayload(mode, m, encoded, f, mask, connectionSamplers.get(m.connection)),
      ...(roles.length ? { characters: roles, placement } : {}), ...(plan ? { referencePlan: plan } : {}),
    };
    validateNaiText(request);
    return {
      payload: request, model: m, parent: v, mode, owner, focusOriginal,
      settings: { ...compiled, noiseSchedule: f.noiseSchedule, localCharacters: characters, placement, naiReferences: references,
        ...provenance, randomSeed: isRandom },
    };
  }

  function scheduleQuote(key: Job = "edit", delay = 400) {
    if(draftPaused.has(current)) return;
    cancelQuote(key);
    const j = jobs[key],
      m = selected(target(key)),
      v = source(key);
    if (v && !m) j.price = "无可用模型";
    if (
      !open ||
      directorActive() ||
      (key === "upscale" && !upscaleOpen) ||
      busy ||
      preparing ||
      reading ||
      external ||
      !m ||
      !v ||
      warning(key) ||
      maskPort?.isDrawing() ||
      services.data.phase !== "ready"
    ) {
      emit();
      return;
    }
    const rev = j.revision;
    emit();
    j.timer = setTimeout(async () => {
      const controller = (j.abort = new AbortController());
      try {
        const p = await payload(key);
        if (rev !== j.revision) return;
        const source = await services.selectSource(p.model, controller.signal, p.payload);
        if (rev !== j.revision || busy || !open) return;
        applySource(source);
        j.quote = source.quote;j.quoteAt=Date.now();j.configKey=canonical(configuration(current));
        j.price = source.quote ? "" : "费用未知";
        if (source.insufficient) throw new Error("所有可用来源的额度均不足");
      } catch (e) {
        if (rev !== j.revision || controller.signal.aborted) return;
        if (message(e).includes("先涂抹")) j.price = "先涂抹";
        else j.error = failure(e);
      }
      emit();
    }, delay);
  }
  function requote(delay = 400) {
    scheduleQuote("edit", delay);
    if (upscaleOpen) scheduleQuote("upscale", delay);
    if (directorOpen) scheduleDirectorQuote(delay);
  }
  function directorPayload(model: CatalogModel, v: EditorVersion, settings: DirectorSettings): ImagePayload {
    const options = settings.tool === "colorize" ? settings.colorize : settings.tool === "emotion" ? settings.emotion : {};
    return { model: model.id, tool: "director", directorTool: settings.tool, ...directorSize(v), ...options };
  }
  function scheduleDirectorQuote(delay = 400) {
    if(draftPaused.has(current)) return;
    cancelQuote("director");
    const j = jobs.director, m = directorModel(), v = viewed(), rev = j.revision;
    if (!open || !directorOpen || busy || preparing || reading || external || !m || !v || directorWarning() || services.data.phase !== "ready") { emit(); return; }
    const request = directorPayload(m, v, structuredClone(current.director));
    j.timer = setTimeout(async () => {
      const controller = j.abort = new AbortController();
      try {
        const source = await services.selectSource(m, controller.signal, request);
        if (rev !== j.revision || !open || !directorOpen || busy) return;
        applySource(source);
        j.quote = source.quote;j.quoteAt=Date.now();j.configKey=canonical(configuration(current));
        if (source.insufficient) j.error = source.insufficient;
      } catch (e) { if (rev === j.revision && !controller.signal.aborted) j.error = failure(e); }
      if (rev === j.revision) emit();
    }, delay);
    emit();
  }
  function changed(delay = 400) {
    draftPaused.delete(current);
    current.updatedAt = Date.now();
    current.error = "";
    if (quotaModel !== quotaSelection()) void refreshQuota();
    emit();
    requote(delay);
  }
  async function addVersion(
    s: EditorSession,
    data: Omit<EditorVersion, "id" | "url" | "sequence" | "recordId" | "createdAt" | "entity_key">,
  ) {
    if (disposed) throw new DOMException("编辑器已关闭", "AbortError");
    const grouped = data.director && s.versions.find(v => v.director?.group === data.director!.group);
    const sequence = grouped ? grouped.sequence : s.nextSequence++;
    const sourceId = data.kind === "source" ? data.sourceId?.replace(/^(?:record|history|favorite):/, "") : undefined;
    const candidate = data.sourceRecord ?? (sourceId ? [...drawing.snapshot().history, ...drawing.snapshot().favorites].find(r => r.id === sourceId) : undefined);
    const entity_key = await imageEntity(data.blob);
    const sourceRecord = candidate && (candidate.entity_key ?? await imageEntity(candidate.blob)) === entity_key ? candidate : undefined;
    const recordId = sourceRecord?.id ?? `edit:${s.id}:${s.nextId}`;
    if (disposed || !sessions.has(s.id)) throw new DOMException("编辑画板已关闭", "AbortError");
    const parent = s.versions.find(v => v.id === data.parentId);
    const via: ImageLineage["via"] = data.kind === "manual" ? "edit:photopea" : !!data.director ? "edit:director" : data.params?.enhance ? "edit:enhance" : data.mode === "inpaint" ? "edit:inpaint" : data.mode === "upscale" ? "edit:upscale" : data.kind === "source" ? "upload" : "edit:img2img";
    const lineage: ImageLineage = data.kind === "source" ? sourceRecord?.lineage ?? {via:s.origin === "chat" ? "chat" : "upload"} : { via, ...(parent ? { parent_record_id: parent.recordId, parent_entity_key: parent.entity_key } : {}), ...(data.director ? { tool_detail: `${data.director.tool}${data.director.variant ? `:${data.director.variant}` : ""}` } : data.params?.inpaintFocus ? { tool_detail: "focused-inpaint" } : {}) };
    const v: EditorVersion = {
      ...data, entity_key, lineage, sourceRecord,
      sourceId: data.sourceId ?? `${data.kind === "source" ? "source" : "edit"}:${String(data.params?.editId ?? crypto.randomUUID())}`,
      id: s.nextId++, sequence, recordId, createdAt: Date.now(),
      url: URL.createObjectURL(data.blob),
    };
    v.params = { ...v.params, editBoardId: s.id, editBoardName: s.name, editBoardSeq: s.boardSeq, editVersion: sequence,
      ...(v.director?.variant ? { editVariant: v.director.variant } : {}) };
    s.updatedAt = Date.now();
    s.versions.push(v);
    while (s.versions.length > 30) {
      const old = s.versions.find(
        (x) => x.sequence !== 1 && x.id !== s.baseId && x.id !== s.viewId && x !== v && (!x.director ||
          x.director.group !== v.director?.group && !s.versions.some(p => p.director?.group === x.director!.group && (p.id === s.baseId || p.id === s.viewId))),
      );
      if (!old) break;
      const removed = old.director ? s.versions.filter(p => p.director?.group === old.director!.group) : [old];
      s.versions = s.versions.filter(p => !removed.includes(p));
      for (const item of removed) URL.revokeObjectURL(item.url);
      if (old.director) delete s.directorChoices[old.director.group];
      if (s.mask && removed.some(item => s.mask!.anchor === item.id || s.mask!.strokes.some(e => "bitmap" in e && e.baseId === item.id))) {
        s.mask = { ...s.mask, anchor:undefined, strokes:s.mask.strokes.map(e => "bitmap" in e ? {bitmap:e.bitmap} : e) };
        s.maskRevision++;
      }
    }
    return v;
  }
  function originOf(s: EditorSession, v: EditorVersion): Fields {
    const origin = imageOrigin({ ...s.provenance, ...v.params });
    if (s.origin === "chat" && s.conversationId) {
      origin.sourceWorkspace = "chat";
      origin.chatConversationId = s.conversationId;
      const c = chat.snapshot().conversations.find(c => c.id === s.conversationId);
      if (c) origin.chatConversationTitle = c.title;
      for (const key of ["boardId", "boardName", "boardColor"]) delete origin[key];
    }
    return { ...origin, editBoardId: s.id, editBoardName: s.name };
  }
  const parentIdentity = (v: EditorVersion) => typeof v.params?.editId === "string" ? `edit:${v.params.editId}`
    : v.sourceId ?? v.recordId;
  function setBase(id: number) {
    if (locked() || reading || !current.versions.some((v) => v.id === id)) return;
    maskPort?.save();
    selectBase(current, id);
    changed(0);
  }
  function selectBase(s: EditorSession, id: number) {
    const v = s.versions.find(v => v.id === id)!;
    s.baseId = s.viewId = id;
    alignMask(s, v);
    if (s.mask?.anchor !== undefined) {
      s.mask = { ...s.mask, anchor: undefined, strokes: s.mask.strokes.map(e => "bitmap" in e ? {bitmap:e.bitmap} : e) };
    }
  }
  // Coverage belongs to the EDIT canvas, not to an image version. In particular,
  // returning to an older version must not resurrect a mask the user has cleared.
  function alignMask(s: EditorSession, v: EditorVersion) {
    if (!s.mask || s.mask.width !== v.width || s.mask.height !== v.height) {
      s.mask = emptyMask(v.width, v.height);
      s.focus.rect = null;
    }
    const base = s.versions.find(item => item.id === s.baseId);
    s.maskFor = base?.width === v.width && base.height === v.height ? s.baseId : v.id;
    s.maskRevision++;
  }
  function writeMask(s: EditorSession, value: MaskState, notify = true) {
    if (value.width !== s.mask?.width || value.height !== s.mask.height) return;
    let anchor = value.anchor;
    for (const entry of value.strokes.slice(0,value.position)) if ("bitmap" in entry && entry.baseId !== undefined) anchor = entry.baseId;
    if (anchor !== undefined && anchor !== s.baseId) {
      const version = s.versions.find(v => v.id === anchor);
      if (!version || version.width !== value.width || version.height !== value.height) return;
      s.baseId = s.viewId = s.maskFor = anchor;
    }
    s.mask = value;
    if (notify) { s.maskRevision++; changed(); }
  }
  function beginExternalEdit() {
    photopeaUsed.add(current);
    const v = viewed();
    if (!open || !v || locked() || reading || maskPort?.isDrawing()) throw new Error("请先完成当前编辑操作");
    maskPort?.save();
    const recipe = imageParameters(sourceRecipe(v.params ?? {})) as Fields;
    // An uploaded image can still be delivered with an explicitly empty source caption.
    if (recipe.basePrompt === undefined) recipe.basePrompt = "";
    external = { id: crypto.randomUUID(), context: contextId(), owner: current, source: v,
      baseId: current.baseId, maskRevision: current.maskRevision, recipe,
      mask: copyMaskState(current.mask ?? emptyMask(v.width,v.height)) };
    cancelQuote("edit"); cancelQuote("upscale"); cancelQuote("director"); directorOpen = false; emit();
    const ancestors: number[] = [];
    let parent = v.parentId;
    while (parent && !ancestors.includes(parent)) {
      ancestors.push(parent);
      parent = current.versions.find(item => item.id === parent)?.parentId ?? 0;
    }
    return { id: external.id, sessionId: current.id, sourceId: v.id, parentId: v.parentId, kind: v.kind, ancestors,
      mode: current.mode, image: v.blob, width: v.width, height: v.height, maskRevision: current.maskRevision,
      mask: current.mask };
  }
  function requireExternal(id: string) {
    const state = external;
    if (!state || state.id !== id || !open || disposed || state.context !== contextId() || state.owner !== current ||
      !current.versions.includes(state.source) || state.source.id !== current.viewId || state.baseId !== current.baseId ||
      state.maskRevision !== current.maskRevision) throw new Error("编辑来源已变化，请重新打开高级编辑");
    return state;
  }
  /** EDIT owns the transient version; favoriting copies it through the existing data lease. */
  function record(s: EditorSession, v: EditorVersion): ImageRecord {
    if (v.sourceRecord) return { ...v.sourceRecord };
    return { id: v.recordId, entity_key: v.entity_key, lineage: v.lineage, createdAt: v.createdAt, blob: v.blob, thumbBlob: null,
      params: { ...v.params, ...originOf(s, v), editBoardSeq: s.boardSeq,
        editVersion: v.sequence, ...(s.versions[0]?.sourceId ? { editOriginId: s.versions[0].sourceId } : {}) },
      size: { width: v.width, height: v.height }, quote: v.quote as Fields | undefined };
  }
  function records() { return [...sessions.values()].flatMap(s => s.versions.map(v => record(s, v))); }
  async function saveFavorite(v = viewed()) {
    if (!v) return;
    const owner = [...sessions.values()].find(s => s.versions.includes(v));
    if (!owner) return;
    const pending = saves.get(v);
    if (pending) return pending;
    const task = (async () => {
      try {
        if (services.data.phase !== "ready") throw new Error("数据维护中，请稍后保存");
        if (!drawing.snapshot().favorites.some(r => r.id === v.recordId)) await drawing.toggleFavorite(record(owner, v));
        owner.error = "";
      } catch (e) { owner.error = "图片已保留，收藏失败：" + failure(e); }
    })();
    saves.set(v, task); emit();
    try { await task; } finally { saves.delete(v); emit(); }
  }
  async function applyExternalEdit(id: string, result: EditReturn) {
    if (locked() || reading || maskPort?.isDrawing()) throw new Error("请先完成当前编辑操作");
    const state = requireExternal(id), rev = ++readSequence;
    reading = true; current.error = ""; requote();
    let added: EditorVersion | undefined;
    try {
      if (!["auto", "mask", "image", "selection", "image-selection"].includes(result.mode)) throw new Error("回传方式无效");
      const size = await validateEditImage(result.image);
      const bitmap = result.mode === "image" ? null : await decodeMask(result.mask, result.format, size, result.mode === "auto" || result.mode === "mask");
      const imageChanged = size.width !== state.source.width || size.height !== state.source.height ||
        await editPixelHash(result.image) !== await editPixelHash(state.source.blob);
      const maskOnly = result.mode === "selection" || result.mode === "mask";
      if (maskOnly && imageChanged) throw new Error("图像已修改，请使用自动回传");
      const baseline = bitmap ? await maskStateBitmap(state.mask) : null;
      const maskChanged = !!bitmap && (!baseline || bitmap.width !== baseline.width || bitmap.height !== baseline.height ||
        !bitmap.bits.every((b,i)=>b===baseline.bits[i]));
      requireExternal(id);
      if (readSequence !== rev) throw new Error("回传已取消");
      const startMask = maskOnly || !imageChanged ? copyMaskState(current.mask ?? emptyMask(size.width,size.height)) : emptyMask(size.width,size.height);
      const switchBase = !imageChanged && maskChanged && state.source.id !== current.baseId;
      if (switchBase && startMask.anchor === undefined) startMask.anchor = current.baseId;
      const mask = bitmap ? withMaskBitmap(startMask,bitmap,switchBase ? state.source.id : undefined) : undefined;
      if (!imageChanged && mask && maskChanged) { selectBase(current, state.source.id); writeMask(current, mask, false); }
      else if (imageChanged) {
        const params: Fields = { tool: "manual-edit", modelName: "手动编辑", width: size.width, height: size.height,
          ...originOf(state.owner, state.source),
          editSource: "photopea", editId: state.id,
          editParent: parentIdentity(state.source),
          editedAt: new Date().toISOString(), sourceRecipe: state.recipe };
        added = await addVersion(current, { kind: "manual", parentId: state.source.id, blob: result.image, ...size,
          name: `${stem(state.source.name)}-修图-${current.nextId}.${result.image.type === "image/jpeg" ? "jpg" : result.image.type.split("/")[1]}`, params });
        selectBase(current, added.id);
        // An explicit image-only return ignores Photopea's selection edits, but
        // retains the EDIT canvas coverage when the output dimensions still fit.
        if (mask) current.mask = mask;
      }
      if (!imageChanged && maskChanged) current.maskRevision++;
      external = undefined; current.externalPending = false;
      // Publish only after both image and mask have validated and committed.
      emit();
    } finally {
      if (rev === readSequence) { reading = false; emit(); requote(0); }
    }
    return added;
  }
  async function importMask(blob: Blob, format: MaskFormat = "grayscale") {
    if (locked() || reading || maskPort?.isDrawing()) return;
    const v = base(), s = current, context = contextId();
    if (!open || !v || current.viewId !== v.id) return;
    maskPort?.save();
    const maskRevision = s.maskRevision, rev = ++readSequence;
    reading = true; current.error = ""; requote();
    try {
      const bitmap = await decodeMask(blob, format, v);
      if (!open || disposed || s !== current || context !== contextId() || rev !== readSequence ||
        base() !== v || s.maskRevision !== maskRevision) return;
      writeMask(s, withMaskBitmap(s.mask ?? emptyMask(v.width, v.height), bitmap), false);
      s.maskRevision++;
      emit();
    } catch (e) { if (context === contextId() && rev === readSequence) current.error = failure(e); }
    finally { if (rev === readSequence) { reading = false; emit(); requote(0); } }
  }
  function view(id: number) {
    const v = current.versions.find(v => v.id === id);
    if (!v || locked() || reading || external) return;
    maskPort?.save();
    current.viewId = id;
    if (v.director) current.directorChoices[v.director.group] = id;
    alignMask(current, v);
    emit();
    if (upscaleOpen) scheduleQuote("upscale");
    if (directorOpen) scheduleDirectorQuote();
  }
  async function loadSource(blob: Blob, name = "图片", params?: Fields, sourceId?: string) {
    if (locked()) return;
    const existing = current.versions.find((v) => v.blob === blob || sourceId && v.sourceId === sourceId);
    if (existing) {
      setBase(existing.id);
      return;
    }
    const rev = ++readSequence,
      s = current;
    reading = true;
    current.error = "";
    requote();
    try {
      const size = await validateEditImage(blob);
      if (rev !== readSequence || s !== current || disposed) return;
      let sourceRecord: ImageRecord | undefined;
      if (s.origin === "chat" && s.conversationId) {
        const c = chat.snapshot().conversations.find(c => c.id === s.conversationId);
        const asset = [...chat.assets.assets.values()].find(a => a.blob === blob);
        const turn = c && [...c.turns].reverse().find(t => t.versions.some(v => v.blocks.some(b => b.type === "image" && b.assetId === asset?.id)));
        const version = turn?.versions.find(v => v.blocks.some(b => b.type === "image" && b.assetId === asset?.id));
        if (c && turn && version && asset) {
          sourceId ??= chatImageId(c.id, turn.id, version.id, asset.id);
          sourceRecord = await chat.favoriteRecord(c.id,turn.id,version.id,asset.id);
        }
        params = { ...(params ?? {}), ...(c && turn && version && asset ? { tool: "chat", prompt: turn.prompt, ...chatImageOrigin(c, turn, version, asset.id) }
          : { sourceWorkspace: "chat", chatConversationId: s.conversationId, chatConversationTitle: c?.title ?? "对话" }) };
      }
      const v = await addVersion(s, {
        kind: "source", sourceRecord,
        blob,
        name,
        ...size,
        parentId: 0,
        ...(params ? { params: imageParameters(params) as Fields } : {}),
        ...(sourceId ? { sourceId } : {}),
      });
      reading = false;
      setBase(v.id);
    } catch (e) {
      if (rev === readSequence) current.error = failure(e);
    } finally {
      if (rev === readSequence) {
        reading = false;
        emit();
        requote(0);
      }
    }
  }
  async function runDirector() {
    const model = directorModel(), parent = viewed(), owner = current;
    if (busy || preparing || reading || external || !open || !model || !parent || directorWarning() || services.data.phase !== "ready") return;
    const settings = structuredClone(owner.director), shownCost = jobs.director.quote?.cost ?? null;
    const request = directorPayload(model, parent, settings), group = crypto.randomUUID();
    const controller = taskAbort = new AbortController();
    taskOwner = owner; preparing = true; owner.error = ""; emit();
    try {
      Object.assign(request, await prepareDirectorImage(parent.blob, parent));
      controller.signal.throwIfAborted();
      if (disposed) return;
      preparing = false; busy = true; running = "director"; runningDirector = settings.tool; runningEnhance = false;
      startedAt = Date.now(); upscaleOpen = false; directorOpen = false;
      cancelQuote("edit"); cancelQuote("upscale"); cancelQuote("director"); emit();
      const result = await services.runTask({ id: group, workspace: "editor", sessionId: owner.id, snapshot: request }, async task => {
        const output = await task.execute(model, request, (response, _native, signal) => consumeDirector(response, settings.tool, signal), {
          shownCost, signal: task.signal, onNotice: n => ui.toast(n),
          onSource: source => { if (current === owner) { applySource(source); emit(); } },
        });
        task.signal.throwIfAborted();
        // All ZIP members have decoded successfully before publishing versions.
        const versions: EditorVersion[] = [];
        for (const image of output.value) {
          const params: Fields = { tool: "director", modelName: directorName(settings.tool), directorTool: settings.tool,
            directorGroup: group, ...(image.variant ? { directorVariant: image.variant } : {}),
            ...(settings.tool === "emotion" || settings.tool === "colorize" ? { prompt: request.prompt as string, defry: request.defry as number } : {}),
            ...(settings.tool === "emotion" ? { emotion: settings.emotion.emotion } : {}),
            width: image.width, height: image.height, directorWidth: Number(request.width), directorHeight: Number(request.height),
            sourceRecipe: imageParameters(sourceRecipe(parent.params ?? {})) as Fields,
            ...originOf(owner, parent), editId: crypto.randomUUID(), editParent: parentIdentity(parent), editedAt: new Date().toISOString(),
            via: { connection: output.via.connection, operation: "/ai/augment-image" } };
          const version = await addVersion(owner, { kind: "result", parentId: parent.id, blob: image.blob, width: image.width, height: image.height,
            params, quote: output.quote ?? undefined, director: { tool: settings.tool, group, variant: image.variant },
            name: `${stem(parent.name)}-${directorName(settings.tool)}-${++owner.resultCount}${image.variant ? `-${image.variant}` : ""}.png` });
          versions.push(version);
        }
        owner.directorChoices[group] = versions[0].id;
        // Keep the viewed source in place. The result is available in the rail,
        // including when the user has moved to another EDIT board or workspace.
        emit();
        emit();
      }, controller.signal);
      if (result.status !== "completed") throw new Error(result.status === "busy" ? "另一个绘图任务正在进行" : "数据维护中，请稍后再试");
    } catch (e) {
      owner.error = e instanceof DOMException && e.name === "AbortError" ? "已停止等待，上游可能仍在处理" : failure(e);
    } finally {
      preparing = false; busy = false; taskOwner = undefined; taskAbort = undefined; emit();
      void refreshQuota(); void drawing.refreshQuota(true); requote(0);
    }
  }
  async function run(key: Job = "edit") {
    if (
      busy ||
      preparing ||
      reading ||
      !canRun(key) ||
      services.data.phase !== "ready"
    )
      return;
    const owner = current;
    taskOwner = owner;
    const shownCost = jobs[key].quote?.cost ?? null;
    preparing = true;
    emit();
    let p: Awaited<ReturnType<typeof payload>>;
    try {
      p = await payload(key, true);
    } catch (e) {
      jobs[key].error = failure(e);
      preparing = false;
      taskOwner = undefined;
      emit();
      return;
    }
    if (disposed) {
      preparing = false;
      taskOwner = undefined;
      return;
    }
    preparing = false;
    busy = true;
    running = p.mode;
    runningEnhance = p.payload.enhance === true;
    owner.error = "";
    startedAt = Date.now();
    upscaleOpen = false;
    cancelQuote("edit");
    cancelQuote("upscale");
    cancelQuote("director"); directorOpen = false;
    const controller = (taskAbort = new AbortController());
    emit();
    try {
      const result = await services.runTask(
        {
          id: crypto.randomUUID(),
          workspace: "editor",
          sessionId: p.owner.id,
          snapshot: p.payload,
        },
        async (task) => {
          const onSource = (source: SourceSelection) => {
            p.model = source.model;
            if (current === p.owner) { applySource(source); emit(); }
          };
          const options = { shownCost, onNotice: (n: string) => ui.toast(n), signal: task.signal };
          const plan = p.payload.referencePlan;
          let referenceGateway: ReturnType<typeof task.gateway> | undefined;
          if (plan) {
            const pendingCost = await services.references.pendingCost(plan, p.model.id);
            const source = await services.selectSource(p.model, task.signal, { ...p.payload, referenceMinimum: referenceSurcharge(plan) + pendingCost });
            if (source.insufficient) throw new Error(source.insufficient);
            onSource(source);
            const client = task.gateway(p.model.connection);
            referenceGateway = client;
            p.payload.preparedReferences = await services.references.prepare(plan, p.model.id, task.signal, async (image, information) => {
              const balance = await client.quota(p.model.quotaGroup, task.signal).catch(() => { task.signal.throwIfAborted(); return null; });
              const reason = insufficientFunds(p.model, balance, null, { ...p.payload, referenceMinimum: 2 + referenceSurcharge(plan) });
              if (reason) throw new Error(reason);
              return client.encodeVibe(p.model.id, image, information, task.signal);
            });
          }
          // Paid reference preparation fixes the source for this run; never re-route or retry it.
          const consume = async (r: Response, n: boolean, signal: AbortSignal) => {
            // A 4× result can exceed the usual ZIP bound. Allow one RGBA output plus PNG overhead.
            const upscaleBytes = p.model.profileId === "nai-official-v1" && p.mode === "upscale"
              ? Math.max(32 * 1024 * 1024, p.parent.width * p.parent.height * NAI_OFFICIAL_UPSCALE.factor ** 2 * 4 + 1024 * 1024) : undefined;
            const blocks = await consumeMedia(r, n, signal, p.payload, upscaleBytes ? { maxImageBytes: upscaleBytes, maxTotalBytes: upscaleBytes } : undefined);
            if (p.model.profileId === "nai-official-v1") for (const block of blocks) {
              if (block.type !== "image") continue;
              if (p.mode === "inpaint") {
                block.blob = p.focusOriginal
                  ? await composeFocusedInpaint(p.focusOriginal.png, p.focusOriginal.mask, block.blob, p.focusOriginal.focus, signal)
                  : await composeInpaint(String(p.payload.init_image), String(p.payload.mask_image), block.blob, signal);
                if (p.focusOriginal) block.size = { width: p.parent.width, height: p.parent.height };
              }
              if (p.mode === "upscale" && (block.size.width !== p.parent.width * NAI_OFFICIAL_UPSCALE.factor || block.size.height !== p.parent.height * NAI_OFFICIAL_UPSCALE.factor))
                throw new Error("放大结果尺寸不符合 4× 输出，未写入编辑版本，请勿重复提交");
              if (p.payload.enhance) {
                const expected = naiEnhanceSize(p.parent, p.payload.enhanceScale, p.model.id);
                if (block.size.width !== expected.width || block.size.height !== expected.height)
                  throw new Error("Enhance 结果尺寸与请求不一致，未写入编辑版本，请勿重复提交");
              }
            }
            return blocks;
          };
          const output = await (referenceGateway ? referenceGateway.execute(p.payload, consume, {
            ...options, beforeSubmit: async (freshQuote) => {
              const balance = await referenceGateway.quota(p.model.quotaGroup, task.signal).catch(() => { task.signal.throwIfAborted(); return null; });
              const reason = insufficientFunds(p.model, balance, freshQuote, p.payload);
              if (reason) throw new Error(reason);
            },
          }) : task.execute(p.model, p.payload, consume, { ...options, onSource }));
          task.signal.throwIfAborted();
          let last: EditorVersion | undefined;
          for (const block of output.value) {
            if (block.type !== "image") continue;
            const { init_image, mask_image, referencePlan, preparedReferences, ...settings } = p.payload;
            const params: Fields =
              p.mode === "upscale"
                ? { model: p.model.id, tool: "upscale", via: output.via, width: block.size.width, height: block.size.height,
                  ...(p.model.profileId === "nai-official-v1" ? { upscaleModel: NAI_OFFICIAL_UPSCALE.model, upscaleFactor: NAI_OFFICIAL_UPSCALE.factor } : {}) }
                : ({ ...p.settings, ...settings, width: block.size.width, height: block.size.height,
                    noise_schedule: p.model.profileId === "nai-official-v1" ? naiNoiseSchedule(p.model.id, String(p.payload.sampler), p.payload.noiseSchedule ?? p.payload.noise_schedule) : "karras",
                    varietyPlus: supportsNaiVariety(p.model) && p.payload.varietyPlus === true,
                    ...(p.model.profileId === "nai-official-v1" && p.mode === "inpaint" ? { noise: 0 } : {}),
                    cfgRescale: typeof p.payload.cfg_rescale === "number" ? p.payload.cfg_rescale : 0, tool: p.mode, via: output.via } as Fields);
            Object.assign(params, originOf(p.owner, p.parent), { editId: crypto.randomUUID(), editParent: parentIdentity(p.parent), editedAt: new Date().toISOString() });
            last = await addVersion(p.owner, {
              kind: "result",
              blob: block.blob,
              ...block.size,
              parentId: p.parent.id,
              mode: p.mode,
              model: p.model,
              quote: output.quote ?? undefined,
              params,
              name: `${stem(p.parent.name)}-${p.payload.enhance ? p.payload.enhanceScale === "max" ? "Enhance-Max" : "Enhance" : p.focusOriginal ? "聚焦重绘" : modeNames[p.mode]}-${++p.owner.resultCount}.${block.blob.type === "image/jpeg" ? "jpg" : block.blob.type.split("/")[1]}`,
            });

          }
          if (last) {
            if (
              p.mode === "upscale" &&
              last.width <= p.parent.width &&
              last.height <= p.parent.height
            )
              ui.toast("放大后尺寸没有变化", "warn");
            p.owner.viewId = last.id;
            if (current === p.owner) maskPort?.save();
            alignMask(p.owner, last);
            if (p.mode === "inpaint") p.owner.appliedMaskRevision = p.owner.maskRevision;
            emit();
          }
        },
        controller.signal,
      );
      if (result.status !== "completed")
        throw new Error(
          result.status === "busy"
            ? "另一个绘图任务正在进行"
            : "数据维护中，请稍后再试",
        );
    } catch (e) {
      owner.error =
        e instanceof DOMException && e.name === "AbortError"
          ? "已停止等待，上游可能仍在处理"
          : failure(e);
    } finally {
      busy = false;
      taskOwner = undefined;
      taskAbort = undefined;
      emit();
      void refreshQuota();
      void drawing.refreshQuota(true);
      requote(0);
    }
  }
  function switchBoard(id: string) {
    const next = sessions.get(id);
    if (!next || next === current) return !!next;
    if (preparing || reading || external || maskPort?.isDrawing()) {
      ui.toast("请先完成当前编辑操作"); return false;
    }
    maskPort?.save();
    cancelQuote("edit"); cancelQuote("upscale"); cancelQuote("director");
    ++readSequence; ++openSequence;
    askPanels.set(current,{upscaleOpen,directorOpen});
    current = next; upscaleOpen = askPanels.get(next)?.upscaleOpen??false; directorOpen = askPanels.get(next)?.directorOpen??false; quota = null;
    normalize(); emit(); requote(0); if (open) void refreshQuota();
    return true;
  }
  function createBoard() {
    if (preparing || reading || external || maskPort?.isDrawing()) return;
    const next = session(crypto.randomUUID(), "edit", undefined, nextBoard++);
    next.name = "编辑画板 " + (sessions.size + 1);
    sessions.set(next.id, next); switchBoard(next.id);
    return next.id;
  }
  const stopReferences = services.references.subscribe(emit);
  const stopDrawing = drawing.subscribe(emit);
  const stopConnect = services.connections.subscribeImages(() => {
    if (open) void catalog();
  });
  const unregister = services.data.register({
    async flush() {},
    async reload() {
      cancelQuote("edit");
      cancelQuote("upscale");
      cancelQuote("director");
    },
    ready() {
      if (open && !disposed) void catalog();
    },
  });
  const leave = (e: BeforeUnloadEvent) => {
    if (
      busy ||
      reading ||
      [...sessions.values()].some((s) => s.versions.length)
    ) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", leave);
  function canRun(key: Job) {
    if (external || busy || preparing) return false;
    const m = selected(key === "upscale" ? "upscale" : current.mode);
    if (!m) return false;
    if (key === "edit" && current.mode === "inpaint" &&
        (current.maskFor !== current.baseId || !maskPort || maskPort.isDrawing() || !maskPort.getMask())) return false;
    const profile = profileFor(m.profileId || STANDARD_PROFILE_ID);
    return draftPaused.has(current) || !!jobs[key].quote || !profile.quote.supported && !profile.costCeiling;
  }
  return {
    askSnapshot,
    async insertAskBoard(target:EditDraftState,record:ImageRecord,origin:'image'|'chat'|'edit') {
      if(sessions.has(target.id))throw new Error('目标编辑画板已存在');
      const size=await validateEditImage(record.blob);
      const s=session(target.id,origin,typeof record.params.chatConversationId==='string'?record.params.chatConversationId:undefined,nextBoard++);
      const {upscaleOpen:_up,directorOpen:_dt,...config}=structuredClone(target.config);
      Object.assign(s,config);s.name=target.name;s.sourceKey=`record:${record.id}`;s.provenance=imageOrigin(record.params);s.initialized=true;
      sessions.set(s.id,s);draftPaused.add(s);askPanels.set(s,{upscaleOpen:_up,directorOpen:_dt});
      try {const v=await addVersion(s,{kind:'source',sourceRecord:record,blob:record.blob,name:s.name,...size,parentId:0,params:record.params,sourceId:`record:${record.id}`});s.baseId=s.viewId=v.id;emit();}
      catch(error){sessions.delete(s.id);for(const v of s.versions)URL.revokeObjectURL(v.url);throw error;}
    },
    removeAskBoard(id:string) {
      const s=sessions.get(id);if(!s||s.versions.length!==1||s.maskRevision||photopeaUsed.has(s)||s.externalPending||taskOwner===s)return false;
      if(current===s){const next=[...sessions.values()].find(b=>b!==s)??session(crypto.randomUUID(),'edit',undefined,nextBoard++);sessions.set(next.id,next);draftPaused.add(next);current=next;upscaleOpen=false;directorOpen=false;for(const key of ['edit','upscale','director'] as const)cancelQuote(key);}
      sessions.delete(id);for(const v of s.versions)URL.revokeObjectURL(v.url);emit();return true;
    },
    gotoAskBoard(id:string) { if(switchBoard(id))router.switchWorkspace('edit'); },
    writeAskDraft(id:string,before:EditConfiguration,after:EditConfiguration) {
      const s=sessions.get(id),snapshot=askSnapshot(id);
      if(!s||!snapshot)throw new Error('编辑画板已关闭');
      if(snapshot.blocked)throw new Error(snapshot.blocked);
      if(canonical(configuration(s))!==canonical(before))throw new Error('编辑配置已变化');
      const {upscaleOpen:up,directorOpen:dt,...values}=structuredClone(after);
      draftPaused.add(s);askPanels.set(s,{upscaleOpen:up,directorOpen:dt});Object.assign(s,values);s.nextCharacterId=Math.max(s.nextCharacterId,nextCharacterId(s.characters));s.updatedAt=Date.now();
      if(s===current){cancelQuote('edit');cancelQuote('upscale');cancelQuote('director');for(const job of Object.values(jobs)){job.quote=null;job.price='';}upscaleOpen=up;directorOpen=dt;}
      emit();
    },
    async prepareAsk() { for(const s of sessions.values()) maskSummary(s); await Promise.all([...geometryJobs.values()].map(job=>job.done)); },
    /** Metadata for HOME; raster coverage is sampled only after a committed mask revision. */
    pendingEdits() {
      return [...sessions.values()].flatMap(s => {
        if (!s.versions.length) return [];
        let coverage = maskCoverage.get(s);
        if (!coverage || coverage.revision !== s.maskRevision) {
          let value = false;
          if (s.mask && (s.mask.position || s.mask.base)) {
            const renderer = createMaskEditor(document.createElement('canvas'), () => {});
            try { renderer.restore(s.mask); value = renderer.hasCoverage(); } finally { renderer.dispose(); }
          }
          coverage = { revision: s.maskRevision, value }; maskCoverage.set(s, coverage);
        }
        return [{ boardId: s.id, params: s.provenance, mask: coverage.value && s.maskRevision !== s.appliedMaskRevision, photopea: !!s.externalPending }];
      });
    },
    snapshot: () => ({
      boards: [...sessions.values()].map(s => ({ id: s.id, name: s.name, count: s.versions.length, busy: taskOwner === s })),
      runningBoardId: taskOwner?.id,
      session: {
        ...current,
        fields: { ...current.fields },
        versions: [...current.versions],
        chosen: { ...current.chosen },
        strength: { ...current.strength },
        noise: { ...current.noise },
        enhance: { ...current.enhance },
        focus: { on: current.focus.on, rect: current.focus.rect ? { ...current.focus.rect } : null },
        options: { ...current.options },
        director: structuredClone(current.director), directorChoices: { ...current.directorChoices },
      },
      contextId: contextId(),
      externalId: external?.id,
      referenceSupported: referenceSupported(),
      referenceKinds: referenceKinds(),
      referenceProblem: referenceProblem(),
      characterCapability: characterCapability(current.chosen[current.mode]),
      characterProblem: characterProblem(),
      models,
      samplers,
      model: selected(),
      focusing: focusing(),
      focusAvailable: focusAvailable(),
      enhancing: enhancing(),
      enhanceAvailable: enhanceAvailable(),
      enhanceScales: base() ? availableEnhanceScales(base()!, current.chosen.img2img) : [],
      upscaleModel: selected("upscale"),
      base: base(),
      viewed: viewed(),
      quota,
      accountModel: quotaSelection(),
      open,
      upscaleOpen,
      directorOpen,
      director: { available: !!directorModel(), warning: directorWarning(), size: (() => { try { return viewed() ? directorSize(viewed()!) : null; } catch { return null; } })(),
        canRun: !!directorModel() && !!viewed() && !busy && !preparing && !reading && !external && !directorWarning(),
        quote: jobs.director.quote, error: jobs.director.error },
      busy: busy && taskOwner === current,
      reading,
      preparing: preparing && taskOwner === current,
      saving: !!viewed() && saves.has(viewed()!),
      favorite: !!viewed() && drawing.snapshot().favorites.some(r => r.id === viewed()?.recordId),
      runError: current.error,
      running,
      runningEnhance,
      runningDirector,
      startedAt,
      edit: {
        canRun: canRun("edit"),
        quote: jobs.edit.quote,
        error: jobs.edit.error,
        price: jobs.edit.price,
      },
      upscale: {
        canRun: canRun("upscale"),
        quote: jobs.upscale.quote,
        error: jobs.upscale.error,
        price: jobs.upscale.price,
      },
      warning: warning("edit"),
      upscaleWarning: warning("upscale"),
    }),
    get session() {
      return current;
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setMaskPort(port: typeof maskPort) {
      maskPort = port;
    },
    changed,
    run,
    runDirector,
    directorToggle(value: boolean) {
      directorOpen = value;
      if (value) { upscaleOpen = false; cancelQuote("upscale"); cancelQuote("edit"); scheduleDirectorQuote(0); }
      else { cancelQuote("director"); scheduleQuote("edit"); }
      if (quotaModel !== quotaSelection()) void refreshQuota();
      emit();
    },
    setDirectorTool(tool: string) {
      if (locked() || reading || !isDirectorTool(tool)) return;
      current.director.tool = tool; current.error = ""; current.updatedAt = Date.now(); scheduleDirectorQuote();
    },
    patchDirector(values: { prompt?: string; defry?: number; emotion?: string }) {
      if (locked() || reading) return;
      const tool = current.director.tool;
      if (tool !== "colorize" && tool !== "emotion") return;
      const options = current.director[tool];
      if (typeof values.prompt === "string") options.prompt = values.prompt.slice(0, 24000);
      if (typeof values.defry === "number" && Number.isInteger(values.defry) && values.defry >= 0 && values.defry <= 5) options.defry = values.defry;
      if (tool === "emotion" && directorEmotions.some(([value]) => value === values.emotion)) current.director.emotion.emotion = values.emotion as DirectorSettings["emotion"]["emotion"];
      current.error = ""; current.updatedAt = Date.now(); scheduleDirectorQuote();
    },
    addSource(blob: Blob, name = "图片") { return this.open("edit", blob, name); },
    switchBoard,
    createBoard,
    board(id: string) { return sessions.get(id); },
    boards() { return [...sessions.values()]; },
    renameBoard(id: string, name: string) { const s = sessions.get(id); if (s && name.trim()) { s.name = name.trim().slice(0, 100); s.updatedAt = Date.now(); emit(); } },
    removeBoard(id: string) {
      const s = sessions.get(id);
      if (!s || taskOwner === s || external?.owner === s || reading || preparing || [...saves.keys()].some(v => s.versions.includes(v))) return false;
      if (s === current) {
        const next = [...sessions.values()].find(b => b !== s);
        if (next) { if (!switchBoard(next.id)) return false; }
        else { if (!createBoard()) return false; }
      }
      sessions.delete(id);
      for (const v of s.versions) URL.revokeObjectURL(v.url);
      s.mask = undefined; s.versions = []; emit(); return true;
    },
    beginExternalEdit,
    applyExternalEdit,
    cancelExternalEdit(id: string, pending = false) {
      if (external?.id !== id) return;
      current.externalPending = pending;
      external = undefined; readSequence++; openSequence++; reading = false; emit(); requote(0);
    },
    importMask,
    writeMask,
    saveFavorite() { return saveFavorite(); },
    reference(v: EditorVersion) { const board=[...sessions.values()].find(s=>s.versions.includes(v)); return board ? qualifiedEditLabel(board,v) : ""; },
    records,
    record(id: string) { return records().find(r => r.id === id); },
    label: editLabel,
    locate(id: string, boardId?: string) {
      const owner = [...sessions.values()].find(s => (!boardId || s.id === boardId) && s.versions.some(v => v.recordId === id));
      const v = owner?.versions.find(v => v.recordId === id);
      if (!owner || !v || !switchBoard(owner.id)) return false;
      view(v.id); router.switchWorkspace("edit"); return true;
    },
    setBase,
    view,
    refreshQuota,
    async open(
      origin: "image" | "chat" | "edit",
      blob?: Blob,
      name?: string,
      options: {
        mode?: EditorMode;
        settings?: Fields;
        conversationId?: string;
        sourceId?: string;
      } = {},
    ) {
      if (preparing || reading || external || maskPort?.isDrawing()) {
        ui.toast("请先完成当前编辑操作"); router.switchWorkspace("edit"); return;
      }
      if (origin === "chat") await chat.start();
      const conversationId = options.conversationId || (origin === "chat" ? chat.snapshot().current.id : undefined);
      const sourceKey = typeof options.settings?.editId === "string" ? "edit:" + options.settings.editId : options.sourceId?.replace(/^(history|favorite):/, "record:");
      const existing = blob ? [...sessions.values()].find(s => options.settings?.editBoardId === s.id || sourceKey && s.sourceKey === sourceKey || s.versions.some(v =>
        s.origin === origin && s.conversationId === conversationId && v.blob === blob || sourceKey && (v.sourceId === sourceKey || v.params?.editId && "edit:" + v.params.editId === sourceKey || sourceKey === "record:" + v.recordId))) : current;
      if (existing) {
        if (!switchBoard(existing.id)) return;
        const revision = ++openSequence;
        open = true; router.switchWorkspace("edit"); emit();
        await catalog();
        if (revision !== openSequence || current !== existing || !open) return;
        if (options.mode === "img2img" || options.mode === "inpaint") this.setMode(options.mode);
        if (options.mode === "upscale") { upscaleOpen = true; emit(); scheduleQuote("upscale", 0); }
        return;
      }
      maskPort?.save();
      const next = !current.versions.length && taskOwner !== current ? current : session(crypto.randomUUID(), origin, conversationId, nextBoard++);
      next.origin = origin; next.conversationId = conversationId;
      next.name = stem(name || "编辑画板"); next.sourceKey = sourceKey;
      sessions.set(next.id, next);
      if (!switchBoard(next.id)) return;
      ++readSequence; reading = false;
      const revision = ++openSequence;
      open = true;
      upscaleOpen = false;
      router.switchWorkspace("edit");
      emit();
      const initialDrawing = drawing.snapshot(), initialForm = structuredClone(initialDrawing.form);
      const initialBoard = structuredClone(initialDrawing.boards.find(b => b.id === initialDrawing.activeBoardId));
      const initialSettings = options.settings ? structuredClone(options.settings) : null;
      await services.references.ready();
      await catalog();
      if (revision !== openSequence || !open) return;
      const form = initialForm;
      const settings: Fields | null =
        (initialSettings ? sourceRecipe(initialSettings) as Fields : null) ||
        (!current.initialized && origin === "image"
          ? { ...form, negative_prompt: form.negative }
          : null);
      if (settings && options.mode !== "upscale") {
        Object.assign(current.fields, readNaiSettings({ ...settings, cfgRescale: settings.cfgRescale ?? settings.cfg_rescale }));
        current.fields.transparentBg = settings.transparentBg === true;
        current.fields.prompt = String(settings.basePrompt ?? settings.prompt ?? "");
        current.fields.negative_prompt = String(settings.baseNegative ?? settings.negative_prompt ?? settings.negative ?? "");
        current.naiReferences = readReferences(settings.naiReferences);
        current.characters = readCharacters(settings.localCharacters ?? settings.characters);
        current.nextCharacterId = Math.max(current.nextCharacterId, nextCharacterId(current.characters));
        current.placement = settings.placement === "manual" ? "manual" : "auto";
        const board = initialBoard;
        current.provenance = imageOrigin(settings);
        if (!options.settings && origin === "image" && board) current.provenance = { boardId: board.id, boardName: board.name, boardColor: board.color };
        for (const key of [
          "sampler",
          "steps",
          "scale",
        ] as const)
          if (settings[key] != null)
            Object.assign(current.fields, { [key]: settings[key] });
        if (settings.seed != null)
          current.fields.seed =
            Number(settings.seed) >= 0 ? String(settings.seed) : "";
        for (const mode of ["img2img", "inpaint"] as const) {
          const m = resolveModel(
            editorModels({ models }, mode),
            String(settings.model || ""),
          );
          if (m) current.chosen[mode] = m.id;
        }
        const tool = settings.tool === "inpaint" || settings.tool === "img2img" ? settings.tool : null;
        if (tool) for (const field of ["strength", "noise"] as const) {
          const value = settings[field];
          if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) current[field][tool] = value;
        }
        if (settings.enhance === true && isEnhanceScale(settings.enhanceScale)) {
          const magnitude = settings.enhanceMagnitude;
          current.enhance = { on: true, scale: settings.enhanceScale,
            magnitude: typeof magnitude === "number" && Number.isInteger(magnitude) && magnitude >= 1 && magnitude <= 5 ? magnitude : null,
            strength: typeof settings.strength === "number" ? settings.strength : .5,
            noise: typeof settings.noise === "number" ? settings.noise : 0 };
        }
        current.initialized = true;
      }
      if (options.mode === "inpaint" || options.mode === "img2img")
        current.mode = options.mode;
      normalize();
      if (quotaModel !== selected()) void refreshQuota();
      emit();
      if (blob) await loadSource(blob, name, initialSettings ?? undefined, sourceKey);
      if (revision !== openSequence || !open) return;
      const focus = readInpaintFocus(settings?.inpaintFocus);
      if (focus && base()?.width === focus.sourceWidth && base()?.height === focus.sourceHeight) current.focus = { on: true, rect: { x: focus.x, y: focus.y, width: focus.width, height: focus.height } };
      if (options.mode === "upscale" && viewed()) {
        upscaleOpen = true;
        emit();
        scheduleQuote("upscale", 0);
      }
      requote(0);
    },
    activate() {
      if (!open) {
        open = true;
        emit();
        void catalog();
      }
    },
    close() {
      maskPort?.save();
      external = undefined;
      ++readSequence; reading = false;
      open = false; upscaleOpen = false; ++openSequence;
      directorOpen = false; cancelQuote("edit"); cancelQuote("upscale"); cancelQuote("director"); emit();
      return true;
    },
    cancel() {
      taskAbort?.abort(new DOMException("已取消", "AbortError"));
    },
    patch(values: Partial<EditorSession["fields"]>) {
      if (locked() || reading) return;
      Object.assign(current.fields, values);
      changed();
    },
    referenceOwner(id: string) { return id === contextId() && open ? { form: { naiReferences: current.naiReferences } } : undefined; },
    async editReferences(value: NaiReferences, id = contextId()) {
      if (id !== contextId() || !open) throw new Error("编辑会话已切换，请重新添加参考");
      if (locked() || reading) throw new Error("正在运行，请稍后修改参考");
      current.naiReferences = readReferences(value); changed();
    },
    async editCharacters(chars: Character[], placement = current.placement, id = contextId()) {
      if (id !== contextId() || locked() || reading) return;
      current.characters = readCharacters(chars); current.placement = placement;
      current.nextCharacterId = Math.max(current.nextCharacterId, nextCharacterId(current.characters));
      changed();
    },
    async addCharacter(prompt = "") {
      const cap = characterCapability(current.chosen[current.mode]);
      if (locked() || reading || !cap.max || current.characters.length >= cap.max) return;
      const id = `c${current.nextCharacterId++}`;
      current.characters = [...current.characters, { id, on: true, prompt, negative: "", centers: [{ x: (current.characters.length + 1) / (current.characters.length + 2), y: .5 }] }];
      changed(); return id;
    },
    setMode(mode: EditMode) {
      if (locked() || reading) return;
      if (mode === "inpaint" && current.viewId !== current.baseId)
        setBase(current.viewId);
      current.mode = mode;
      normalize();
      changed(0);
    },
    setNumber(key: "strength" | "noise", value: number) {
      if (locked()) return;
      if (!Number.isFinite(value)) return;
      const official = selected()?.profileId === "nai-official-v1";
      const range = key === "strength" ? editStrengthRange(official, current.mode === "inpaint") : { min: 0, max: official ? .99 : 1 };
      if (value < range.min || value > range.max) return;
      if (enhancing()) { current.enhance[key] = value; current.enhance.magnitude = null; }
      else current[key][current.mode] = value;
      changed();
    },
    setFocus(on: boolean) {
      if (locked() || reading || maskPort?.isDrawing() || current.mode !== "inpaint" || on && !focusAvailable()) return;
      if (on && current.viewId !== current.baseId) setBase(current.viewId);
      current.focus.on = on; changed(0);
    },
    setFocusRect(rect: FocusRect | null) {
      const v = base();
      if (locked() || reading || !v || current.mode !== "inpaint" || !current.focus.on) return;
      if (rect && Object.values(rect).some(n => !Number.isFinite(n))) return;
      current.focus.rect = rect ? snapFocusRect(v, rect) : null; changed();
    },
    setEnhance(on: boolean) {
      if (locked() || reading || current.mode !== "img2img" || on && !enhanceAvailable()) return;
      if (on && current.viewId !== current.baseId) setBase(current.viewId);
      if (on && base()) {
        const scales = availableEnhanceScales(base()!, current.chosen.img2img);
        if (!scales.includes(current.enhance.scale) && scales.length) current.enhance.scale = scales[0];
      }
      current.enhance.on = on;
      normalize(); changed(0);
    },
    setEnhanceScale(value: number | string) {
      const scale = value === "max" ? value : Number(value);
      if (locked() || reading || !base() || !isEnhanceScale(scale) || !availableEnhanceScales(base()!, current.chosen.img2img).includes(scale)) return;
      current.enhance.scale = scale; changed();
    },
    setEnhanceMagnitude(magnitude: number) {
      if (locked() || reading || !Number.isInteger(magnitude) || magnitude < 1 || magnitude > 5) return;
      Object.assign(current.enhance, naiEnhanceMagnitudes[magnitude - 1], { magnitude }); changed();
    },
    setModel(id: string, mode: EditorMode = current.mode) {
      if (locked()) return;
      current.chosen[mode] = id;
      normalize();
      changed(mode === "upscale" ? 0 : 400);
    },
    setOption(key: string, value: string) {
      const m = selected("upscale");
      if (!m || locked()) return;
      current.options[m.id] = {
        ...(current.options[m.id] || normalizeOptions(m)),
        [key]: value,
      };
      changed();
    },
    upscaleToggle(value: boolean) {
      upscaleOpen = value;
      if (value) { directorOpen = false; cancelQuote("director"); }
      if (quotaModel !== selected(value ? "upscale" : current.mode)) void refreshQuota();
      emit();
      if (value) scheduleQuote("upscale", 0);
      else cancelQuote("upscale");
    },
    retry(key: Job, explicit = false) {
      if (explicit) draftPaused.delete(current);
      scheduleQuote(key, 0);
    },
    remove(id: number) {
      if (locked() || reading || id === current.baseId || current.versions.find(v => v.id === id)?.sequence === 1) return;
      const v = current.versions.find((v) => v.id === id);
      if (!v) return;
      const removed = v.director ? current.versions.filter(item => item.director?.group === v.director!.group) : [v];
      if (removed.some(item => item.id === current.baseId)) return;
      current.versions = current.versions.filter(item => !removed.includes(item));
      for (const item of removed) URL.revokeObjectURL(item.url);
      if (v.director) delete current.directorChoices[v.director.group];
      if (current.mask && removed.some(item => current.mask!.anchor === item.id || current.mask!.strokes.some(e => "bitmap" in e && e.baseId === item.id))) {
        current.mask = { ...current.mask, anchor: undefined, strokes: current.mask.strokes.map(e => "bitmap" in e ? { bitmap: e.bitmap } : e) };
        current.maskRevision++;
      }
      if (removed.some(item => item.id === current.viewId)) { current.viewId = current.baseId; const v = base(); if (v) alignMask(current, v); }
      changed();
    },
    async useResult() {
      const owner = current, v = viewed(), conversationId = owner.conversationId;
      if (!v || owner.origin !== "chat" || !conversationId || locked()) return;
      try {
        await chat.useEditorResult(conversationId, {
          blob: v.blob,
          name: v.name,
          size: { width: v.width, height: v.height },
        });
        if (current !== owner || router.route.value.workspace !== "edit") return;
        const source = chat.snapshot().conversations.find(c => c.id === conversationId);
        if (source) chat.switchConversation(source);
        router.switchWorkspace("chat");
      } catch (e) {
        owner.error = failure(e);
        emit();
      }
    },
    dispose() {
      for(const job of geometryJobs.values()) job.cancel(); geometryJobs.clear();
      disposed = true;
      taskAbort?.abort();
      catalogAbort?.abort();
      cancelQuote("edit");
      cancelQuote("upscale");
      cancelQuote("director");
      stopConnect();
      stopReferences();
      stopDrawing();
      unregister();
      window.removeEventListener("beforeunload", leave);
      for (const s of sessions.values())
        for (const v of s.versions) URL.revokeObjectURL(v.url);
      external = undefined;
      sessions.clear();
      current.mask = undefined;
      current.versions = [];
      listeners.clear();
    },
  };
}
export type Editor = ReturnType<typeof createEditor>;
