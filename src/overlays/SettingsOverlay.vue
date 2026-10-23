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
import { useUi, message } from "../app/ui";
import { useDialog } from "./use-dialog";
import BrandMark from "../shared/BrandMark.vue";
import AppIcon from "../shared/AppIcon.vue";
import ModelIcon from "../shared/ModelIcon.vue";
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
} from "../config/connections.ts";
import { STANDARD_PROFILE_ID, connectionProfiles, profileFor, NOVELAI_IMAGE_URL } from "../gateway/profile.ts";
import { testConnection } from "../gateway/connection-test.ts";
import { object } from "../domain/value.ts";
import { MODELS } from "../domain/models.ts";
import { catalogEntries, sourceState } from "../domain/catalog.ts";
import { download } from "../shared/files";
import { names } from "../storage/names.ts";
import { readAskSettings } from "../ask/settings.ts";
import type { AskSettings } from "../ask/settings.ts";
import { placeMenu, menuKeys } from "../shared/popover";
const { router } = useShell(),
  services = useServices(),
  ui = useUi();
const { connections, vault, preferences } = services;
const local = connections.local;
const dialog = useTemplateRef<HTMLDialogElement>("dialog"),
  form = useTemplateRef<HTMLDialogElement>("connectionForm");
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
  formError = ref("");
const { requestClose, cancel, closed } = useDialog(
  "settings",
  dialog,
  () => !busy.value,
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
const avatar = `${import.meta.env.BASE_URL}assets/default-avatar.svg`;
const mode = computed(() => {
  version.value;
  return vault.mode();
});
const unlocked = computed(() => {
  version.value;
  return vault.isUnlocked();
});
const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};
// The card shows the address without its https scheme; the menu shows the Key's ends when it is readable.
const endpoint = (url: string) => url.replace(/^https:\/\//, "");
const keyTail = (id: string) => {
  version.value;
  const key = vault.key(id);
  return !key ? "" : key.length > 8 ? `${key.slice(0, 3)}••••${key.slice(-4)}` : "••••";
};
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
type Meter = { key: string; label: string; value: string; family?: string; limit?: string; ratio?: number };
function meters(c: Connection): Meter[] {
  const media = balances.value[c.id], profile = profileFor(c.profileId);
  if (!media || (profile.quotaPolicy.supported === false && profile.protocol !== "novelai")) return [];
  const credits = amount(object(media.credits).remaining);
  if (profile.protocol === "novelai") return [{ key: "anlas", label: "Anlas", value: credits }];
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
function used(id: string) {
  return MODELS.filter(
    (m) =>
      sourceState(routing.value, id, m, catalogEntries(raw.value[id])) === "on",
  ).length;
}
// One menu per card, opened by its own ⋯ button; it closes on scroll or resize like the chat menus.
let openMenu: { pop: HTMLElement; off: AbortController } | undefined;
const menuId = (id: string) => `connection-menu-${id}`;
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
let sequence = 0,
  controller: AbortController | undefined,
  loadQueued = false,
  disposed = false;
function queueLoad() {
  if (loadQueued || disposed) return;
  loadQueued = true;
  queueMicrotask(() => {
    loadQueued = false;
    if (!disposed) void load();
  });
}
async function load(force = false) {
  if (
    !dialog.value?.open ||
    !["connections", "models"].includes(activeSection.value)
  )
    return;
  controller?.abort();
  const signal = (controller = new AbortController()).signal,
    token = ++sequence;
  await Promise.all(
    Object.values(routing.value.connections).map(async (c) => {
      if (!connections.hasCredential(c.credentialRef)) {
        statuses.value[c.id] = {
          s: "wait",
          text: mode.value === "empty" ? "未配置 Key" : "请先解锁 Key",
        };
        return;
      }
      statuses.value[c.id] = { s: "wait", text: "检查中…" };
      try {
        const gateway = services.gateway(c.id);
        const results = await Promise.allSettled([
          gateway.rawCatalog(force, signal),
          gateway.quota(undefined, signal),
        ]);
        if (token !== sequence || signal.aborted) return;
        if (results[0].status === "fulfilled") {
          raw.value = { ...raw.value, [c.id]: results[0].value };
          statuses.value[c.id] = { s: "ok", text: gateway.profile.protocol === "novelai" ? "订阅可用 · 生图尚未实测" : gateway.profile.reasoning ? "可用 · 推理尚未实测" : "可用 · 刚刚检查" };
        } else
          statuses.value[c.id] = { s: "err", text: message(results[0].reason) };
        if (results[1].status === "fulfilled")
          balances.value = {
            ...balances.value,
            [c.id]: results[1].value.media,
          };
      } catch (error) {
        if (token === sequence && !signal.aborted)
          statuses.value[c.id] = { s: "err", text: message(error) };
      }
    }),
  );
}
const unconnections = connections.subscribe((kind) => {
  routing.value = connections.configuration;
  version.value++;
  if (kind === "configuration") {
    raw.value = {};
    balances.value = {};
  }
  if (dialog.value?.open) queueLoad();
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
  if (!connections.hasCredential(c.credentialRef)) {
    statuses.value[c.id] = { s: "wait", text: mode.value === "empty" ? "未配置 Key" : "请先解锁 Key" };
    return;
  }
  statuses.value[c.id] = { s: "wait", text: "检查中…" };
  try {
    const value = await services.gateway(c.id).rawCatalog(force);
    if (disposed) return;
    raw.value = { ...raw.value, [c.id]: value };
    statuses.value[c.id] = { s: "ok", text: "可用 · 推理尚未实测" };
  } catch (error) {
    if (!disposed) statuses.value[c.id] = { s: "err", text: message(error) };
  }
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
  raw.value = {};
  balances.value = {};
  if (dialog.value?.open) queueLoad();
});
watch(
  () => [router.route.value.overlay, router.route.value.section],
  async ([overlay]) => {
    if (overlay !== "settings") {
      controller?.abort();
      sequence++;
      closeMenu();
      listConnection.value = null;
      askList.value = null;
      form.value?.close();
      return;
    }
    await nextTick();
    void load();
  },
  { immediate: true, flush: "post" },
);
onBeforeUnmount(() => {
  disposed = true;
  controller?.abort();
  unconnections();
  unvault();
  unask();
  closeMenu();
  form.value?.close();
});
async function commit(value: Routing) {
  try {
    await connections.save(value);
  } catch (error) {
    ui.toast(message(error), "err");
  }
}
function add() {
  if (local) return;
  formTarget.value = null;
  formName.value = `连接 ${Object.keys(routing.value.connections).length + 1}`;
  formUrl.value = "";
  formProfile.value = STANDARD_PROFILE_ID;
  formError.value = "";
  form.value?.showModal();
}
function edit(id: string) {
  const c = routing.value.connections[id];
  if (local || !c) return;
  formTarget.value = id;
  formName.value = c.name;
  formUrl.value = c.baseUrl;
  formProfile.value = c.profileId;
  formError.value = "";
  form.value?.showModal();
}
function selectProtocol() {
  formError.value = "";
  const target = formTarget.value ? routing.value.connections[formTarget.value] : undefined;
  if (target && profileFor(formProfile.value).protocol === "novelai" && target.baseUrl !== NOVELAI_IMAGE_URL) {
    formProfile.value = target.profileId;
    formError.value = "请单独添加 NovelAI 官方连接，并填写对应 Key";
    return;
  }
  if (profileFor(formProfile.value).protocol === "novelai") formUrl.value = NOVELAI_IMAGE_URL;
  else if (formUrl.value === NOVELAI_IMAGE_URL) formUrl.value = "";
}
async function saveForm() {
  formError.value = "";
  if (formTarget.value) return saveEdit(formTarget.value);
  try {
    const baseUrl = normalizeBaseUrl(formUrl.value),
      suffix = crypto.randomUUID(),
      id = `connection-${suffix}`;
    const next = structuredClone(routing.value);
    next.connections[id] = {
      id,
      name: formName.value.trim() || "连接",
      baseUrl,
      profileId: formProfile.value,
      credentialRef: `key-${suffix}`,
      revision: crypto.randomUUID(),
    };
    await connections.save(next);
    form.value?.close();
    ui.requestKey(next.connections[id].credentialRef);
  } catch (error) {
    formError.value = message(error);
  }
}
// Saves only what changed; a new protocol starts with empty model sources, as before.
async function saveEdit(id: string) {
  const name = formName.value.trim();
  if (!name) {
    formError.value = "请填写连接名称";
    return;
  }
  try {
    const baseUrl = normalizeBaseUrl(formUrl.value),
      next = structuredClone(routing.value),
      c = next.connections[id];
    if (c && (c.name !== name || c.baseUrl !== baseUrl || c.profileId !== formProfile.value)) {
      if (c.profileId !== formProfile.value) next.links[id] = {};
      Object.assign(c, { name, baseUrl, profileId: formProfile.value });
      await connections.save(next);
    }
    form.value?.close();
  } catch (error) {
    formError.value = message(error);
  }
}
async function remove(id: string) {
  const c = routing.value.connections[id];
  if (!c) return;
  // A locked vault cannot drop this connection's Key, so unlock first.
  if (mode.value === "encrypted" && !unlocked.value) {
    ui.toast("请先解锁 Key，再删除连接", "warn", {
      label: "解锁",
      run: async () => ui.requestKey(c.credentialRef),
    });
    return;
  }
  if (
    !(await ui.confirm({
      title: `删除「${c.name}」？`,
      message: "同时删除这个连接的 Key 和模型来源，不可恢复。",
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
    if (vault.key(c.credentialRef)) await vault.removeKey(c.credentialRef);
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
    if (result.s === "ok") await load(true);
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
async function lock() {
  try {
    await vault.lock();
  } catch (error) {
    ui.toast(message(error), "err");
  }
}
function key() {
  const id = Object.values(routing.value.connections)[0]?.credentialRef;
  if (id) ui.requestKey(id);
  else router.selectSection("connections");
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
                <AppIcon name="i-plus" />添加连接
              </button>
              <p v-if="local">连接由本地服务管理，模型来源可在此调整。</p>
            </div>
            <div
              v-if="!Object.keys(routing.connections).length"
              class="sp-empty conn-empty"
            >
              <span class="vtile connection-avatar"
                ><img
                  :src="avatar"
                  alt="默认头像"
                  width="26"
                  height="26" /></span
              ><span>尚未配置连接</span
              ><button class="btn btn-quiet btn-sm" type="button" @click="add">
                添加连接
              </button>
            </div>
            <article
              v-for="c in Object.values(routing.connections)"
              :key="c.id"
              class="conn-card"
            >
              <header class="conn-top">
                <span class="vtile connection-avatar"
                  ><img :src="avatar" alt="默认头像"
                /></span>
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
                  >{{ testing === c.id ? "测试中…" : statusLabel(statuses[c.id]) }}</span
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
                      :popovertarget="menuId(c.id)"
                    >
                      <AppIcon name="i-more" />
                    </button>
                    <div
                      :id="menuId(c.id)"
                      class="conn-menu"
                      popover="auto"
                      role="menu"
                      :aria-label="`${c.name} 的操作`"
                      @toggle="toggleMenu"
                      @keydown="menuKeys"
                      @click="closeMenu"
                    >
                      <button type="button" role="menuitem" @click="edit(c.id)">
                        <AppIcon name="i-rename" /><span>编辑连接…</span></button
                      ><button
                        type="button"
                        role="menuitem"
                        @click="ui.requestKey(c.credentialRef)"
                      >
                        <AppIcon name="i-lock" /><span>{{
                          unlocked ? "更换 Key…" : "配置或解锁 Key…"
                        }}</span
                        ><small v-if="keyTail(c.credentialRef)">{{
                          keyTail(c.credentialRef)
                        }}</small>
                      </button>
                      <hr role="separator" />
                      <button
                        type="button"
                        role="menuitem"
                        class="danger"
                        @click="remove(c.id)"
                      >
                        <AppIcon name="i-trash" /><span>删除连接</span>
                      </button>
                    </div>
                  </template>
                </div>
              </header>
              <div v-if="meters(c).length" class="conn-meters">
                <div v-for="m in meters(c)" :key="m.key" class="conn-meter">
                  <span
                    ><ModelIcon v-if="m.family" :family="m.family" /><AppIcon
                      v-else
                      name="i-credit"
                    />{{ m.label }}</span
                  >
                  <b
                    >{{ m.value }}<i v-if="m.limit">/{{ m.limit }}</i></b
                  >
                  <span
                    v-if="m.ratio !== undefined"
                    class="conn-bar"
                    :style="{ '--p': `${m.ratio * 100}%` }"
                  ></span>
                </div>
              </div>
              <!-- Reasoning connections serve ASK only; their list picks ASK's IDs. -->
              <button
                v-if="profileFor(c.profileId).reasoning"
                class="conn-models"
                type="button"
                @click="openAskModels(c.id)"
              >
                <span>ASK 模型</span
                ><span>{{ askModels(c.id) }}</span
                ><AppIcon name="i-chevron" />
              </button>
              <button
                v-else
                class="conn-models"
                type="button"
                :disabled="!raw[c.id]"
                @click="listConnection = c.id"
              >
                <span>模型</span
                ><span>{{
                  raw[c.id]
                    ? `${catalogEntries(raw[c.id]).length} 个 · 已用 ${used(c.id)} 个`
                    : "—"
                }}</span
                ><AppIcon name="i-chevron" />
              </button>
            </article>
          </section>
          <ModelsSection
            v-show="router.route.value.section === 'models'"
            ref="modelsSection"
            :routing="routing"
            :raw="raw"
            :statuses="statuses"
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
                    <b>{{
                      mode === "empty"
                        ? "未配置 Key"
                        : mode === "session"
                          ? "不保存"
                          : "口令加密"
                    }}</b>
                    <p>
                      {{
                        mode === "session"
                          ? "Key 保存在当前会话，关闭所有页面后失效。"
                          : "所有连接的 Key 用同一个口令加密保存在本机。"
                      }}
                    </p>
                  </div>
                  <button
                    v-if="unlocked"
                    class="btn btn-quiet btn-xs"
                    type="button"
                    @click="
                      ui.credential.value = { id: '', action: 'passphrase' }
                    "
                  >
                    {{
                      mode === "session" ? "改为口令加密" : "修改口令"
                    }}</button
                  ><button
                    v-else
                    class="btn btn-quiet btn-xs"
                    type="button"
                    @click="key"
                  >
                    {{ mode === "empty" ? "配置 Key" : "解锁" }}
                  </button>
                </div>
                <div v-if="unlocked && mode === 'encrypted'" class="s-row">
                  <div>
                    <b>锁定</b>
                    <p>所有打开的页面一起锁定，进行中的生成会先完成。</p>
                  </div>
                  <button
                    class="btn btn-quiet btn-xs"
                    type="button"
                    @click="lock"
                  >
                    立即锁定
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
    class="modal set-ui"
    aria-labelledby="connectionTitle"
  >
    <form class="modal-form" @submit.prevent="saveForm">
      <header class="modal-head">
        <h2 id="connectionTitle">{{ formTarget ? "编辑连接" : "添加连接" }}</h2>
      </header>
      <div class="modal-body">
        <div class="fld">
          <label for="connectionProtocol">接口协议</label>
          <select id="connectionProtocol" v-model="formProfile" @change="selectProtocol">
            <option v-for="p in connectionProfiles" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
        <div class="fld">
          <label for="connectionName">名称</label
          ><input
            id="connectionName"
            v-model="formName"
            type="text"
            maxlength="128"
          />
        </div>
        <div class="fld">
          <label for="connectionUrl">连接 URL</label
          ><input
            id="connectionUrl"
            v-model="formUrl"
            :readonly="profileFor(formProfile).protocol === 'novelai'"
            type="text"
            placeholder="https://"
            autocomplete="off"
            spellcheck="false"
          /><span v-if="profileFor(formProfile).protocol === 'novelai'" class="hint">基础生图与图生图；Key 发送到 image.novelai.net 与 api.novelai.net，生成尚未实测。</span
          ><span v-else class="hint"
            >Key 会发送到 {{ host(formUrl) || "填写的连接地址" }}</span
          >
        </div>
      </div>
      <footer class="modal-foot">
        <p class="modal-error" role="alert">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn btn-quiet" type="button" @click="form?.close()">
            取消</button
          ><button class="btn btn-primary" type="submit">
            {{ formTarget ? "保存" : "添加" }}
          </button>
        </div>
      </footer>
    </form>
  </dialog>
  <ModelListDialog
    :connection="listConnection"
    :routing="routing"
    :raw="raw[listConnection ?? '']"
    @close="listConnection = null"
    @refresh="load(true)"
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
