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
import ThemeToggle from "../shared/ThemeToggle.vue";
import { useConnectionCatalogs } from "./settings/use-connection-catalogs";
import ConnectionsSection from "./settings/ConnectionsSection.vue";
import SupplierDialog from "./settings/SupplierDialog.vue";
import ModelsSection from "./settings/ModelsSection.vue";
import ModelListDialog from "./settings/ModelListDialog.vue";
import BackupSection from "./settings/BackupSection.vue";
import GeneralSection from "./settings/GeneralSection.vue";
import UpdatesSection from "./settings/UpdatesSection.vue";
import { appVersion, releaseNotes } from "../config/releases";
import AskSection from "./settings/AskSection.vue";
import AskModelDialog from "./settings/AskModelDialog.vue";
import type { SettingsSection } from "../app/routes";
import type { Routing } from "../config/connections.ts";
import {
  prepareRoutingImport,
  validateModelLinks,
  validateModels,
  LOCAL_CONNECTION_ID,
  orderedConnections,
  imageConnections,
} from "../config/connections.ts";
import { testConnection } from "../gateway/connection-test.ts";
import { configuredModels } from "../domain/models.ts";
import { modelSource } from "../domain/catalog.ts";
import { download } from "../shared/files";
import { names } from "../storage/names.ts";
import { readAskSettings } from "../ask/settings.ts";
import type { AskSettings } from "../ask/settings.ts";
const { router } = useShell(),
  services = useServices(),
  ui = useUi();
const { connections, vault, preferences } = services;
const { view: drawingView } = useDrawing(), { view: chatView } = useChat(), { view: editorView } = useEditor();
const currentModel = computed(() => editorView.value.open
  ? editorView.value.upscaleOpen ? editorView.value.upscaleModel : editorView.value.model
  : router.route.value.workspace === "chat" ? chatView.value.model : drawingView.value.model);
const local = connections.local;
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const supplier = useTemplateRef<InstanceType<typeof SupplierDialog>>("supplier");
const modelsSection =
  useTemplateRef<InstanceType<typeof ModelsSection>>("modelsSection");
const importInput = useTemplateRef<HTMLInputElement>("importInput");
const busy = ref(false), version = ref(0);
const testing = ref<string | null>(null), listConnection = ref<string | null>(null), askList = ref<string | null>(null);
const { routing, raw, balances, statuses, load, loadConnection, stopChecks } = useConnectionCatalogs({
  isOpen: () => !!dialog.value?.open,
  showCatalogs: () => ["connections", "models"].includes(activeSection.value),
  listConnection, askList,
});
const askListPurpose = ref<"ask" | "naming">("ask");
function openAskModels(id: string, purpose: "ask" | "naming" = "ask") {
  askListPurpose.value = purpose;
  askList.value = id;
}
const { requestClose, cancel, closed } = useDialog(
  "settings",
  dialog,
  () => !busy.value && !supplier.value?.busy,
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
    : router.route.value.section === "updates"
      ? "general"
      : router.route.value.section,
);
const seenRelease = ref(preferences.get<string>(names.releaseSeen, ""));
const unreadRelease = computed(() => seenRelease.value !== appVersion && releaseNotes.some(release => release.version === appVersion));
async function readRelease() {
  if (!unreadRelease.value) return;
  try { await preferences.set(names.releaseSeen, appVersion); }
  catch (error) { ui.toast(message(error), "err"); }
}
async function goBack() {
  if (router.route.value.section !== "updates") {
    requestClose();
    return;
  }
  router.selectSection("general");
  await nextTick();
  document.getElementById("releaseNotesButton")?.focus();
}
function cancelSettings(event: Event) {
  if (router.route.value.section === "updates") {
    event.preventDefault();
    void goBack();
  } else cancel(event);
}
const mode = computed(() => {
  version.value;
  return vault.mode();
});
const modelEntries = computed(() => configuredModels(routing.value));
const activeModels = (id: string) => modelEntries.value.filter(m => modelSource(routing.value, raw.value, m) === id).map(m => m.id);
const imageSources = computed(() => imageConnections(routing.value));
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
// A reasoning card says whether ASK uses it, with which model ID, or how many it picked there.
const readAsk = () => readAskSettings(preferences.get(names.ask, null));
const askUse = shallowRef(readAsk());
const unpreferences = preferences.subscribe((key) => {
  if (!key || key === names.ask) askUse.value = readAsk();
  if (!key || key === names.releaseSeen) seenRelease.value = preferences.get<string>(names.releaseSeen, "");
});
const askCounts = computed(() => Object.fromEntries(
  Object.entries(askUse.value.models).map(([id, models]) => [id, models.length]),
));
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
      listConnection.value = null;
      askList.value = null;
      supplier.value?.close();
      modelsSection.value?.close();
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
  stopChecks();
  unvault();
  unpreferences();
  supplier.value?.close();
});
async function commit(value: Routing) {
  try {
    await connections.save(value);
  } catch (error) {
    ui.toast(message(error), "err");
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
                models: routing.value.models,
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
          ...(parsed.models === undefined ? {} : { models: validateModels(parsed.models) }),
        }
      : prepareRoutingImport(parsed, routing.value);
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
    @cancel="cancelSettings"
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
        @click="goBack"
      >
        <AppIcon name="i-back" />
      </button>
      <h2 id="settingsTitle" class="brand set-title" aria-label="设置">
        <BrandMark surface="settings" subtitle="SETTINGS" />
      </h2>
      <div class="topbar-end"><ThemeToggle /></div>
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
                ? modelEntries.length
                : ""
          }}</small>
        </button>
      </nav>
      <div class="set-scroll">
        <div class="set-col">
          <ConnectionsSection
            :active="router.route.value.overlay === 'settings' && activeSection === 'connections'"
            :local="local" :busy="busy" :testing="testing" :routing="routing" :raw="raw" :balances="balances"
            :statuses="statuses" :current-connection="currentModel?.connection" :ask-counts="askCounts"
            :current-ask-connection="askUse.connectionId" :current-ask-model="askUse.model"
            @add="supplier?.add()" @edit="supplier?.edit($event)" @remove="remove" @test="test"
            @models="listConnection = $event" @ask-models="openAskModels" @move="moveConnection"
          />
          <ModelsSection
            v-show="router.route.value.section === 'models'"
            ref="modelsSection"
            :active="router.route.value.overlay === 'settings' && router.route.value.section === 'models'"
            :routing="routing"
            :raw="raw"
            :statuses="statuses"
            :current-model="currentModel"
            @reload="load(true, $event ? [$event] : undefined)"
          />
          <GeneralSection
            v-show="router.route.value.section === 'general'"
            :version="appVersion" :unread="unreadRelease"
            @updates="router.selectSection('updates')"
          />
          <UpdatesSection v-if="router.route.value.section === 'updates'" @read="readRelease" />
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
                          ? "包含模型条目、默认参数和来源。"
                          : "连接、模型条目、默认参数和来源，不含 Key。"
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
                          ? "更新模型条目和来源，连接由服务端管理。"
                          : "不覆盖已保存的 Key；地址或协议变更后需重新填写。"
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
  <SupplierDialog ref="supplier" :routing="routing" />
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
