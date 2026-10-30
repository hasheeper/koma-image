<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue";
import { useShell } from "../app/shell";
import { useServices } from "../app/services";
import { useDrawing } from "../app/drawing";
import { useChat } from "../app/chat";
import { useEditor } from "../app/editor";
import { useUi, message } from "../app/ui";
import { useDialog } from "./use-dialog";
import BrandMark from "../shared/BrandMark.vue";
import AppIcon from "../shared/AppIcon.vue";
import ModelIcon from "../shared/ModelIcon.vue";
import ConnectionAvatar from "../shared/ConnectionAvatar.vue";
import ModelsSection from "./settings/ModelsSection.vue";
import ModelListDialog from "./settings/ModelListDialog.vue";
import BackupSection from "./settings/BackupSection.vue";
import GeneralSection from "./settings/GeneralSection.vue";
import AskSection from "./settings/AskSection.vue";
import AskModelDialog from "./settings/AskModelDialog.vue";
import type { SettingsSection } from "../app/routes";
import type { Connection, Routing } from "../config/connections.ts";
import {
  normalizeBaseUrl,
  validateRouting,
  validateModelLinks,
  LOCAL_CONNECTION_ID,
  orderedConnections,
  imageConnections,
  reasoningConnections,
} from "../config/connections.ts";
import { STANDARD_PROFILE_ID, connectionProfiles, profileFor, NOVELAI_IMAGE_URL } from "../gateway/profile.ts";
import { testConnection } from "../gateway/connection-test.ts";
import { novelaiConnectionLabel } from "../gateway/native-protocols.ts";
import { object } from "../domain/value.ts";
import { novelaiUsage } from "../domain/quota.ts";
import { MODELS } from "../domain/models.ts";
import { catalogEntries, sourceState, modelSource } from "../domain/catalog.ts";
import { download } from "../shared/files";
import { names } from "../storage/names.ts";
import { readAskSettings } from "../ask/settings.ts";
import type { AskSettings } from "../ask/settings.ts";
import { placeMenu, menuKeys } from "../shared/popover";
const { router } = useShell(),
  services = useServices(),
  ui = useUi();
const { connections, vault, preferences } = services;
const { view: drawingView } = useDrawing(), { view: chatView } = useChat(), { view: editorView } = useEditor();
const currentModel = computed(() => editorView.value.open
  ? editorView.value.upscaleOpen ? editorView.value.upscaleModel : editorView.value.model
  : router.route.value.workspace === "chat" ? chatView.value.model : drawingView.value.model);
const local = connections.local;
const supplierLogo = `${import.meta.env.BASE_URL}assets/favicon-image.svg`;
const dialog = useTemplateRef<HTMLDialogElement>("dialog"),
  form = useTemplateRef<HTMLDialogElement>("connectionForm"),
  formKey = useTemplateRef<HTMLInputElement>("connectionKey");
const modelsSection =
  useTemplateRef<InstanceType<typeof ModelsSection>>("modelsSection");
const importInput = useTemplateRef<HTMLInputElement>("importInput");
const busy = ref(false),
  version = ref(0),
  routing = shallowRef<Routing>(connections.configuration);
const raw = shallowRef<Record<string, unknown>>({}),
  balances = shallowRef<Record<string, Record<string, unknown>>>({});
const statuses = ref<Record<string, { s: string; text: string }>>({}),
  testing = ref<string | null>(null),
  listConnection = ref<string | null>(null),
  askList = ref<string | null>(null);
const askListPurpose = ref<"ask" | "naming">("ask");
function openAskModels(id: string, purpose: "ask" | "naming" = "ask") {
  askListPurpose.value = purpose;
  askList.value = id;
}
// The connection form adds a connection, or edits one when it has a target.
const formTarget = ref<string | null>(null),
  formName = ref(""),
  formProfile = ref(STANDARD_PROFILE_ID),
  formUrl = ref(""),
  formError = ref(""),
  formBusy = ref(false),
  formKeyVisible = ref(false),
  formRemember = ref(true);
let formKeyTouched = false, formKeyFromSaved = false;
const { requestClose, cancel, closed } = useDialog(
  "settings",
  dialog,
  () => !busy.value && !formBusy.value,
);
const sections: { id: SettingsSection; label: string; icon: string }[] = [
  { id: "connections", label: "连接", icon: "swap" },
  { id: "models", label: "模型", icon: "model" },
  { id: "general", label: "通用", icon: "settings" },
  { id: "security", label: "安全与备份", icon: "lock" },
  { id: "ask", label: "ASK", icon: "ask" },
];
// Keep existing backup links usable within the combined settings page.
const activeSection = computed(() =>
  router.route.value.section === "backup"
    ? "security"
    : router.route.value.section,
);
const mode = computed(() => {
  version.value;
  return vault.mode();
});
const formHasKey = computed(() => {
  version.value;
  const c = formTarget.value ? routing.value.connections[formTarget.value] : undefined;
  return Boolean(c && vault.key(c.credentialRef));
});
const endpoint = (url: string) => url.replace(/^https:\/\//, "");
// A healthy status shows its first clause ("可用"); the full text stays in the tooltip. Problems show in full.
const statusLabel = (status?: { s: string; text: string }) =>
  !status ? "未检查" : status.s === "ok" ? status.text.split(/ · |，/)[0] : status.text;
const pools: [string, string, string][] = [
  ["novelai-v5", "novelai", "V5"],
  ["novelai-v4.5", "novelai", "V4.5"],
  ["openai", "gpt", "OpenAI"],
  ["gemini", "gemini", "Gemini"],
];
const amount = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
    : "—";
type Meter = { key: string; label: string; value: string; family?: string; limit?: string; ratio?: number; estimatedImages?: number; hints?: string[] };
function meters(c: Connection): Meter[] {
  const media = balances.value[c.id], profile = profileFor(c.profileId);
  if (!media || (profile.quotaPolicy.supported === false && profile.protocol !== "novelai")) return [];
  const credits = amount(object(media.credits).remaining);
  if (profile.protocol === "novelai") {
    const result: Meter[] = [{ key: "anlas", label: "Anlas", value: credits }];
    const usage = novelaiUsage(media.subscription);
    if (!usage) return result;
    const hints: string[] = [];
    if (usage.entitlement === "inactive") hints.push("未订阅 · 不可用");
    else if (usage.entitlement === "other") hints.push("非 Opus 订阅");
    else if (usage.entitlement === "unknown") hints.push("订阅权益未知");
    if (usage.unavailable === true) hints.push("额度暂不可用");
    if (usage.percent === null) hints.push("用量未知");
    else if (usage.unavailable === null) hints.push("可用状态未知");
    result.push({ key: "nai-v5", label: "V5 额度", family: "novelai", value: usage.percent === null ? "—" : `${amount(usage.percent)}%`, ratio: usage.ratio, estimatedImages: usage.estimatedImages ?? undefined, hints });
    if (usage.purchasedPercent !== null && usage.purchasedPercent > 0)
      result.push({ key: "nai-v5-purchased", label: "V5 加购", family: "novelai", value: `${amount(usage.purchasedPercent)}%` });
    return result;
  }
  const images = object(media.images);
  return [
    { key: "credits", label: "媒体积分", value: credits },
    ...pools.flatMap(([group, family, label]) => {
      if (!images[group]) return [];
      const pool = object(images[group]), limit = typeof pool.limit === "number" && pool.limit > 0 ? pool.limit : 0;
      return [{
        key: group, family, label, value: amount(pool.remaining),
        limit: limit ? amount(limit) : undefined,
        ratio: limit && typeof pool.remaining === "number" ? Math.max(0, Math.min(1, pool.remaining / limit)) : undefined,
      }];
    }),
  ];
}
function availableModels(id: string) {
  return MODELS.filter(
    (m) =>
      sourceState(routing.value, id, m, catalogEntries(raw.value[id])) === "on",
  );
}
const activeModels = (id: string) => MODELS.filter(m => modelSource(routing.value, raw.value, m) === id).map(m => m.id);
const imageSources = computed(() => imageConnections(routing.value));
// Independent capability lists: a supplier with both configured interfaces belongs in both sections.
const connectionGroups = computed(() => [
  { id: "image", label: "图像", icon: "i-image", connections: imageSources.value },
  { id: "llm", label: "文本", icon: "i-chat", connections: reasoningConnections(routing.value) },
]);
const priorityIndex = (id: string) => imageSources.value.findIndex(c => c.id === id);
async function moveConnection(id: string, delta: number) {
  if (local || busy.value) return;
  const other = imageSources.value[priorityIndex(id) + delta];
  if (!other) return;
  const next = structuredClone(routing.value);
  const order = orderedConnections(next).map(c => c.id), from = order.indexOf(id), to = order.indexOf(other.id);
  [order[from], order[to]] = [order[to]!, order[from]!];
  next.order = order;
  busy.value = true;
  try { await commit(next); } finally { busy.value = false; }
}
// One menu per card, opened by its own ⋯ button; it closes on scroll or resize like the chat menus.
let openMenu: { pop: HTMLElement; off: AbortController } | undefined;
const menuId = (id: string, group: string) => `connection-menu-${group}-${id}`;
function closeMenu() {
  if (openMenu?.pop.matches(":popover-open")) openMenu.pop.hidePopover();
  openMenu?.off.abort();
  openMenu = undefined;
}
function toggleMenu(event: Event) {
  const pop = event.currentTarget as HTMLElement;
  if ((event as ToggleEvent).newState !== "open") {
    if (openMenu?.pop === pop) closeMenu();
    delete pop.dataset.placed;
    return;
  }
  openMenu?.off.abort();
  const off = new AbortController(),
    close = () => pop.matches(":popover-open") && pop.hidePopover();
  openMenu = { pop, off };
  const trigger = dialog.value?.querySelector(`[popovertarget="${CSS.escape(pop.id)}"]`);
  if (trigger) placeMenu(pop, trigger.getBoundingClientRect());
  pop.dataset.placed = "";
  window.addEventListener("resize", close, { signal: off.signal });
  document.addEventListener("scroll", close, { capture: true, passive: true, signal: off.signal });
}
type ConnectionCheck = { controller: AbortController; contextKey: string; promise: Promise<void> };
const checks = new Map<string, ConnectionCheck>(), queuedChecks = new Set<string>();
let catalogKeys = new Map(Object.keys(routing.value.connections).map(id => [id, connections.catalogKey(id)]));
let loadQueued = false, disposed = false;
function stopChecks(ids: Iterable<string> = checks.keys()) {
  for (const id of ids) { checks.get(id)?.controller.abort(); checks.delete(id); }
}
function queueLoad(ids: Iterable<string>) {
  for (const id of ids) queuedChecks.add(id);
  if (loadQueued || disposed || !queuedChecks.size) return;
  loadQueued = true;
  queueMicrotask(() => {
    loadQueued = false;
    const ids = [...queuedChecks];
    queuedChecks.clear();
    if (!disposed) void load(false, ids);
  });
}
async function loadConnection(id: string, force = false) {
  const c = routing.value.connections[id], key = connections.catalogKey(id);
  if (!c) return;
  if (!key) {
    statuses.value[id] = { s: "wait", text: "未配置 Key" };
    return;
  }
  const contextKey = connections.context(id).cacheKey, previous = checks.get(id);
  if (!force && previous?.contextKey === contextKey) return previous.promise;
  previous?.controller.abort();
  const controller = new AbortController(), { signal } = controller;
  const check: ConnectionCheck = { controller, contextKey, promise: Promise.resolve() };
  checks.set(id, check);
  if (!raw.value[id]) statuses.value[id] = { s: "wait", text: "检查中…" };
  check.promise = (async () => {
    try {
      const gateway = services.gateway(id);
      const results = await Promise.allSettled([
        gateway.rawCatalog(force, signal), gateway.quota(undefined, signal),
      ]);
      if (disposed || signal.aborted || checks.get(id) !== check || connections.catalogKey(id) !== key) return;
      // A local source edit invalidates execution contexts, but must not replace a live list with an error.
      if (connections.context(id).cacheKey !== contextKey) { queueLoad([id]); return; }
      if (results[0].status === "fulfilled") {
        raw.value = { ...raw.value, [id]: results[0].value };
        statuses.value[id] = { s: "ok", text: gateway.profile.protocol === "novelai" ? novelaiConnectionLabel(results[0].value) : gateway.profile.reasoning ? "可用 · 推理尚未实测" : "可用 · 刚刚检查" };
      } else statuses.value[id] = { s: "err", text: message(results[0].reason) };
      if (results[1].status === "fulfilled") balances.value = { ...balances.value, [id]: results[1].value.media };
    } catch (error) {
      if (!disposed && !signal.aborted && checks.get(id) === check)
        statuses.value[id] = { s: "err", text: message(error) };
    } finally { if (checks.get(id) === check) checks.delete(id); }
  })();
  return check.promise;
}
async function load(force = false, ids = Object.keys(routing.value.connections)) {
  if (!dialog.value?.open) return;
  const shown = ["connections", "models"].includes(activeSection.value) ? ids : ids.filter(id => id === askList.value);
  await Promise.all(shown.map(id => loadConnection(id, force)));
}
const unconnections = connections.subscribe((_kind, change) => {
  routing.value = connections.configuration;
  version.value++;
  const nextKeys = new Map(Object.keys(routing.value.connections).map(id => [id, connections.catalogKey(id)]));
  const changed = [...new Set([...catalogKeys.keys(), ...nextKeys.keys()])]
    .filter(id => change.refresh || catalogKeys.get(id) !== nextKeys.get(id));
  if (changed.length) {
    stopChecks(changed);
    const nextRaw = { ...raw.value }, nextBalances = { ...balances.value };
    for (const id of changed) { delete nextRaw[id]; delete nextBalances[id]; delete statuses.value[id]; }
    raw.value = nextRaw;
    balances.value = nextBalances;
  }
  catalogKeys = nextKeys;
  if (listConnection.value && !routing.value.connections[listConnection.value]) listConnection.value = null;
  if (askList.value && !routing.value.connections[askList.value]) askList.value = null;
  if (dialog.value?.open) queueLoad(changed);
});
// A reasoning card says whether ASK uses it, with which model ID, or how many it picked there.
const readAsk = () => readAskSettings(preferences.get(names.ask, null));
const askUse = shallowRef(readAsk());
const unask = preferences.subscribe((key) => {
  if (!key || key === names.ask) askUse.value = readAsk();
});
const askModels = (id: string) => {
  const picked = askUse.value.models[id]?.length;
  return askUse.value.connectionId === id
    ? askUse.value.model ? `使用中 · ${askUse.value.model}` : "使用中"
    : picked ? `已选 ${picked} 个`
    : raw.value[id] ? `${catalogEntries(raw.value[id]).length} 个 ID` : "—";
};
// The ASK list loads only its own connection, wherever it opens; cards keep their own pass.
async function loadAsk(force = false) {
  const c = askList.value ? routing.value.connections[askList.value] : undefined;
  if (!c || (raw.value[c.id] && !force)) return;
  await loadConnection(c.id, force);
}
watch(askList, () => void loadAsk());
// Ticks land before the write settles, so quick clicks build on each other.
async function saveAsk(next: AskSettings) {
  askUse.value = next;
  try {
    await preferences.set(names.ask, next);
  } catch (error) {
    askUse.value = readAsk();
    ui.toast(message(error), "err");
  }
}
const unvault = vault.subscribe(() => {
  version.value++;
});
watch(
  () => [router.route.value.overlay, router.route.value.section],
  async ([overlay], previous) => {
    if (overlay !== "settings") {
      stopChecks();
      closeMenu();
      listConnection.value = null;
      askList.value = null;
      form.value?.close();
      return;
    }
    await nextTick();
    void load(false, previous?.[0] === "settings"
      ? Object.keys(routing.value.connections).filter(id => !raw.value[id])
      : Object.keys(routing.value.connections));
  },
  { immediate: true, flush: "post" },
);
onBeforeUnmount(() => {
  disposed = true;
  stopChecks();
  unconnections();
  unvault();
  unask();
  closeMenu();
  wipeKey();
  form.value?.close();
});
async function commit(value: Routing) {
  try {
    await connections.save(value);
  } catch (error) {
    ui.toast(message(error), "err");
  }
}
function wipeKey() {
  if (formKey.value) formKey.value.value = "";
  formKeyVisible.value = false;
  formKeyTouched = false;
  formKeyFromSaved = false;
}
function keyEdited() {
  formKeyTouched = true;
  formKeyFromSaved = false;
}
function toggleKey() {
  if (formBusy.value || !formKey.value) return;
  if (!formKeyVisible.value && !formKey.value.value && !formKeyTouched) {
    const c = formTarget.value ? routing.value.connections[formTarget.value] : undefined;
    const saved = c ? vault.key(c.credentialRef) : null;
    if (saved) {
      formKey.value.value = saved;
      formKeyFromSaved = true;
    }
  }
  formKeyVisible.value = !formKeyVisible.value;
}
function closeForm() {
  if (!formBusy.value) {
    wipeKey();
    form.value?.close();
  }
}
function add() {
  if (local || formBusy.value) return;
  formTarget.value = null;
  formName.value = "";
  formUrl.value = "";
  formProfile.value = STANDARD_PROFILE_ID;
  formRemember.value = true;
  formError.value = "";
  wipeKey();
  form.value?.showModal();
}
function edit(id: string) {
  const c = routing.value.connections[id];
  if (local || !c || formBusy.value) return;
  formTarget.value = id;
  formName.value = c.name;
  formUrl.value = c.baseUrl;
  formProfile.value = c.profileId;
  formRemember.value = vault.key(c.credentialRef) ? vault.remembered(c.credentialRef) : true;
  formError.value = "";
  wipeKey();
  form.value?.showModal();
}
function selectProtocol() {
  formError.value = "";
  const target = formTarget.value ? routing.value.connections[formTarget.value] : undefined;
  if (target && profileFor(formProfile.value).protocol === "novelai" && target.baseUrl !== NOVELAI_IMAGE_URL) {
    formProfile.value = target.profileId;
    formError.value = "请单独配置 NovelAI 官方供应商，并填写对应 Key";
    return;
  }
  if (profileFor(formProfile.value).protocol === "novelai") formUrl.value = NOVELAI_IMAGE_URL;
  else if (formUrl.value === NOVELAI_IMAGE_URL) formUrl.value = "";
}
async function saveForm() {
  if (local || formBusy.value) return;
  formError.value = "";
  formBusy.value = true;
  let stagedRef: string | undefined;
  try {
    const name = formName.value.trim();
    if (!name) throw new Error("请填写供应商名称");
    const baseUrl = normalizeBaseUrl(formUrl.value), next = structuredClone(routing.value);
    const previous = formTarget.value ? next.connections[formTarget.value] : undefined;
    if (formTarget.value && !previous) throw new Error("供应商已被删除，请重新配置");
    const input = formKeyFromSaved ? "" : formKey.value?.value.trim() ?? "", oldKey = previous ? vault.key(previous.credentialRef) : null;
    const endpointChanged = previous && (previous.baseUrl !== baseUrl || previous.profileId !== formProfile.value);
    if (endpointChanged && !input) throw new Error("地址或协议已更改，请重新填写对应的 API Key");
    if (!input && !oldKey) throw new Error("请填写 API Key");
    const id = previous?.id ?? `connection-${crypto.randomUUID()}`;
    // Stage a fresh reference so a new Key can never be paired with the previous destination.
    const replaceKey = !previous || Boolean(input && input !== oldKey) || endpointChanged;
    const credentialRef = replaceKey ? `key-${crypto.randomUUID()}` : previous.credentialRef;
    next.connections[id] = { id, name, baseUrl, profileId: formProfile.value, credentialRef, revision: previous?.revision ?? crypto.randomUUID() };
    if (previous && previous.profileId !== formProfile.value) next.links[id] = {};
    const validated = validateRouting(next);
    if (replaceKey) {
      await vault.setKey(credentialRef, input || oldKey!, formRemember.value);
      stagedRef = credentialRef;
    }
    await connections.save(validated);
    stagedRef = undefined;
    if (previous && previous.credentialRef !== credentialRef && !Object.values(connections.configuration.connections).some(c => c.credentialRef === previous.credentialRef)) {
      await vault.removeKey(previous.credentialRef);
    } else if (previous && !replaceKey && formRemember.value !== vault.remembered(credentialRef)) {
      await vault.setKey(credentialRef, oldKey!, formRemember.value);
    }
    wipeKey();
    form.value?.close();
  } catch (error) {
    if (stagedRef) {
      try { await vault.removeKey(stagedRef); } catch { /* An unreferenced Key cannot be used by any supplier. */ }
    }
    formError.value = message(error);
  } finally {
    formBusy.value = false;
  }
}
async function remove(id: string) {
  const c = routing.value.connections[id];
  if (!c) return;
  if (
    !(await ui.confirm({
      title: `删除「${c.name}」？`,
      message: "同时删除这个供应商的 Key 和模型来源，不可恢复。",
      confirmLabel: "删除",
      tone: "danger",
    }))
  )
    return;
  try {
    const next = structuredClone(routing.value);
    delete next.connections[id];
    delete next.links[id];
    await connections.save(next);
    if (!Object.values(connections.configuration.connections).some(item => item.credentialRef === c.credentialRef))
      await vault.removeKey(c.credentialRef);
  } catch (error) {
    ui.toast(message(error), "err");
  }
}
async function test(id: string) {
  if (testing.value) return;
  const connection = routing.value.connections[id];
  if (!connection) return;
  testing.value = id;
  const notice = ui.toast(`正在连接 ${connection.name}…`, "load");
  try {
    const result = await testConnection(connections.context(id));
    statuses.value[id] = result;
    ui.toast(`${connection.name} · ${result.text}`, result.s, undefined, notice);
    if (result.s === "ok") await load(true, [id]);
  } catch (error) {
    statuses.value[id] = { s: "err", text: message(error) };
    ui.toast(`${connection.name} · ${message(error)}`, "err", undefined, notice);
  } finally {
    testing.value = null;
  }
}
async function forget() {
  if (
    !(await ui.confirm({
      title: "清除全部 Key？",
      message: "删除本机保存的所有 Key，不可恢复。连接和模型来源保留。",
      confirmLabel: "清除",
      tone: "danger",
    }))
  )
    return;
  try {
    await vault.forget();
  } catch (error) {
    ui.toast(message(error), "err");
  }
}
function exportConfig() {
  download(
    new Blob(
      [
        JSON.stringify(
          local
            ? {
                app: "koma-image",
                kind: "local-models",
                version: 1,
                links: routing.value.links[LOCAL_CONNECTION_ID] || {},
              }
            : { app: "koma-image", kind: "routing", ...routing.value },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    "koma-image-settings.json",
    1000,
  );
}
async function importConfig(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error("配置文件过大");
    const parsed = JSON.parse(await file.text());
    if (
      local &&
      (parsed.app !== "koma-image" ||
        parsed.kind !== "local-models" ||
        parsed.version !== 1)
    )
      throw new Error("本地模式仅导入模型来源设置，连接由服务端管理");
    const value = local
      ? {
          ...routing.value,
          links: { [LOCAL_CONNECTION_ID]: validateModelLinks(parsed.links) },
        }
      : validateRouting(parsed);
    await connections.save(value);
    ui.toast("配置已导入", "ok");
  } catch (error) {
    ui.toast(message(error), "err");
  } finally {
    if (importInput.value) importInput.value.value = "";
  }
}
async function reveal(id: string) {
  listConnection.value = null;
  router.selectSection("models");
  await nextTick();
  modelsSection.value?.reveal(id);
  await nextTick();
  dialog.value
    ?.querySelector(`[data-model="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}
</script>
<template>
  <dialog
    ref="dialog"
    id="settingsPanel"
    class="settings set-ui"
    aria-labelledby="settingsTitle"
    @cancel="cancel"
    @close="closed"
  >
    <header class="topbar set-bar">
      <button
        class="ibtn set-back"
        type="button"
        aria-label="返回"
        data-tip="返回 · Esc"
        autofocus
        :disabled="busy"
        @click="requestClose"
      >
        <AppIcon name="i-back" />
      </button>
      <h2 id="settingsTitle" class="brand set-title" aria-label="设置">
        <BrandMark surface="settings" subtitle="SETTINGS" />
      </h2>
      <span class="set-saved"
        ><AppIcon name="i-check" /><span
          >改动即时保存，已同步到打开的页面</span
        ></span
      >
    </header>
    <div class="set-lay">
      <nav class="set-nav" aria-label="设置">
        <button
          v-for="section in sections"
          :key="section.id"
          type="button"
          :disabled="busy"
          :aria-current="activeSection === section.id ? 'true' : undefined"
          @click="router.selectSection(section.id)"
        >
          <AppIcon :name="`i-${section.icon}`" /><span>{{ section.label }}</span
          ><small>{{
            section.id === "connections"
              ? Object.keys(routing.connections).length
              : section.id === "models"
                ? MODELS.length
                : ""
          }}</small>
        </button>
      </nav>
      <div class="set-scroll">
        <div class="set-col">
          <section
            v-show="router.route.value.section === 'connections'"
            class="sp-sec"
            aria-label="连接"
          >
            <div class="sp-sec-head conn-sec-head">
              <h3>连接</h3>
              <button
                v-if="!local && Object.keys(routing.connections).length"
                class="btn btn-quiet btn-sm"
                type="button"
                @click="add"
              >
                <AppIcon name="i-plus" />配置供应商
              </button>
              <p v-if="local">连接由本地服务管理，模型来源可在此调整。</p>
            </div>
            <div
              v-if="!Object.keys(routing.connections).length"
              class="sp-empty conn-empty"
            >
              <ConnectionAvatar /><span>尚未配置连接</span
              ><button class="btn btn-quiet btn-sm" type="button" @click="add">
                配置供应商
              </button>
            </div>
            <template v-else>
            <section v-for="group in connectionGroups" :key="group.id" class="conn-group" :aria-label="`${group.label}供应商`" :data-kind="group.id">
              <h4 class="conn-group-title"><AppIcon :name="group.icon" />{{ group.label }}<small>{{ group.connections.length }}</small></h4>
              <div v-if="!group.connections.length" class="conn-group-empty">尚未配置{{ group.label }}供应商</div>
              <article
              v-for="c in group.connections"
              :key="c.id"
              class="conn-card"
            >
              <header class="conn-top">
                <ConnectionAvatar :connection="c" />
                <div class="conn-name">
                  <b>{{ c.name }}</b
                  ><span class="type">{{ profileFor(c.profileId).label }}</span>
                </div>
                <span class="conn-meta" :title="local ? undefined : c.baseUrl">{{
                  local ? "本机同源代理" : endpoint(c.baseUrl)
                }}</span>
                <span
                  class="st"
                  :data-s="testing === c.id ? 'wait' : statuses[c.id]?.s || 'wait'"
                  :title="statuses[c.id]?.text"
                  >{{ testing === c.id ? "测试中…" : statusLabel(statuses[c.id]) }}<template v-if="group.id === 'image' && currentModel?.connection === c.id"> · 当前使用</template></span
                >
                <div class="conn-acts">
                  <button
                    class="btn btn-quiet btn-sm conn-test"
                    type="button"
                    :disabled="Boolean(testing)"
                    aria-label="测试连接"
                    @click="test(c.id)"
                  >
                    <AppIcon name="i-retry" /><span>测试</span>
                  </button>
                  <template v-if="!local">
                    <button
                      class="btn btn-quiet btn-sm conn-more"
                      type="button"
                      aria-label="更多操作"
                      aria-haspopup="menu"
                      :popovertarget="menuId(c.id, group.id)"
                    >
                      <AppIcon name="i-more" />
                    </button>
                    <div
                      :id="menuId(c.id, group.id)"
                      class="menu conn-menu"
                      popover="auto"
                      role="menu"
                      :aria-label="`${c.name} 的操作`"
                      @toggle="toggleMenu"
                      @keydown="menuKeys"
                      @click="closeMenu"
                    >
                      <button class="menu-item" type="button" role="menuitem" @click="edit(c.id)">
                        <AppIcon name="i-rename" /><span>配置供应商</span>
                      </button>
                      <hr role="separator" />
                      <button
                        class="menu-item danger"
                        type="button"
                        role="menuitem"
                        @click="remove(c.id)"
                      >
                        <AppIcon name="i-trash" /><span>删除供应商</span>
                      </button>
                    </div>
                  </template>
                </div>
              </header>
              <div v-if="group.id === 'image' && meters(c).length" class="conn-meters">
                <div v-for="m in meters(c)" :key="m.key" class="conn-meter">
                  <span
                    ><ModelIcon v-if="m.family" :family="m.family" /><AppIcon
                      v-else
                      name="i-credit"
                    />{{ m.label }}</span
                  >
                  <div class="conn-meter-value">
                    <b>{{ m.value }}<i v-if="m.limit">/{{ m.limit }}</i></b>
                    <small
                      v-if="m.estimatedImages !== undefined"
                      class="conn-meter-estimate"
                      title="按官方基准估算：23 步、约 1MP，100% 约 1,730 张；实际随尺寸、步数和 Effort 变化。"
                    >约 {{ amount(m.estimatedImages) }} 张</small>
                  </div>
                  <span
                    v-if="m.ratio !== undefined"
                    class="conn-bar"
                    :style="{ '--p': `${m.ratio * 100}%` }"
                  ></span>
                  <small v-for="hint in m.hints" :key="hint" class="conn-meter-hint">{{ hint }}</small>
                </div>
              </div>
              <!-- Reasoning connections serve ASK only; their list picks ASK's IDs. -->
              <div v-if="group.id === 'llm'" class="conn-source-row">
              <button
                class="conn-models"
                type="button"
                @click="openAskModels(c.id)"
              >
                <span class="conn-model-label">ASK 模型</span
                ><span>{{ askModels(c.id) }}</span
                ><AppIcon name="i-chevron" />
              </button>
              </div>
              <div v-else class="conn-source-row">
                <button
                  class="conn-models"
                  type="button"
                  :disabled="!raw[c.id]"
                  :aria-label="raw[c.id] ? `查看 ${c.name} 的模型列表：共 ${catalogEntries(raw[c.id]).length} 个，可用 ${availableModels(c.id).length} 个` : `${c.name} 模型列表尚未加载`"
                  @click="listConnection = c.id"
                >
                  <span class="conn-model-label">模型</span>
                  <span class="conn-model-count">
                    <template v-if="raw[c.id]">
                      <b>{{ availableModels(c.id).length === catalogEntries(raw[c.id]).length
                        ? catalogEntries(raw[c.id]).length
                        : `${availableModels(c.id).length}/${catalogEntries(raw[c.id]).length}` }}</b>
                      {{ availableModels(c.id).length === catalogEntries(raw[c.id]).length ? '个可用' : '可用' }}
                    </template>
                    <template v-else>—</template>
                  </span>
                  <AppIcon name="i-chevron" />
                </button>
                <div class="conn-priority" role="group" :aria-label="`优先级，当前第 ${priorityIndex(c.id) + 1} 位`" :title="`优先级 ${priorityIndex(c.id) + 1}，越靠上越优先；明确额度不足时使用下一来源`">
                  <small>优先级 <b>{{ priorityIndex(c.id) + 1 }}</b></small>
                  <button class="md-act" type="button" :aria-label="`提高 ${c.name} 的优先级`" title="提高优先级" :disabled="local || busy || priorityIndex(c.id) === 0" @click="moveConnection(c.id, -1)"><AppIcon name="i-up" /></button>
                  <button class="md-act" type="button" :aria-label="`降低 ${c.name} 的优先级`" title="降低优先级" :disabled="local || busy || priorityIndex(c.id) === imageSources.length - 1" @click="moveConnection(c.id, 1)"><AppIcon name="i-down" /></button>
                </div>
              </div>
            </article>
            </section>
            </template>
          </section>
          <ModelsSection
            v-show="router.route.value.section === 'models'"
            ref="modelsSection"
            :routing="routing"
            :raw="raw"
            :statuses="statuses"
            :current-model="currentModel"
            @change="commit"
            @reload="load(true)"
          />
          <GeneralSection v-show="activeSection === 'general'" />
          <AskSection
            v-show="activeSection === 'ask'"
            :routing="routing"
            @models="openAskModels"
          />
          <div v-show="activeSection === 'security'" class="backup-sections">
            <section class="sp-sec" aria-label="安全">
              <div class="sp-sec-head"><h3>安全</h3></div>
              <div v-if="local" class="sp-group">
                <div class="s-row">
                  <div>
                    <b>本地服务管理</b>
                    <p>
                      Key
                      保存在服务端环境变量中，网页不保存或显示。修改配置后重启本地服务即可生效。
                    </p>
                  </div>
                  <span class="v sans dim">只读</span>
                </div>
              </div>
              <div v-else class="sp-group">
                <div class="s-row">
                  <div>
                    <b>API Key</b>
                  </div>
                  <button class="btn btn-quiet btn-xs" type="button" @click="router.selectSection('connections')">
                    配置供应商
                  </button>
                </div>
                <div v-if="mode !== 'empty'" class="s-row">
                  <div>
                    <b>清除全部 Key</b>
                    <p>
                      删除本机保存的所有 Key，不可恢复。连接和模型来源保留。
                    </p>
                  </div>
                  <button
                    class="btn btn-danger btn-xs"
                    type="button"
                    @click="forget"
                  >
                    清除
                  </button>
                </div>
              </div>
            </section>
            <BackupSection
              :active="
                router.route.value.overlay === 'settings' &&
                activeSection === 'security'
              "
              @busy="busy = $event"
            />
            <section class="sp-sec">
              <div class="sp-sec-head">
                <h3>{{ local ? "模型配置" : "连接与模型配置" }}</h3>
              </div>
              <div class="sp-group">
                <div class="s-row">
                  <div>
                    <b>导出配置</b>
                    <p>
                      {{
                        local
                          ? "仅包含模型来源。"
                          : "连接和模型来源，不含 Key。"
                      }}
                    </p>
                  </div>
                  <button
                    class="btn btn-quiet btn-xs"
                    type="button"
                    :disabled="busy"
                    @click="exportConfig"
                  >
                    导出
                  </button>
                </div>
                <div class="s-row">
                  <div>
                    <b>导入配置</b>
                    <p>
                      {{
                        local
                          ? "仅更新模型来源，连接由服务端管理。"
                          : "不覆盖已保存的 Key。"
                      }}
                    </p>
                  </div>
                  <button
                    class="btn btn-quiet btn-xs"
                    type="button"
                    :disabled="busy"
                    @click="importInput?.click()"
                  >
                    导入…</button
                  ><input
                    ref="importInput"
                    type="file"
                    accept=".json,application/json"
                    hidden
                    @change="importConfig"
                  />
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </dialog>
  <dialog
    ref="connectionForm"
    class="modal set-ui supplier-form"
    aria-label="供应商设置"
    @cancel.prevent="closeForm"
    @close="wipeKey"
  >
    <form class="modal-form" @submit.prevent="saveForm">
      <header class="modal-head supplier-head">
        <div class="supplier-brand">
          <img :src="supplierLogo" width="128" height="128" alt="" />
          <span id="connectionTitle" class="brand-title">Koma Image</span>
        </div>
      </header>
      <div class="modal-body">
        <div class="fld">
          <label for="connectionProtocol">接口协议</label>
          <select id="connectionProtocol" v-model="formProfile" :disabled="formBusy" @change="selectProtocol">
            <option v-for="p in connectionProfiles" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
        <div class="fld">
          <label for="connectionName">名称</label
          ><input
            id="connectionName"
            v-model="formName"
            :disabled="formBusy"
            placeholder="供应商名称"
            type="text"
            maxlength="128"
          />
        </div>
        <div class="fld">
          <label for="connectionUrl">地址</label
          ><input
            id="connectionUrl"
            v-model="formUrl"
            :disabled="formBusy"
            :readonly="profileFor(formProfile).protocol === 'novelai'"
            type="text"
            placeholder="https://"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div class="fld">
          <label for="connectionKey">API Key</label>
          <div class="connection-secret">
            <input id="connectionKey" ref="connectionKey" :type="formKeyVisible ? 'text' : 'password'" autocomplete="off" spellcheck="false"
              :disabled="formBusy" :placeholder="formHasKey ? '留空保留原 Key' : '填写 API Key'" @input="keyEdited" />
            <button class="ibtn connection-key-toggle" type="button" :disabled="formBusy"
              :aria-label="formKeyVisible ? '隐藏 API Key' : '显示 API Key'" :aria-pressed="formKeyVisible"
              :title="formKeyVisible ? '隐藏 API Key' : '显示 API Key'" aria-controls="connectionKey" @click="toggleKey">
              <AppIcon :name="formKeyVisible ? 'i-eye-off' : 'i-eye'" />
            </button>
          </div>
        </div>
        <label class="connection-remember">
          <input v-model="formRemember" type="checkbox" :disabled="formBusy" />
          <span>在此浏览器保存 Key</span>
        </label>
      </div>
      <footer class="modal-foot">
        <p class="modal-error" role="alert">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn btn-quiet" type="button" @click="closeForm" :disabled="formBusy">
            取消</button
          ><button class="btn btn-primary" type="submit" :disabled="formBusy">
            {{ formBusy ? "保存中…" : "保存" }}
          </button>
        </div>
      </footer>
    </form>
  </dialog>
  <ModelListDialog
    :connection="listConnection"
    :routing="routing"
    :raw="raw[listConnection ?? '']"
    :active-models="activeModels(listConnection ?? '')"
    @close="listConnection = null"
    @refresh="load(true, listConnection ? [listConnection] : [])"
    @change="commit"
    @reveal="reveal"
  />
  <AskModelDialog
    :purpose="askListPurpose"
    :connection="askList && routing.connections[askList] ? askList : null"
    :routing="routing"
    :raw="raw[askList ?? '']"
    :status="statuses[askList ?? '']?.text"
    :settings="askUse"
    @close="askList = null"
    @refresh="loadAsk(true)"
    @change="saveAsk"
  />
</template>

<style scoped>
.supplier-head {
  display: grid;
  justify-content: stretch;
  gap: 12px;
  padding-bottom: 12px;
}
.supplier-brand {
  display: flex;
  align-items: center;
  gap: 11px;
}
.supplier-brand img {
  width: 40px;
  height: 40px;
  object-fit: contain;
  border-radius: 11px;
  filter: drop-shadow(0 4px 10px var(--brand-logo-shadow));
}
.supplier-brand .brand-title {
  font-size: 26px;
  font-weight: 650;
  letter-spacing: 0;
  line-height: 1.3;
  padding-block: 2px;
}
.supplier-form .modal-body {
  display: grid;
  gap: 10px;
  padding-bottom: 16px;
}
.supplier-form .fld {
  gap: 5px;
}
.connection-secret {
  position: relative;
  min-width: 0;
}
.connection-secret input {
  padding-right: 38px;
}
.supplier-form .connection-key-toggle {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 30px;
  height: calc(100% - 4px);
  border-radius: var(--r2);
}
.connection-remember {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--fg-2);
  font-size: var(--fz-xs);
}
.connection-remember input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--a);
}
</style>
