<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import type { Routing } from "../../config/connections.ts";
import { object } from "../../domain/value.ts";
import { MODEL_LIMIT, modelId, withModels } from "../../ask/settings.ts";
import type { AskSettings } from "../../ask/settings.ts";
import { familyNames as groups, familyOf } from "../../ask/model-family.ts";
import ModelIcon from "../../shared/ModelIcon.vue";
import ConnectionAvatar from "../../shared/ConnectionAvatar.vue";
import AppIcon from "../../shared/AppIcon.vue";

/** One reasoning connection's IDs in the model-list layout; picks become the composer's quick switch. */
const props = defineProps<{
  connection: string | null;
  routing: Routing;
  raw: unknown;
  status?: string;
  settings: AskSettings;
  purpose?: "ask" | "naming";
}>();
const emit = defineEmits<{
  close: [];
  refresh: [];
  change: [settings: AskSettings];
}>();
const dialog = useTemplateRef<HTMLDialogElement>("dialog"),
  query = ref(""),
  tab = ref("all"),
  folded = ref<Record<string, boolean>>({});
const naming = computed(() => props.purpose === "naming");
const picked = computed(() => naming.value
  ? props.settings.naming?.connectionId === props.connection && props.settings.naming.model ? [props.settings.naming.model] : []
  : props.settings.models[props.connection ?? ""] ?? []),
  full = computed(() => !naming.value && picked.value.length >= MODEL_LIMIT);
// Picks the list lacks (typed by hand or gone upstream) stay listed so they can be removed.
const rows = computed(() => {
  const listed = Object.entries(object(object(props.raw).models)).map(([id, m]) => {
    const name = String(object(m).name || "");
    return { id, name: name === id ? "" : name, extra: false };
  });
  return [
    ...listed,
    ...picked.value
      .filter((id) => !listed.some((r) => r.id === id))
      .map((id) => ({ id, name: "", extra: !!props.raw })),
  ]
    .map((r) => ({ ...r, family: familyOf(r.id), on: picked.value.includes(r.id) }))
    .sort((a, b) => a.id.localeCompare(b.id));
});
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return rows.value.filter(
    (r) =>
      (tab.value === "all" || (tab.value === "used" ? r.on : !r.on)) &&
      (!q || `${r.name} ${r.id}`.toLowerCase().includes(q)),
  );
});
const order = Object.keys(groups);
const heads = computed(() =>
  [...new Set(shown.value.map((r) => r.family))].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b),
  ),
);
// Small lists open whole; long ones open only where something is picked.
const open = (family: string) =>
  Boolean(
    query.value ||
      (folded.value[family] ??
        (rows.value.length <= 30 || shown.value.some((r) => r.family === family && r.on))),
  );
const typed = computed(() => {
  const id = modelId(query.value);
  return id && !rows.value.some((r) => r.id === id) ? id : "";
});
const empty = computed(() =>
  query.value.trim()
    ? `没有匹配「${query.value.trim()}」的模型`
    : tab.value === "used"
      ? "尚未选用模型"
      : props.raw
        ? "没有模型，可在上方填写 ID"
        : props.status || "正在获取…",
);
function pick(id: string, on: boolean) {
  if (!props.connection || (on && full.value)) return;
  if (naming.value) {
    emit("change", { ...props.settings, naming: { connectionId: props.connection, model: on ? id : "" } });
    return;
  }
  const ids = on ? [...picked.value, id] : picked.value.filter((x) => x !== id);
  emit("change", withModels(props.settings, props.connection, ids));
}
function add() {
  if (!typed.value || full.value) return;
  pick(typed.value, true);
  query.value = "";
}
watch(
  () => props.connection,
  async (c) => {
    await nextTick();
    if (c) {
      query.value = "";
      tab.value = "all";
      folded.value = {};
      if (!dialog.value?.open) dialog.value?.showModal();
    } else dialog.value?.close();
  },
);
onBeforeUnmount(() => dialog.value?.close());
</script>
<template>
  <dialog
    ref="dialog"
    id="askModelDialog"
    class="modal plist set-ui"
    aria-labelledby="askModelTitle"
    @cancel.prevent="emit('close')"
  >
    <div class="md-head">
      <ConnectionAvatar :connection="routing.connections[connection ?? '']" />
      <h2 id="askModelTitle">
        {{ routing.connections[connection ?? ""]?.name }} {{ naming ? '· 命名模型' : '模型列表' }}
      </h2>
      <button class="ibtn" type="button" aria-label="关闭" @click="emit('close')">
        <AppIcon name="i-close" />
      </button>
    </div>
    <form class="md-tools" @submit.prevent="add">
      <label class="md-search"
        ><AppIcon name="i-search" /><input
          v-model="query"
          type="search"
          maxlength="200"
          placeholder="搜索或填写模型 ID"
          aria-label="搜索或填写模型 ID"
          autocomplete="off"
          spellcheck="false" /></label
      ><button
        class="ibtn"
        type="button"
        aria-label="重新拉取"
        @click="emit('refresh')"
      >
        <AppIcon name="i-retry" />
      </button>
    </form>
    <nav class="md-tabs" role="tablist">
      <button
        v-for="(label, id) in { all: '全部', used: '已用', unused: '未用' }"
        :key="id"
        role="tab"
        :aria-selected="tab === id"
        @click="tab = id"
      >
        {{ label }}
      </button>
    </nav>
    <div class="md-list">
      <div v-if="typed" class="md-group">
        <div class="md-row">
          <span class="vtile"><ModelIcon :family="familyOf(typed)" /></span>
          <div class="md-id"><b>{{ typed }}</b></div>
          <span class="md-miss">手动填写</span>
          <button
            class="lamp"
            type="button"
            data-s="off"
            :disabled="full"
            :title="full ? `最多选用 ${MODEL_LIMIT} 个` : undefined"
            :aria-label="`选用 ${typed}`"
            @click="add"
          ></button>
        </div>
      </div>
      <div
        v-for="family in heads"
        :key="family"
        class="md-group"
        :data-open="open(family)"
      >
        <div class="md-ghead">
          <button
            class="md-chev"
            type="button"
            :aria-expanded="open(family)"
            :aria-label="`${open(family) ? '收起' : '展开'} ${groups[family]}`"
            @click="folded[family] = !open(family)"
          >
            <AppIcon name="i-chevron" /></button
          ><span class="vtile"><ModelIcon :family="family" /></span>
          <div class="md-gtitle">
            <b>{{ groups[family] }}</b>
          </div>
          <span class="md-count">{{
            shown.filter((r) => r.family === family).length
          }}</span>
        </div>
        <template v-if="open(family)"
          ><div
            v-for="r in shown.filter((r) => r.family === family)"
            :key="r.id"
            class="md-row"
          >
            <span class="vtile"><ModelIcon :family="family" /></span>
            <div class="md-id">
              <b>{{ r.name || r.id }}</b><code v-if="r.name">{{ r.id }}</code>
            </div>
            <span v-if="r.extra" class="md-miss">列表外</span>
            <button
              class="lamp"
              type="button"
              :data-s="r.on ? 'on' : 'off'"
              :aria-pressed="r.on"
              :disabled="!r.on && full"
              :title="!r.on && full ? `最多选用 ${MODEL_LIMIT} 个` : undefined"
              :aria-label="`${r.on ? '已用' : '选用'} ${r.id}`"
              @click="pick(r.id, !r.on)"
            ></button></div
        ></template>
      </div>
      <div v-if="!typed && !shown.length" class="md-empty">{{ empty }}</div>
    </div>
  </dialog>
</template>
<style scoped>
/* At the limit an unused lamp waits; the shared lamp has no disabled state of its own. */
.lamp:disabled { opacity: 0.35; cursor: not-allowed; background: none; }
</style>
