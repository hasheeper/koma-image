<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";
import { copyText, download } from "../shared/files.ts";
import { message } from "../app/ui.ts";
import AppIcon from "../shared/AppIcon.vue";
import { inspectCall } from "./debug.ts";

const props = defineProps<{ turn?: number }>(), emit = defineEmits<{ close: [] }>(), ask = useAsk();
const dialog = shallowRef<HTMLDialogElement | null>(null), selected = shallowRef(0), filter = shallowRef(props.turn), json = shallowRef(false), notice = shallowRef("");
// This conversation plus page-level board naming; exporting all keeps every conversation.
const mine = computed(() => ask.debug.value.calls.filter(c => c.conversation === ask.conversationId.value || c.conversation.startsWith("board:")));
const calls = computed(() => mine.value.filter(c => filter.value === undefined || c.turn === filter.value));
watch(calls, list => { if (!list.some(c => c.id === selected.value)) selected.value = list.at(-1)?.id ?? 0; }, { immediate: true });
watch(selected, () => { notice.value = ""; });
const record = computed(() => { void ask.debug.value; return ask.debugCall(selected.value); });
const inspection = computed(() => record.value ? inspectCall(record.value, ask.debugPrevious(record.value.id)) : null);
const uncached = computed(() => {
  const r = record.value;
  return r?.usage && r.cache.read !== null && r.usage.input >= r.cache.read ? r.usage.input - r.cache.read : null;
});
const status = { running: "响应中", done: "响应完成", failed: "请求失败", stopped: "已停止" };
const comparison = { same: "内容相同", changed: "内容变化", new: "新增内容", none: "首次记录" };
const number = (n: number | null | undefined) => n == null ? "未报告" : n.toLocaleString("zh-CN");
const turnStatus = computed(() => {
  const r = record.value;
  const turn = r && ask.entries.value.find(e => e.type === "turn" && e.id === r.turn);
  return turn?.type === "turn" && ["failed", "stopped"].includes(turn.turn.status) ? "本轮未计入后续会话" : "";
});
async function copy() {
  if (!record.value) return;
  try { await copyText(record.value.body); notice.value = "已复制完整请求 JSON（含图片 Base64）"; }
  catch (error) { notice.value = message(error); }
}
function save(all = false) {
  if (!record.value && !all) return;
  download(new Blob([ask.exportDebug(all ? undefined : selected.value)], { type: "application/json" }), `koma-ask-calls-${all ? "all" : selected.value}.json`);
  notice.value = "已导出调用记录，body 字段为原始请求 JSON";
}
onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => dialog.value?.close());
</script>
<template>
  <Teleport to="body">
    <dialog id="askDebug" ref="dialog" class="ask-debug" aria-labelledby="askDebugTitle" @cancel.prevent="emit('close')" @close="emit('close')">
      <div class="debug-frame">
        <header class="debug-head">
          <h2 id="askDebugTitle">调用上下文</h2>
          <button v-if="filter !== undefined" class="btn btn-quiet btn-xs" type="button" @click="filter = undefined">查看全部</button>
          <span class="debug-count">{{ mine.length }} 次记录</span>
          <button class="ibtn" type="button" aria-label="关闭调用上下文" autofocus @click="emit('close')"><AppIcon name="i-close" /></button>
        </header>
        <div class="debug-toolbar">
          <label class="sr-only" for="askDebugCall">选择调用</label>
          <select id="askDebugCall" v-model="selected" :disabled="!calls.length">
            <option v-if="!calls.length" :value="0">暂无调用</option>
            <option v-for="call in calls" :key="call.id" :value="call.id">#{{ call.id }} · 第 {{ call.step }} 次 · {{ status[call.status] }} · {{ call.question.slice(0, 45) }}</option>
          </select>
          <div class="debug-actions">
            <button class="btn btn-quiet btn-xs" type="button" :disabled="!record" @click="copy">复制请求 JSON</button>
            <button class="btn btn-quiet btn-xs" type="button" :disabled="!record" @click="save()">导出本次</button>
            <button class="btn btn-quiet btn-xs" type="button" :disabled="!ask.debug.value.calls.length" @click="save(true)">导出全部</button>
            <button class="btn btn-quiet btn-xs" type="button" :disabled="ask.running.value || !!ask.naming.value || !ask.debug.value.calls.length" @click="ask.clearDebug()">清空记录</button>
          </div>
        </div>
        <p v-if="notice" class="debug-feedback" role="status">{{ notice }}</p>
        <div class="debug-scroll">
          <template v-if="record && inspection">
            <p class="debug-meta">{{ record.protocol }} · {{ record.model }} · {{ new Date(record.started).toLocaleTimeString() }} · {{ (record.bytes / 1024).toFixed(1) }} KB<template v-if="record.ended !== null"> · {{ ((record.ended - record.started) / 1000).toFixed(2) }} s</template> · {{ record.promptVersion }}<template v-if="record.stop"> · {{ record.stop }}</template></p>
            <p class="debug-question">{{ record.question }}</p>
            <p v-if="turnStatus" class="debug-note">{{ turnStatus }}；调用记录仍保留供检查。</p>
            <dl class="debug-usage" aria-label="上游返回的 token 用量">
              <div><dt>输入</dt><dd>{{ number(record.usage?.input) }}</dd></div>
              <div><dt>缓存命中</dt><dd>{{ number(record.cache.read) }}</dd></div>
              <div><dt>未从缓存读取</dt><dd>{{ number(uncached) }}</dd></div>
              <div><dt>新建缓存</dt><dd>{{ number(record.cache.write) }}</dd></div>
              <div><dt>输出</dt><dd>{{ number(record.usage?.output) }}</dd></div>
            </dl>
            <p class="debug-note">以上为上游返回的 token 数；未从缓存读取包含新建缓存。接口未返回的缓存计数显示“未报告”，无法据此定位具体命中了哪段文字。</p>
            <section class="debug-cache" aria-label="缓存策略与标记">
              <h3>{{ record.protocol === 'anthropic-messages' ? '显式缓存标记' : '自动前缀缓存' }}</h3>
              <template v-if="inspection.breakpoints.length">
                <p>实际请求在以下位置携带 cache_control；标记表示申请缓存，命中情况以上游用量为准。</p>
                <ul><li v-for="path in inspection.breakpoints" :key="path"><code>{{ path }}</code></li></ul>
              </template>
              <p v-else>请求不携带显式缓存断点，是否缓存由上游决定。</p>
              <p v-if="inspection.previous !== null">与同连接、同模型的调用 #{{ inspection.previous }} 比较，前 {{ inspection.prefix }} 块内容相同。下方比较忽略 cache_control，仅表示本地内容是否一致，不代表缓存命中。</p>
              <p v-else>没有保留的同连接、同模型前次记录可供比较。</p>
            </section>
            <div class="debug-tabs" role="group" aria-label="上下文显示方式">
              <button class="btn btn-quiet btn-xs" type="button" :aria-pressed="!json" @click="json = false">分块查看</button>
              <button class="btn btn-quiet btn-xs" type="button" :aria-pressed="json" @click="json = true">请求 JSON</button>
            </div>
            <p class="debug-note">显示实际出站内容。图片 Base64 在预览中折叠，复制与导出保留完整请求。</p>
            <pre v-if="json" class="debug-code">{{ inspection.json }}</pre>
            <template v-else>
              <details class="debug-part"><summary>请求参数</summary><pre class="debug-code">{{ inspection.parameters }}</pre></details>
              <details v-for="part in inspection.parts" :key="`${record.id}:${part.path}`" class="debug-part">
                <summary><span>{{ part.label }}<small>{{ part.path }}</small></span><span class="debug-comparison" :data-same="part.comparison === 'same'">{{ comparison[part.comparison] }}</span></summary>
                <pre class="debug-code">{{ part.text }}</pre>
              </details>
            </template>
            <div v-if="inspection.images.length" class="debug-images" aria-label="实际发送的图片">
              <figure v-for="(image, i) in inspection.images" :key="image.path"><img :src="image.url" :alt="`发送的图片 ${i + 1}`" /><figcaption>图片 {{ i + 1 }} · {{ (image.bytes / 1024).toFixed(1) }} KB<br />{{ image.path }}</figcaption></figure>
            </div>
          </template>
          <p v-else class="debug-empty">发送 ASK 提问或使用 AI 命名后，可在这里查看实际调用。</p>
          <p class="debug-retention">记录仅在本页内存中保留，刷新清空，不进入备份；最多保留最近 20 次、约 16 MiB 文本，单次超出时完整保留最新一条。{{ ask.debug.value.dropped ? `已释放 ${ask.debug.value.dropped} 条较早记录。` : '' }}</p>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
<style scoped>
.ask-debug { width: min(960px, calc(100vw - 24px)); max-width: none; height: min(820px, calc(100dvh - 32px)); max-height: none; margin: auto; padding: 0; overflow: hidden; color: var(--fg); font: var(--fw-regular) var(--fz-sm)/1.6 var(--sans); background: rgba(22, 22, 25, .94); border: 1px solid var(--line-2); border-radius: 20px; box-shadow: 0 20px 80px rgba(0, 0, 0, .5); backdrop-filter: blur(20px); }
.ask-debug::backdrop { background: rgba(0, 0, 0, .4); }
.ask-debug[open] { display: flex; flex-direction: column; }
.debug-frame { display: flex; flex: 1; flex-direction: column; min-height: 0; }
/* The shared toast host teleports into this native dialog; reserve its space. */
.ask-debug :deep(.editor-toasts) { position: static; flex: none; width: auto; max-height: 35%; margin: 0 12px; overflow: auto; }
.debug-head { display: flex; flex: none; align-items: center; gap: 12px; padding: 14px 18px 10px; }
.debug-head h2 { margin: 0; font-size: var(--fz-md); font-weight: var(--fw-semibold); }
.debug-count { flex: 1; color: var(--fg-3); font-size: var(--fz-xs); text-align: right; }
.debug-toolbar { display: flex; flex: none; flex-wrap: wrap; gap: 8px; padding: 0 18px 12px; border-bottom: 1px solid var(--line); }
.debug-toolbar select { width: 100%; min-width: 0; height: 32px; padding: 0 8px; color: var(--fg); font: inherit; background: var(--hover); border: 1px solid var(--line-2); border-radius: 8px; }
.debug-toolbar option { background: var(--chrome); }
.debug-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.debug-scroll { flex: 1; min-height: 0; padding: 14px 18px 20px; overflow: auto; overscroll-behavior: contain; }
.debug-meta, .debug-note, .debug-retention { color: var(--fg-3); font-size: var(--fz-xs); overflow-wrap: anywhere; }
.debug-question { margin: 10px 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.debug-usage { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin: 14px 0 8px; }
.debug-usage > div { padding: 8px; background: var(--hover); border-radius: 10px; }
.debug-usage dt { color: var(--fg-3); font-size: var(--fz-xs); }
.debug-usage dd { margin: 3px 0 0; font-family: var(--mono); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.debug-cache { margin: 16px 0; padding: 12px; border: 1px solid var(--line-2); border-radius: 12px; }
.debug-cache h3 { font-size: var(--fz-sm); font-weight: var(--fw-semibold); }
.debug-cache p { margin-top: 6px; color: var(--fg-3); overflow-wrap: anywhere; }
.debug-cache ul { padding-left: 18px; }
.debug-cache code { color: var(--a); font-family: var(--mono); font-size: var(--fz-xs); overflow-wrap: anywhere; }
.debug-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.debug-tabs [aria-pressed="true"] { color: var(--a); background: var(--hover); }
.debug-part { margin-top: 8px; border: 1px solid var(--line); border-radius: 10px; }
.debug-part summary { display: flex; justify-content: space-between; gap: 8px; padding: 10px 12px; cursor: pointer; }
.debug-part summary > span { min-width: 0; overflow-wrap: anywhere; }
.debug-part small { display: block; color: var(--fg-3); font: var(--fw-regular) var(--fz-xs)/1.5 var(--mono); }
.debug-comparison { flex: none; align-self: center; color: var(--fg-3); font-size: var(--fz-xs); }
.debug-comparison[data-same="true"] { color: var(--a); }
.debug-code { max-width: 100%; margin-top: 8px; padding: 12px; color: var(--fg-2); font: var(--fw-regular) var(--fz-xs)/1.65 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.debug-images { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
.debug-images figure { width: min(240px, 100%); }
.debug-images img { display: block; max-width: 100%; max-height: 200px; border-radius: 8px; object-fit: contain; }
.debug-images figcaption { margin-top: 6px; color: var(--fg-3); font-size: var(--fz-xs); overflow-wrap: anywhere; }
.debug-feedback { flex: none; padding: 8px 18px; color: var(--a); font-size: var(--fz-xs); }
.debug-empty { padding: 32px 0; color: var(--fg-3); }
.debug-retention { margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--line); }
@media (max-width: 600px) { .debug-usage { grid-template-columns: repeat(2, minmax(0, 1fr)); } .debug-head, .debug-toolbar, .debug-scroll { padding-right: 12px; padding-left: 12px; } }
</style>
