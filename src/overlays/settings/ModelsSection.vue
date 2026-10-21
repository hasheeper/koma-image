<script setup lang="ts">
import { computed, ref } from "vue";
import { MODELS } from "../../domain/models.ts";
import type { ModelIdentity } from "../../domain/models.ts";
import {
  catalogEntries,
  linkFor,
  sourceState,
  shownId,
} from "../../domain/catalog.ts";
import type { Routing, ModelLink } from "../../config/connections.ts";
import { imageConnections } from "../../config/connections.ts";
import ModelIcon from "../../shared/ModelIcon.vue";
import ModelCapabilities from "../../shared/ModelCapabilities.vue";
import AppIcon from "../../shared/AppIcon.vue";
const props = defineProps<{
  routing: Routing;
  raw: Record<string, unknown>;
  statuses: Record<string, { s: string; text: string }>;
}>();
const emit = defineEmits<{ change: [routing: Routing]; reload: [] }>();
const opened = ref(new Set<string>());
const avatar = `${import.meta.env.BASE_URL}assets/default-avatar.svg`;
const groups = { gpt: "GPT", gemini: "Gemini", novelai: "NovelAI" };
// Reasoning-only connections serve ASK and never appear as image model sources.
const sources = computed(() => imageConnections(props.routing));
const entries = (c: string) => catalogEntries(props.raw[c]);
const link = (c: string, m: ModelIdentity) =>
  linkFor(props.routing, c, m, entries(c));
const state = (c: string, m: ModelIdentity) =>
  sourceState(props.routing, c, m, entries(c));
const count = (m: ModelIdentity) =>
  sources.value.filter((c) => state(c.id, m) === "on")
    .length;
function spare(c: string, m: ModelIdentity) {
  const claimed = new Set(
    MODELS.map((model) => link(c, model)?.id).filter(Boolean),
  );
  return entries(c).filter(
    (e) => !claimed.has(e.id) && (!e.family || e.family === m.family),
  );
}
function change(c: string, m: ModelIdentity, value: ModelLink | null) {
  const next = structuredClone(props.routing);
  next.links[c] ??= {};
  if (value) next.links[c][m.id] = value;
  else delete next.links[c][m.id];
  emit("change", next);
}
function toggle(c: string, m: ModelIdentity) {
  const value = link(c, m);
  if (value)
    change(
      c,
      m,
      value.on
        ? { ...value, on: false }
        : value.manual
          ? { ...value, on: true }
          : null,
    );
}
function expand(id: string) {
  const next = new Set(opened.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  opened.value = next;
}
defineExpose({
  reveal(id: string) {
    opened.value = new Set([...opened.value, id]);
  },
});
</script>
<template>
  <section class="sp-sec" aria-label="模型">
    <div class="sp-sec-head">
      <h3>模型</h3>
      <p>添加的来源出现在工作区的模型菜单里。</p>
    </div>
    <div v-if="!sources.length" class="sp-group">
      <div class="sp-empty">尚未配置模型来源</div>
    </div>
    <div v-else-if="!sources.some((c) => raw[c.id])" class="sp-group">
      <div class="sp-empty">
        <span>{{
          Object.values(statuses).find((s) => s.s !== "ok")?.text ||
          "正在读取模型列表…"
        }}</span
        ><button
          class="btn btn-quiet btn-xs"
          type="button"
          @click="emit('reload')"
        >
          重试
        </button>
      </div>
    </div>
    <div v-else class="sm">
      <div v-for="(title, family) in groups" :key="family" class="md-group">
        <div class="md-ghead">
          <span class="vtile"><ModelIcon :family="family" /></span>
          <div class="md-gtitle">
            <b>{{ title }}</b>
          </div>
          <span class="md-count">{{
            MODELS.filter((m) => m.family === family).length
          }}</span>
        </div>
        <div
          v-for="model in MODELS.filter((m) => m.family === family)"
          :key="model.id"
          class="sm-model"
          :data-model="model.id"
          :data-open="opened.has(model.id)"
        >
          <div
            class="md-row sm-row"
            :data-added="count(model) > 0"
            @click.self="expand(model.id)"
          >
            <span class="vtile"><ModelIcon :family="family" /></span>
            <div class="md-id" @click="expand(model.id)">
              <b>{{ model.name }}</b
              ><code>{{ model.id }}</code>
            </div>
            <ModelCapabilities :value="family === 'novelai' ? 'geiu' : 'ge'" />
            <button
              class="src-n"
              type="button"
              :data-s="count(model) ? 'on' : 'off'"
              :aria-label="`${model.name} 的 ${count(model)} 个来源`"
              @click="expand(model.id)"
            >
              {{ count(model) }}
            </button>
            <button
              class="md-chev"
              type="button"
              :aria-expanded="opened.has(model.id)"
              :aria-label="`${opened.has(model.id) ? '收起' : '展开'} ${model.name} 的来源`"
              @click="expand(model.id)"
            >
              <AppIcon name="i-chevron" />
            </button>
          </div>
          <div v-if="opened.has(model.id)" class="sm-lines">
            <div
              v-for="c in sources"
              :key="c.id"
              class="sm-line"
              :data-s="state(c.id, model)"
            >
              <span class="cm"><img :src="avatar" alt="" /></span
              ><span class="sm-conn">{{ c.name }}</span>
              <div class="sm-where">
                <span v-if="state(c.id, model) === 'miss'" class="md-miss"
                  >未找到</span
                ><code v-else>{{ shownId(link(c.id, model)?.id ?? "") }}</code>
                <i v-if="state(c.id, model) === 'gone'" class="type warn"
                  >已下架</i
                >
                <button
                  v-if="link(c.id, model)?.manual"
                  class="type"
                  type="button"
                  title="恢复按规则对应"
                  @click="change(c.id, model, null)"
                >
                  手动指定 ×
                </button>
              </div>
              <template v-if="['on', 'off'].includes(state(c.id, model))"
                ><button
                  class="md-act"
                  type="button"
                  :aria-pressed="state(c.id, model) === 'on'"
                  :aria-label="`${state(c.id, model) === 'on' ? '移除' : '添加'} ${c.name} 来源`"
                  @click="toggle(c.id, model)"
                >
                  <AppIcon
                    :name="state(c.id, model) === 'on' ? 'i-check' : 'i-plus'"
                  /></button
              ></template>
              <template v-else
                ><select
                  v-if="spare(c.id, model).length"
                  class="md-map"
                  :aria-label="`为 ${model.name} 指定 ${c.name} 上的 ID`"
                  @change="
                    change(c.id, model, {
                      id: ($event.target as HTMLSelectElement).value,
                      manual: true,
                      on: true,
                    })
                  "
                >
                  <option value="">指定 ID…</option>
                  <option
                    v-for="e in spare(c.id, model)"
                    :key="e.id"
                    :value="e.id"
                  >
                    {{ shownId(e.id) }}
                  </option></select
                ><button
                  v-if="state(c.id, model) === 'gone'"
                  class="md-act"
                  type="button"
                  aria-label="移除这个来源"
                  @click="change(c.id, model, null)"
                >
                  <AppIcon name="i-close" /></button
              ></template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
