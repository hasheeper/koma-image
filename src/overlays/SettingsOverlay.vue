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
import type { SettingsSection } from "../app/routes";
import type { Routing } from "../config/connections.ts";
import { normalizeBaseUrl, validateRouting } from "../config/connections.ts";
import { STANDARD_PROFILE_ID } from "../gateway/profile.ts";
import { testConnection } from "../gateway/connection-test.ts";
import { object } from "../domain/value.ts";
import { MODELS } from "../domain/models.ts";
import { catalogEntries, sourceState } from "../domain/catalog.ts";
import { download } from "../shared/files";
const { router } = useShell(),
  services = useServices(),
  ui = useUi();
const { connections, vault } = services;
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
  listConnection = ref<string | null>(null);
const editing = ref<string | null>(null),
  address = ref(""),
  addingName = ref(""),
  addingUrl = ref(""),
  formError = ref("");
const { requestClose, cancel, closed } = useDialog(
  "settings",
  dialog,
  () => !busy.value,
);
const sections: { id: SettingsSection; label: string; icon: string }[] = [
  { id: "connections", label: "连接", icon: "swap" },
  { id: "models", label: "模型", icon: "model" },
  { id: "security", label: "安全", icon: "lock" },
  { id: "backup", label: "备份与恢复", icon: "import" },
];
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
const mask = (id: string) => {
  version.value;
  const key = vault.key(id);
  return !key
    ? mode.value === "empty"
      ? "未配置"
      : "已锁定"
    : key.length > 8
      ? `${key.slice(0, 3)}••••••••${key.slice(-4)}`
      : "••••••••";
};
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
function used(id: string) {
  return MODELS.filter(
    (m) =>
      sourceState(routing.value, id, m, catalogEntries(raw.value[id])) === "on",
  ).length;
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
    router.route.value.section === "backup" ||
    router.route.value.section === "security"
  )
    return;
  controller?.abort();
  const signal = (controller = new AbortController()).signal,
    token = ++sequence;
  await Promise.all(
    Object.values(routing.value.connections).map(async (c) => {
      if (!vault.key(c.credentialRef)) {
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
          statuses.value[c.id] = { s: "ok", text: "可用 · 刚刚检查" };
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
      editing.value = null;
      listConnection.value = null;
      form.value?.close();
      return;
    }
    await nextTick();
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  controller?.abort();
  unconnections();
  unvault();
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
  addingName.value = `连接 ${Object.keys(routing.value.connections).length + 1}`;
  addingUrl.value = "";
  formError.value = "";
  form.value?.showModal();
}
async function saveNew() {
  formError.value = "";
  try {
    const baseUrl = normalizeBaseUrl(addingUrl.value),
      suffix = crypto.randomUUID(),
      id = `connection-${suffix}`;
    const next = structuredClone(routing.value);
    next.connections[id] = {
      id,
      name: addingName.value.trim() || "连接",
      baseUrl,
      profileId: STANDARD_PROFILE_ID,
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
async function finishAddress(id: string) {
  try {
    const next = structuredClone(routing.value);
    next.connections[id].baseUrl = normalizeBaseUrl(address.value);
    await connections.save(next);
    editing.value = null;
  } catch (error) {
    ui.toast(message(error), "err");
  }
}
async function test(id: string) {
  if (testing.value) return;
  testing.value = id;
  try {
    const result = await testConnection(connections.context(id));
    statuses.value[id] = result;
    if (result.s === "ok") await load(true);
  } catch (error) {
    statuses.value[id] = { s: "err", text: message(error) };
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
          { app: "koma-image", kind: "routing", ...routing.value },
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
    const value = validateRouting(JSON.parse(await file.text()));
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
          :aria-current="
            router.route.value.section === section.id ? 'true' : undefined
          "
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
            <div class="sp-sec-head">
              <h3>连接</h3>
              <p>每个连接包含地址、Key 和它的模型列表。</p>
            </div>
            <div
              v-if="!Object.keys(routing.connections).length"
              class="sp-group"
            >
              <div class="sp-empty">
                <span class="vtile connection-avatar"
                  ><img
                    :src="avatar"
                    alt="默认头像"
                    width="26"
                    height="26" /></span
                ><span>尚未配置连接</span
                ><button
                  class="btn btn-quiet btn-sm"
                  type="button"
                  @click="add"
                >
                  添加连接
                </button>
              </div>
            </div>
            <div
              v-for="c in Object.values(routing.connections)"
              :key="c.id"
              class="sp-group"
            >
              <div class="conn-head">
                <span class="vtile connection-avatar"
                  ><img :src="avatar" alt="默认头像"
                /></span>
                <div class="conn-name">
                  <b>{{ c.name }}</b>
                </div>
              </div>
              <div class="conn-row">
                <span class="k">状态</span
                ><span class="v sans"
                  ><span
                    class="st"
                    :data-s="
                      testing === c.id ? 'wait' : statuses[c.id]?.s || 'wait'
                    "
                    >{{
                      testing === c.id
                        ? "测试中…"
                        : statuses[c.id]?.text || "未检查"
                    }}</span
                  ></span
                ><button
                  class="md-act"
                  type="button"
                  :disabled="Boolean(testing)"
                  aria-label="测试连接"
                  data-tip="测试连接"
                  @click="test(c.id)"
                >
                  <AppIcon name="i-retry" />
                </button>
              </div>
              <div class="conn-row">
                <span class="k">地址</span>
                <div class="addr">
                  <input
                    v-if="editing === c.id"
                    v-model="address"
                    type="text"
                    aria-label="地址"
                    autocomplete="off"
                    spellcheck="false"
                    @keydown.enter.prevent="finishAddress(c.id)"
                    @keydown.esc.stop.prevent="editing = null"
                  /><span v-else class="v">{{ c.baseUrl }}</span
                  ><span class="addr-warn"
                    >Key 会发送到
                    <b>{{
                      host(editing === c.id ? address : c.baseUrl) || "地址无效"
                    }}</b></span
                  >
                </div>
                <button
                  class="md-act"
                  type="button"
                  :aria-label="editing === c.id ? '完成' : '修改地址'"
                  @click="
                    editing === c.id
                      ? finishAddress(c.id)
                      : ((editing = c.id), (address = c.baseUrl))
                  "
                >
                  <AppIcon :name="editing === c.id ? 'i-check' : 'i-rename'" />
                </button>
              </div>
              <div class="conn-row">
                <span class="k">Key</span
                ><span class="v"
                  >{{ mask(c.credentialRef)
                  }}<span
                    v-if="mode === 'session' && unlocked"
                    class="v sans dim"
                  >
                    · 不保存</span
                  ></span
                ><button
                  class="md-act"
                  type="button"
                  :aria-label="unlocked ? '更换 Key' : '配置或解锁 Key'"
                  @click="ui.requestKey(c.credentialRef)"
                >
                  <AppIcon name="i-rename" />
                </button>
              </div>
              <div class="conn-row">
                <span class="k">余额</span>
                <div v-if="balances[c.id]" class="bal">
                  <span class="qt"
                    ><AppIcon name="i-credit" />媒体积分<b>{{
                      amount(object(balances[c.id].credits).remaining)
                    }}</b></span
                  ><template
                    v-for="[group, family, label] in pools"
                    :key="group"
                    ><span
                      v-if="object(balances[c.id].images)[group]"
                      class="qt"
                      ><ModelIcon :family="family" />{{ label
                      }}<b>{{
                        amount(
                          object(object(balances[c.id].images)[group])
                            .remaining,
                        )
                      }}</b
                      ><i
                        v-if="
                          object(object(balances[c.id].images)[group]).limit
                        "
                        >/{{
                          object(object(balances[c.id].images)[group]).limit
                        }}</i
                      ></span
                    ></template
                  >
                </div>
                <span v-else class="v sans dim">—</span><span></span>
              </div>
              <div class="conn-row">
                <span class="k">模型</span
                ><span class="v sans">{{
                  raw[c.id]
                    ? `共 ${catalogEntries(raw[c.id]).length} 个 · 已用 ${used(c.id)} 个`
                    : "—"
                }}</span
                ><button
                  class="md-act"
                  type="button"
                  aria-label="模型列表"
                  :disabled="!raw[c.id]"
                  @click="listConnection = c.id"
                >
                  <AppIcon name="i-chevron" />
                </button>
              </div>
            </div>
            <button
              v-if="Object.keys(routing.connections).length"
              class="btn btn-quiet btn-sm"
              type="button"
              @click="add"
            >
              添加连接
            </button>
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
          <section
            v-show="router.route.value.section === 'security'"
            class="sp-sec"
            aria-label="安全"
          >
            <div class="sp-sec-head"><h3>安全</h3></div>
            <div class="sp-group">
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
                  {{ mode === "session" ? "改为口令加密" : "修改口令" }}</button
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
                  <p>删除本机保存的所有 Key，不可恢复。连接和模型来源保留。</p>
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
          <div v-show="router.route.value.section === 'backup'">
            <BackupSection
              :active="
                router.route.value.overlay === 'settings' &&
                router.route.value.section === 'backup'
              "
              @busy="busy = $event"
            />
            <section class="sp-sec">
              <div class="sp-sec-head"><h3>连接与模型配置</h3></div>
              <div class="sp-group">
                <div class="s-row">
                  <div>
                    <b>导出配置</b>
                    <p>连接和模型来源，不含 Key。</p>
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
                    <p>不覆盖已保存的 Key。</p>
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
    <form class="modal-form" @submit.prevent="saveNew">
      <header class="modal-head"><h2 id="connectionTitle">添加连接</h2></header>
      <div class="modal-body">
        <div class="fld">
          <label for="connectionName">名称</label
          ><input
            id="connectionName"
            v-model="addingName"
            type="text"
            maxlength="128"
          />
        </div>
        <div class="fld">
          <label for="connectionUrl">连接 URL</label
          ><input
            id="connectionUrl"
            v-model="addingUrl"
            type="text"
            placeholder="https://"
            autocomplete="off"
            spellcheck="false"
          /><span class="addr-warn"
            >Key 会发送到 <b>{{ host(addingUrl) || "填写的连接地址" }}</b></span
          >
        </div>
      </div>
      <footer class="modal-foot">
        <p class="modal-error" role="alert">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn btn-quiet" type="button" @click="form?.close()">
            取消</button
          ><button class="btn btn-primary" type="submit">添加</button>
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
</template>
