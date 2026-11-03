<script setup lang="ts">
import { computed, useTemplateRef, watch } from "vue";
import AppIcon from "../../shared/AppIcon.vue";
import ModelIcon from "../../shared/ModelIcon.vue";
import ConnectionAvatar from "../../shared/ConnectionAvatar.vue";
import ConnectionMenu from "./ConnectionMenu.vue";
import ConnectionOrderDialog from "./ConnectionOrderDialog.vue";
import type { Connection, Routing } from "../../config/connections";
import type { ConnectionStatus } from "./use-connection-catalogs";
import { imageConnections } from "../../config/connections";
import { profileFor } from "../../gateway/profile";
import { object } from "../../domain/value";
import { novelaiUsage } from "../../domain/quota";
import { configuredModels } from "../../domain/models";
import { catalogEntries, sourceState } from "../../domain/catalog";
const props = defineProps<{
  active: boolean; local: boolean; busy: boolean; testing: string | null;
  routing: Routing; raw: Record<string, unknown>; balances: Record<string, Record<string, unknown>>;
  statuses: Record<string, ConnectionStatus>; currentConnection?: string; askCounts: Record<string, number>;
  currentAskConnection: string; currentAskModel: string;
}>();
const emit = defineEmits<{ add: []; edit: [id: string]; remove: [id: string]; test: [id: string]; models: [id: string]; askModels: [id: string]; move: [id: string, delta: number] }>();
const routing = computed(() => props.routing), raw = computed(() => props.raw), balances = computed(() => props.balances);
const orderDialog = useTemplateRef<InstanceType<typeof ConnectionOrderDialog>>("orderDialog");
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
  return configuredModels(routing.value).filter(
    (m) =>
      sourceState(routing.value, id, m, catalogEntries(raw.value[id])) === "on",
  );
}
const imageSources = computed(() => imageConnections(routing.value));
// Card order follows the connection records; only the image routing list uses Routing.order.
const connectionList = computed(() => Object.values(routing.value.connections));
const priorityIndex = (id: string) => imageSources.value.findIndex(c => c.id === id);
watch(() => props.active, active => { if (!active) orderDialog.value?.close(); });
</script>
<template>
  <section v-show="active" class="sp-sec" aria-label="连接">
    <div class="sp-sec-head conn-sec-head">
      <h3>连接</h3>
      <div v-if="!local && connectionList.length" class="conn-head-actions">
        <button v-if="imageSources.length > 1" class="btn btn-quiet btn-sm" type="button" aria-haspopup="dialog" @click="orderDialog?.open()">
          <AppIcon name="i-swap" />生图顺序
        </button>
        <button class="btn btn-quiet btn-sm" type="button" @click="emit('add')">
          <AppIcon name="i-plus" />配置供应商
        </button>
      </div>
      <p v-if="local">连接由本地服务管理，模型来源可在此调整。</p>
    </div>
    <div v-if="!connectionList.length" class="sp-empty conn-empty">
      <ConnectionAvatar /><span>尚未配置连接</span>
      <button v-if="!local" class="btn btn-quiet btn-sm" type="button" @click="emit('add')">配置供应商</button>
    </div>
    <div v-else class="conn-list">
      <article v-for="c in connectionList" :key="c.id" class="conn-card" :data-connection="c.id">
        <header class="conn-top">
          <ConnectionAvatar :connection="c" />
          <div class="conn-name">
            <b>{{ c.name }}</b><span class="type">{{ profileFor(c.profileId).label }}</span>
          </div>
          <span class="conn-meta" :title="local ? undefined : c.baseUrl">{{ local ? "本机同源代理" : endpoint(c.baseUrl) }}</span>
          <span class="st" :data-s="testing === c.id ? 'wait' : statuses[c.id]?.s || 'wait'" :title="statuses[c.id]?.text">
            {{ testing === c.id ? "测试中…" : statusLabel(statuses[c.id]) }}
          </span>
          <div class="conn-acts">
            <button class="btn btn-quiet btn-sm conn-test" type="button" :disabled="Boolean(testing)" aria-label="测试连接" @click="emit('test', c.id)">
              <AppIcon name="i-retry" /><span>测试</span>
            </button>
            <ConnectionMenu v-if="!local" :id="`connection-menu-${c.id}`" :name="c.name" :active="active" @edit="emit('edit', c.id)" @remove="emit('remove', c.id)" />
          </div>
        </header>
        <div v-if="profileFor(c.profileId).image && meters(c).length" class="conn-meters">
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
        <button
          v-if="profileFor(c.profileId).image"
          class="conn-models" data-kind="image" type="button"
          :aria-label="`图像模型，已启用 ${availableModels(c.id).length} 个，生图顺序第 ${priorityIndex(c.id) + 1} 位`"
          :title="currentConnection === c.id ? '当前工作区的生图来源' : undefined"
          @click="emit('models', c.id)"
        >
          <AppIcon name="i-image" />
          <span class="conn-model-detail"><span class="conn-model-label">图像模型</span><span class="conn-model-count" :title="`已启用 ${availableModels(c.id).length} 个图像模型`">{{ availableModels(c.id).length }}</span></span>
          <span class="conn-model-state" :title="`生图顺序第 ${priorityIndex(c.id) + 1} 位`">{{ priorityIndex(c.id) + 1 }}</span>
          <AppIcon name="i-chevron" />
        </button>
        <button
          v-if="profileFor(c.profileId).reasoning"
          class="conn-models" data-kind="llm" type="button"
          :aria-label="`文字模型，已选 ${askCounts[c.id] ?? 0} 个`"
          :title="currentAskConnection === c.id && currentAskModel ? `ASK 当前使用：${currentAskModel}` : undefined"
          @click="emit('askModels', c.id)"
        >
          <AppIcon name="i-chat" />
          <span class="conn-model-detail"><span class="conn-model-label">文字模型</span><span class="conn-model-count" :title="`已选 ${askCounts[c.id] ?? 0} 个文字模型`">{{ askCounts[c.id] ?? 0 }}</span></span>
          <AppIcon name="i-chevron" />
        </button>
      </article>
    </div>
    <ConnectionOrderDialog ref="orderDialog" :connections="imageSources" :busy="busy || local" @move="(id, delta) => emit('move', id, delta)" />
  </section>
</template>
