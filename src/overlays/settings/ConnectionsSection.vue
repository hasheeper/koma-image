<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "../../shared/AppIcon.vue";
import ModelIcon from "../../shared/ModelIcon.vue";
import ConnectionAvatar from "../../shared/ConnectionAvatar.vue";
import ConnectionMenu from "./ConnectionMenu.vue";
import type { Connection, Routing } from "../../config/connections";
import type { ConnectionStatus } from "./use-connection-catalogs";
import { imageConnections, reasoningConnections } from "../../config/connections";
import { profileFor } from "../../gateway/profile";
import { object } from "../../domain/value";
import { novelaiUsage } from "../../domain/quota";
import { MODELS } from "../../domain/models";
import { catalogEntries, sourceState } from "../../domain/catalog";
const props = defineProps<{
  active: boolean; local: boolean; busy: boolean; testing: string | null;
  routing: Routing; raw: Record<string, unknown>; balances: Record<string, Record<string, unknown>>;
  statuses: Record<string, ConnectionStatus>; currentConnection?: string; askLabels: Record<string, string>;
}>();
const emit = defineEmits<{ add: []; edit: [id: string]; remove: [id: string]; test: [id: string]; models: [id: string]; askModels: [id: string]; move: [id: string, delta: number] }>();
const routing = computed(() => props.routing), raw = computed(() => props.raw), balances = computed(() => props.balances);
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
const imageSources = computed(() => imageConnections(routing.value));
// Independent capability lists: a supplier with both configured interfaces belongs in both sections.
const connectionGroups = computed(() => [
  { id: "image", label: "图像", icon: "i-image", connections: imageSources.value },
  { id: "llm", label: "文本", icon: "i-chat", connections: reasoningConnections(routing.value) },
]);
const priorityIndex = (id: string) => imageSources.value.findIndex(c => c.id === id);
</script>
<template>
          <section
            v-show="active"
            class="sp-sec"
            aria-label="连接"
          >
            <div class="sp-sec-head conn-sec-head">
              <h3>连接</h3>
              <button
                v-if="!local && Object.keys(routing.connections).length"
                class="btn btn-quiet btn-sm"
                type="button"
                @click="emit('add')"
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
              ><button class="btn btn-quiet btn-sm" type="button" @click="emit('add')">
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
                  >{{ testing === c.id ? "测试中…" : statusLabel(statuses[c.id]) }}<template v-if="group.id === 'image' && currentConnection === c.id"> · 当前使用</template></span
                >
                <div class="conn-acts">
                  <button
                    class="btn btn-quiet btn-sm conn-test"
                    type="button"
                    :disabled="Boolean(testing)"
                    aria-label="测试连接"
                    @click="emit('test', c.id)"
                  >
                    <AppIcon name="i-retry" /><span>测试</span>
                  </button>
                  <ConnectionMenu v-if="!local" :id="`connection-menu-${group.id}-${c.id}`" :name="c.name" :active="active" @edit="emit('edit', c.id)" @remove="emit('remove', c.id)" />
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
                @click="emit('askModels', c.id)"
              >
                <span class="conn-model-label">ASK 模型</span
                ><span>{{ askLabels[c.id] }}</span
                ><AppIcon name="i-chevron" />
              </button>
              </div>
              <div v-else class="conn-source-row">
                <button
                  class="conn-models"
                  type="button"
                  :disabled="!raw[c.id]"
                  :aria-label="raw[c.id] ? `查看 ${c.name} 的模型列表：共 ${catalogEntries(raw[c.id]).length} 个，可用 ${availableModels(c.id).length} 个` : `${c.name} 模型列表尚未加载`"
                  @click="emit('models', c.id)"
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
                  <button class="md-act" type="button" :aria-label="`提高 ${c.name} 的优先级`" title="提高优先级" :disabled="local || busy || priorityIndex(c.id) === 0" @click="emit('move', c.id, -1)"><AppIcon name="i-up" /></button>
                  <button class="md-act" type="button" :aria-label="`降低 ${c.name} 的优先级`" title="降低优先级" :disabled="local || busy || priorityIndex(c.id) === imageSources.length - 1" @click="emit('move', c.id, 1)"><AppIcon name="i-down" /></button>
                </div>
              </div>
            </article>
            </section>
            </template>
          </section>
</template>
