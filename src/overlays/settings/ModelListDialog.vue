<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { MODELS } from "../../domain/models.ts";
import {
  catalogEntries,
  linkFor,
  sourceState,
  shownId,
} from "../../domain/catalog.ts";
import type { Routing } from "../../config/connections.ts";
import { object, strings } from "../../domain/value.ts";
import ModelIcon from "../../shared/ModelIcon.vue";
import ConnectionAvatar from "../../shared/ConnectionAvatar.vue";
import ModelCapabilities from "../../shared/ModelCapabilities.vue";
import AppIcon from "../../shared/AppIcon.vue";
const props = defineProps<{
  connection: string | null;
  routing: Routing;
  raw: unknown;
  activeModels: string[];
}>();
const emit = defineEmits<{
  close: [];
  refresh: [];
  change: [routing: Routing];
  reveal: [id: string];
}>();
const dialog = useTemplateRef<HTMLDialogElement>("dialog"),
  query = ref(""),
  tab = ref("all"),
  folded = ref<Record<string, boolean>>({});
const groups: Record<string, string> = {
  gpt: "GPT",
  gemini: "Gemini",
  novelai: "NovelAI",
  fal: "fal",
  flux: "FLUX",
  qwen: "Qwen",
  seedream: "Seedream",
  xai: "xAI",
  wan: "Wan",
  dashscope: "DashScope",
  other: "其他",
};
const rows = computed(() => {
  const c = props.connection ?? "",
    entries = catalogEntries(props.raw);
  const claimed = new Map(
    MODELS.flatMap((m) => {
      const l = linkFor(props.routing, c, m, entries);
      return l ? [[l.id, m] as const] : [];
    }),
  );
  return Object.entries(object(object(props.raw).models)).map(([id, raw]) => {
    const m = object(raw),
      to = claimed.get(id),
      on = to && sourceState(props.routing, c, to, entries) === "on";
    const family = String(m.editor_family || to?.family || "other");
    const operations = strings(m.operations),
      tools = strings(m.tools);
    return {
      id,
      name: String(m.name || "").replace(/ · fal$/, ""),
      to,
      on,
      active: !!to && props.activeModels.includes(to.id),
      family,
      caps:
        (operations.includes("generate") ? "g" : "") +
        (operations.includes("edit") ? "e" : "") +
        (tools.includes("inpaint") ? "i" : "") +
        (tools.includes("upscale") ? "u" : ""),
      free: to
        ? []
        : MODELS.filter(
            (model) =>
              (!m.editor_family || model.family === m.editor_family) &&
              ["miss", "gone"].includes(
                sourceState(props.routing, c, model, entries),
              ),
          ),
    };
  });
});
const shown = computed(() =>
  rows.value.filter(
    (r) =>
      (tab.value === "all" || (tab.value === "active" ? r.active : tab.value === "used" ? r.on : !r.on)) &&
      (!query.value.trim() ||
        `${r.name} ${r.id}`
          .toLowerCase()
          .includes(query.value.trim().toLowerCase())),
  ),
);
const families = computed(() =>
  [...new Set(shown.value.map((r) => r.family))].sort(
    (a, b) =>
      (Object.keys(groups).indexOf(a) + 1 || 99) -
      (Object.keys(groups).indexOf(b) + 1 || 99),
  ),
);
const open = (family: string) =>
  Boolean(
    query.value ||
    (folded.value[family] ?? ["gpt", "gemini", "novelai"].includes(family)),
  );
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
function use(id: string, model: string) {
  if (!model || !props.connection) return;
  const next = structuredClone(props.routing);
  (next.links[props.connection] ??= {})[model] = { id, manual: true, on: true };
  emit("change", next);
}
</script>
<template>
  <dialog
    ref="dialog"
    id="modelListDialog"
    class="modal plist set-ui"
    aria-labelledby="modelListTitle"
    @cancel.prevent="emit('close')"
  >
    <div class="md-head">
      <ConnectionAvatar :connection="routing.connections[connection ?? '']" />
      <h2 id="modelListTitle">
        {{ routing.connections[connection ?? ""]?.name }} 模型列表
      </h2>
      <button
        class="ibtn"
        type="button"
        aria-label="关闭"
        @click="emit('close')"
      >
        <AppIcon name="i-close" />
      </button>
    </div>
    <div class="md-tools">
      <label class="md-search"
        ><AppIcon name="i-search" /><input
          v-model="query"
          type="search"
          placeholder="搜索 ID 或名称"
          aria-label="搜索模型" /></label
      ><button
        class="ibtn"
        type="button"
        aria-label="重新拉取"
        @click="emit('refresh')"
      >
        <AppIcon name="i-retry" />
      </button>
    </div>
    <nav class="md-tabs" role="tablist">
      <button
        v-for="(label, id) in { all: '全部', used: '可用', active: '优先来源', unused: '未启用' }"
        :key="id"
        role="tab"
        :aria-selected="tab === id"
        @click="tab = id"
      >
        {{ label }}
      </button>
    </nav>
    <div class="md-list">
      <div
        v-for="family in families"
        :key="family"
        class="md-group"
        :data-open="open(family)"
      >
        <div class="md-ghead">
          <button
            class="md-chev"
            type="button"
            :aria-expanded="open(family)"
            :aria-label="`${open(family) ? '收起' : '展开'} ${groups[family] || family}`"
            @click="folded[family] = !open(family)"
          >
            <AppIcon name="i-chevron" /></button
          ><span class="vtile"><ModelIcon :family="family" /></span>
          <div class="md-gtitle">
            <b>{{ groups[family] || family }}</b>
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
              <b>{{ r.name || shownId(r.id) }}</b
              ><code v-if="r.name">{{ shownId(r.id) }}</code>
            </div>
            <ModelCapabilities :value="r.caps" />
            <button
              v-if="r.to"
              class="lamp"
              type="button"
              :data-s="r.on ? 'on' : 'off'"
              :title="`${r.active ? '优先来源' : r.on ? '可用' : '未启用'} · ${r.to.name}`"
              :aria-label="`${r.active ? '优先来源' : r.on ? '可用来源' : '已对应，未添加'} ${r.to.name}`"
              @click="emit('reveal', r.to.id)"
            ></button>
            <select
              v-else-if="r.free.length"
              class="md-map"
              :aria-label="`把 ${shownId(r.id)} 用作`"
              @change="use(r.id, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">用作…</option>
              <option v-for="m in r.free" :key="m.id" :value="m.id">
                {{ m.name }}
              </option></select
            ><span v-else class="md-act-gap"></span></div
        ></template>
      </div>
      <div v-if="!shown.length" class="md-empty">
        {{ query ? `没有匹配「${query}」的模型` : "没有模型" }}
      </div>
    </div>
  </dialog>
</template>
