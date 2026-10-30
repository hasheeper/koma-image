<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";
import { message, useUi } from "../app/ui.ts";
import { copyText, download } from "../shared/files.ts";
import AppIcon from "../shared/AppIcon.vue";
import AskMenu from "./AskMenu.vue";
import { inspectCall } from "./debug.ts";
import type { CallSummary, ContextPart, PartRole, PartSection } from "./debug.ts";
import { toolIcons } from "./presentation.ts";

const props = defineProps<{ turn?: number }>(), emit = defineEmits<{ close: [] }>(), ask = useAsk(), ui = useUi();
const dialog = shallowRef<HTMLDialogElement | null>(null), selected = shallowRef(0), filter = shallowRef(props.turn);
// Open rows reset per call; the two collapsed groups keep their state while stepping between calls.
const open = shallowRef<ReadonlySet<string>>(new Set()), expanded = shallowRef({ prefix: false, history: false });
const copied = shallowRef(false), sizes = shallowRef<Readonly<Record<string, string>>>({});
let copiedTimer = 0;
// This conversation plus page-level board naming; exporting all keeps every conversation.
const mine = computed(() => ask.debug.value.calls.filter(c => c.conversation === ask.conversationId.value || c.conversation.startsWith("board:")));
const calls = computed(() => mine.value.filter(c => filter.value === undefined || c.turn === filter.value));
watch(calls, list => { if (!list.some(c => c.id === selected.value)) selected.value = list.at(-1)?.id ?? 0; }, { immediate: true });
watch(selected, () => { open.value = new Set(); copied.value = false; });
const record = computed(() => { void ask.debug.value; return ask.debugCall(selected.value); });
const inspection = computed(() => record.value ? inspectCall(record.value, ask.debugPrevious(record.value.id)) : null);
const at = computed(() => calls.value.findIndex(c => c.id === selected.value));

const status = { running: "响应中", done: "完成", failed: "请求失败", stopped: "已停止" };
const roles: Record<PartRole, string> = { definition: "定义", system: "系统", user: "用户", model: "模型", tool: "工具" };
const purpose = (c: CallSummary) => c.purpose === "compaction" ? "压缩" : c.turn === 0 ? "AI 命名" : c.afterCompaction ? "压缩后首次" : `第 ${c.step} 次`;
const callName = (c: CallSummary) => c.turn === 0 ? c.question : `${purpose(c)} · ${c.question}`;
const clock = (time: number, seconds = true) => new Date(time).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const number = (n: number | null) => n === null ? "未报告" : n.toLocaleString("zh-CN");
const turnStatus = computed(() => {
  const r = record.value;
  const turn = r && ask.entries.value.find(e => e.type === "turn" && e.id === r.turn);
  return turn?.type === "turn" && ["failed", "stopped"].includes(turn.turn.status) ? "本轮未计入后续会话" : "";
});

const usage = computed(() => {
  const r = record.value, input = r?.usage?.input ?? null, read = r?.cache.read ?? null, write = r?.cache.write ?? null;
  if (!r || input === null && read === null && write === null) return null;
  const miss = input !== null && read !== null && input >= read ? input - read : null;
  return {
    meters: [
      { key: "input", label: "输入", value: input, rate: "" },
      { key: "read", label: "缓存命中", value: read, rate: input && read !== null ? `${Math.round(read / input * 100)}%` : "" },
      { key: "miss", label: "未从缓存读取", value: miss, rate: "" },
      { key: "write", label: "新建缓存", value: write, rate: "" },
      { key: "output", label: "输出", value: r.usage?.output ?? null, rate: "" },
    ],
    bar: input && read !== null && miss !== null ? { read: read / input * 100, write: Math.min(write ?? 0, miss) / input * 100, miss: (miss - Math.min(write ?? 0, miss)) / input * 100 } : null,
  };
});
const facts = computed(() => {
  const r = record.value, i = inspection.value;
  if (!r || !i) return [];
  const cache = r.protocol === "openai-chat" ? "自动前缀" : i.breakpoints.length ? `显式标记 ${i.breakpoints.length} 处` : "无断点";
  return ([["耗时", r.ended === null ? "" : `${((r.ended - r.started) / 1000).toFixed(2)} s`], ["大小", kb(r.bytes)], ["结束", r.stop ?? ""], ["版本", r.promptVersion], ["缓存", cache]] as const).filter(([, v]) => v);
});

const sections: readonly { key: PartSection; name: string }[] = [{ key: "tools", name: "工具" }, { key: "system", name: "系统" }, { key: "history", name: "历史" }, { key: "current", name: "本轮" }];
const total = (parts: readonly ContextPart[]) => parts.reduce((sum, p) => sum + p.bytes, 0);
const structure = computed(() => sections.map(s => {
  const parts = inspection.value?.parts.filter(p => p.section === s.key) ?? [];
  return { ...s, parts, bytes: total(parts) };
}).filter(s => s.parts.length));
const tally = computed(() => {
  const parts = inspection.value?.parts ?? [];
  return { changed: parts.filter(p => p.comparison === "changed").length, fresh: parts.filter(p => p.comparison === "new").length, bytes: total(parts) };
});
const groups = computed(() => {
  const i = inspection.value;
  if (!i) return [];
  return ([
    { key: "prefix", name: "工具与系统", parts: i.parts.filter(p => p.section === "tools" || p.section === "system") },
    { key: "history", name: i.turns ? `历史 · ${i.turns} 轮` : "历史", parts: i.parts.filter(p => p.section === "history") },
    { key: "current", name: record.value?.purpose === "compaction" ? "压缩指令" : "本轮", parts: i.parts.filter(p => p.section === "current") },
  ] as const).filter(g => g.parts.length || g.key === "prefix").map(g => ({ ...g,
    open: g.key === "current" || expanded.value[g.key], bytes: total(g.parts), images: g.parts.reduce((n, p) => n + p.images, 0),
    changed: g.parts.filter(p => p.comparison === "changed").length, fresh: g.parts.filter(p => p.comparison === "new").length }));
});
const parameterKeys = computed(() => inspection.value ? Object.keys(JSON.parse(inspection.value.parameters)).join(" · ") : "");
const index = (path: string) => (inspection.value?.parts.findIndex(p => p.path === path) ?? -1) + 1;
const imagesOf = (path: string) => inspection.value?.images.filter(image => image.part === path) ?? [];

function toggle(path: string) {
  const next = new Set(open.value);
  if (!next.delete(path)) next.add(path);
  open.value = next;
}
async function jump(path: string) {
  const part = inspection.value?.parts.find(p => p.path === path);
  if (!part) return;
  open.value = new Set(open.value).add(path);
  if (part.section === "history") expanded.value = { ...expanded.value, history: true };
  else if (part.section !== "current") expanded.value = { ...expanded.value, prefix: true };
  await nextTick();
  dialog.value?.querySelector(`.debug-row[data-part="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
function measure(path: string, event: Event) {
  const image = event.target as HTMLImageElement;
  sizes.value = { ...sizes.value, [path]: `${image.naturalWidth}×${image.naturalHeight}` };
}
function step(by: number) {
  const next = calls.value[at.value + by];
  if (next) selected.value = next.id;
}
async function copy() {
  if (!record.value) return;
  try {
    await copyText(record.value.body);
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => { copied.value = false; }, 1200);
  } catch (error) { ui.toast(message(error), "err"); }
}
function save(all = false) {
  if (!record.value && !all) return;
  download(new Blob([ask.exportDebug(all ? undefined : selected.value)], { type: "application/json" }), `koma-ask-calls-${all ? "all" : selected.value}.json`);
  ui.toast("已导出调用记录，body 字段为原始请求 JSON", "ok");
}
onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => { clearTimeout(copiedTimer); dialog.value?.close(); });
</script>
<template>
  <Teleport to="body">
    <dialog id="askDebug" ref="dialog" class="modal ask-debug" aria-labelledby="askDebugTitle" @cancel.prevent="emit('close')" @close="emit('close')">
      <header class="debug-top">
        <h2 id="askDebugTitle">调用上下文</h2>
        <span class="debug-top-sep" aria-hidden="true"></span>
        <AskMenu id="askDebugCalls" class="debug-picker" label="选择调用" side="left">
          <template #trigger="{ open: shown, toggle: show }">
            <button id="askDebugCall" class="debug-pick" type="button" aria-haspopup="menu" :aria-expanded="shown" :data-call="record?.id" :disabled="!calls.length" @click="show">
              <template v-if="record"><span class="debug-pick-id">#{{ record.id }}</span><span class="debug-pick-name">{{ purpose(record) }}</span></template>
              <span v-else class="debug-pick-name">暂无调用</span>
              <AppIcon name="i-chevron" class="debug-down" />
            </button>
          </template>
          <template #default="{ close }">
            <button v-for="call in [...calls].reverse()" :key="call.id" class="menu-item" type="button" role="menuitemradio" :aria-checked="call.id === selected" @click="selected = call.id; close(true)">
              <span class="debug-mi-id">#{{ call.id }}</span><span class="menu-label">{{ callName(call) }}</span>
              <span v-if="call.status !== 'done'" class="debug-st" :data-s="call.status">{{ status[call.status] }}</span>
              <span class="menu-meta">{{ clock(call.started, false) }}</span><AppIcon name="i-check" class="menu-check" />
            </button>
            <template v-if="filter !== undefined">
              <hr />
              <button class="menu-item" type="button" role="menuitem" @click="filter = undefined; close(true)"><AppIcon name="i-history" /><span class="menu-label">查看全部</span><span class="menu-meta">{{ mine.length }}</span></button>
            </template>
          </template>
        </AskMenu>
        <span class="debug-steps">
          <button class="ibtn" type="button" data-tip="较早" aria-label="较早的调用" :disabled="at <= 0" @click="step(-1)"><AppIcon name="i-chevron" class="debug-flip" /></button>
          <button class="ibtn" type="button" data-tip="较新" aria-label="较新的调用" :disabled="at < 0 || at >= calls.length - 1" @click="step(1)"><AppIcon name="i-chevron" /></button>
        </span>
        <span class="debug-gap"></span>
        <button class="ibtn" type="button" data-tip="复制请求 JSON" aria-label="复制请求 JSON" :data-state="copied ? 'done' : undefined" :disabled="!record" @click="copy"><AppIcon :name="copied ? 'i-check' : 'i-copy'" /></button>
        <AskMenu id="askDebugMore" label="调用记录" side="right">
          <template #trigger="{ open: shown, toggle: show }">
            <button class="ibtn" type="button" aria-label="更多" aria-haspopup="menu" :aria-expanded="shown" @click="show"><AppIcon name="i-more" /></button>
          </template>
          <template #default="{ close }">
            <button class="menu-item" type="button" role="menuitem" :disabled="!record" @click="save(); close(true)"><AppIcon name="i-download" /><span class="menu-label">导出本次</span></button>
            <button class="menu-item" type="button" role="menuitem" :disabled="!ask.debug.value.calls.length" @click="save(true); close(true)"><AppIcon name="i-download" /><span class="menu-label">导出全部</span><span class="menu-meta">{{ ask.debug.value.calls.length }}</span></button>
            <hr />
            <button class="menu-item danger" type="button" role="menuitem" :disabled="ask.running.value || !!ask.naming.value || !ask.debug.value.calls.length" @click="ask.clearDebug(); close(true)"><AppIcon name="i-trash" /><span class="menu-label">清空记录</span></button>
          </template>
        </AskMenu>
        <button class="ibtn" type="button" aria-label="关闭调用上下文" autofocus @click="emit('close')"><AppIcon name="i-close" /></button>
      </header>
      <div class="debug-scroll">
        <template v-if="record && inspection">
          <section class="debug-card debug-id" aria-label="调用概要">
            <div class="debug-id-top">
              <p class="debug-q" :title="`${record.question}\n开始 ${clock(record.started)}`">{{ record.afterCompaction ? '压缩后首次调用 · ' : '' }}{{ record.question }}</p>
              <span class="debug-model"><AppIcon name="i-model" /><b>{{ record.model }}</b><span>{{ record.protocol }}</span></span>
              <span class="debug-pill" :data-s="record.status">{{ status[record.status] }}</span>
            </div>
            <dl class="debug-facts">
              <div v-for="([name, value], n) in facts" :key="name">
                <dt>{{ name }}</dt><dd>{{ value }}</dd>
                <span v-if="n === facts.length - 1" class="debug-hint" tabindex="0" role="img" aria-label="用量说明" aria-describedby="askDebugUsageTip">
                  <AppIcon name="i-info" />
                  <span id="askDebugUsageTip" class="debug-pop" role="tooltip">上游返回的 token 数，未从缓存读取包含新建缓存；接口未返回的计数显示「未报告」，无法据此定位命中了哪段文字。<template v-if="record.protocol === 'anthropic-messages'">请求在 {{ inspection.breakpoints.length }} 处携带 cache_control（分块中以 <AppIcon name="i-pin" class="debug-inline" /> 标出），标记表示申请缓存，命中以上游用量为准。</template><template v-else>请求不携带显式缓存断点，是否缓存由上游决定。</template></span>
                </span>
              </div>
            </dl>
            <p v-if="turnStatus" class="debug-note">{{ turnStatus }}；调用记录仍保留供检查。</p>
            <div class="debug-use">
              <template v-if="usage">
                <dl class="debug-meters" aria-label="上游返回的 token 用量">
                  <div v-for="meter in usage.meters" :key="meter.key" :data-meter="meter.key">
                    <dt><i v-if="['read', 'miss', 'write'].includes(meter.key) && meter.value !== null" class="debug-sw" :data-k="meter.key"></i>{{ meter.label }}</dt>
                    <dd :data-unknown="meter.value === null || undefined"><span>{{ number(meter.value) }}</span><small v-if="meter.rate">{{ meter.rate }}</small></dd>
                  </div>
                </dl>
                <span v-if="usage.bar" class="debug-ubar" aria-hidden="true"><i data-k="read" :style="{ width: `${usage.bar.read}%` }"></i><i data-k="write" :style="{ width: `${usage.bar.write}%` }"></i><i data-k="miss" :style="{ width: `${usage.bar.miss}%` }"></i></span>
              </template>
              <p v-else class="debug-unone">用量未报告 · {{ record.status === 'running' ? '响应完成后由上游返回' : '上游未返回用量' }}</p>
            </div>
          </section>

          <section v-if="inspection.images.length" class="debug-sec" aria-label="实际发送的图片">
            <div class="debug-sh">
              <h3>图片</h3><span class="debug-sh-n">{{ inspection.images.length }} 张 · {{ kb(inspection.images.reduce((sum, image) => sum + image.bytes, 0)) }}</span>
              <span class="debug-gap"></span>
              <span class="debug-hint" data-end tabindex="0" role="img" aria-label="图片说明" aria-describedby="askDebugImageTip"><AppIcon name="i-info" /><span id="askDebugImageTip" class="debug-pop" role="tooltip">缩略图为实际发送的处理后图像，Base64 在预览中折叠，复制与导出保留完整数据。点击定位到所在分块。</span></span>
            </div>
            <div class="debug-card debug-ibox">
              <button v-for="(image, n) in inspection.images" :key="image.path" class="debug-thumb" type="button" :title="`${sizes[image.path] ? `${sizes[image.path]} · ` : ''}${kb(image.bytes)}\n${image.path}`" :aria-label="`图片 ${n + 1}，定位到分块 ${index(image.part)}`" @click="jump(image.part)">
                <img :src="image.url" alt="" @load="measure(image.path, $event)" />
                <span class="debug-thumb-cap"><span class="debug-role" :data-r="image.source">{{ roles[image.source] }}</span><span>#{{ index(image.part) }}</span></span>
              </button>
            </div>
          </section>

          <section class="debug-sec" aria-label="请求结构">
            <div class="debug-sh">
              <h3>请求结构</h3><span class="debug-sh-n">{{ inspection.parts.length }} 块 · {{ kb(tally.bytes) }}</span>
              <span class="debug-gap"></span>
              <span v-if="inspection.previous === null" class="debug-sh-r">无可比较的前次记录</span>
              <span v-else class="debug-legend">
                <span>与 #{{ inspection.previous }} 比较 · 前 {{ inspection.prefix }} 块相同</span>
                <span v-if="tally.changed"><i class="debug-sw" data-c="changed"></i>变化 {{ tally.changed }}</span>
                <span v-if="tally.fresh"><i class="debug-sw" data-c="new"></i>新增 {{ tally.fresh }}</span>
              </span>
              <span class="debug-hint" data-end tabindex="0" role="img" aria-label="结构说明" aria-describedby="askDebugStructureTip"><AppIcon name="i-info" /><span id="askDebugStructureTip" class="debug-pop" role="tooltip">按出站字节比例绘制，点击色块定位分块。与同连接、同模型的前次调用逐块比较，忽略 cache_control，只表示本地内容是否一致，不代表缓存命中。</span></span>
            </div>
            <div class="debug-card debug-sbox">
              <div class="debug-sbar" aria-hidden="true">
                <span v-for="s in structure" :key="s.key" class="debug-sbar-sec" :data-seg="s.key" :style="{ '--f': s.bytes }">
                  <i v-for="part in s.parts" :key="part.path" :data-c="part.comparison" :style="{ '--f': part.bytes }" :title="`${part.tool ?? part.name} · ${part.path} · ${kb(part.bytes)}`" @click="jump(part.path)"></i>
                </span>
              </div>
              <div class="debug-slabels"><span v-for="s in structure" :key="s.key"><i class="debug-sw" :data-seg="s.key"></i><b>{{ s.name }}</b> {{ kb(s.bytes) }}</span></div>
            </div>

            <div v-for="group in groups" :key="group.key" class="debug-grp">
              <component :is="group.key === 'current' ? 'div' : 'button'" class="debug-gt" :type="group.key === 'current' ? undefined : 'button'" :aria-expanded="group.key === 'current' ? undefined : group.open" @click="group.key !== 'current' && (expanded = { ...expanded, [group.key]: !group.open })">
                <b>{{ group.name }}</b><span class="debug-gt-n">{{ group.parts.length }} 块 · {{ kb(group.bytes) }}</span>
                <span v-if="group.images" class="debug-gt-img"><AppIcon name="i-image" />{{ group.images }}</span>
                <span class="debug-gap"></span>
                <template v-if="inspection.previous !== null && group.parts.length">
                  <span v-if="group.changed" class="debug-pill" data-s="changed">{{ group.changed }} 变化</span>
                  <span v-if="group.fresh" class="debug-pill" data-s="new">{{ group.fresh }} 新增</span>
                  <span v-if="!group.changed && !group.fresh" class="debug-gt-same">相同</span>
                </template>
                <AppIcon v-if="group.key !== 'current'" name="i-chevron" class="debug-chev" /><span v-else class="debug-chev-slot"></span>
              </component>
              <div v-if="group.open" class="debug-card debug-rows">
                <div v-if="group.key === 'prefix'" class="debug-part" :data-open="open.has('parameters') || undefined">
                  <button class="debug-row" type="button" data-part="parameters" :aria-expanded="open.has('parameters')" @click="toggle('parameters')">
                    <span class="debug-idx"></span><span class="debug-role" data-r="definition">定义</span><span class="debug-lab">请求参数</span><span class="debug-gist">{{ parameterKeys }}</span>
                    <span class="debug-marks"></span><span class="debug-cmp"></span><span class="debug-size">{{ kb(inspection.parameterBytes) }}</span><AppIcon name="i-chevron" class="debug-chev" />
                  </button>
                  <div v-if="open.has('parameters')" class="debug-body"><pre class="debug-code">{{ inspection.parameters }}</pre></div>
                </div>
                <div v-for="part in group.parts" :key="`${record.id}:${part.path}`" class="debug-part" :data-c="part.comparison" :data-open="open.has(part.path) || undefined">
                  <button class="debug-row" type="button" :data-part="part.path" :aria-expanded="open.has(part.path)" :title="part.path" @click="toggle(part.path)">
                    <span class="debug-idx">{{ index(part.path) }}</span>
                    <span class="debug-role" :data-r="part.role">{{ roles[part.role] }}</span>
                    <span class="debug-lab"><template v-if="part.tool"><AppIcon :name="toolIcons[part.tool.split(' · ')[0]!] ?? 'i-info'" /><code>{{ part.tool }}</code></template><template v-else>{{ part.name }}</template></span>
                    <span class="debug-gist">{{ part.gist }}</span>
                    <span class="debug-marks">
                      <span v-if="part.images" class="debug-mark" :title="`${part.images} 张图片`"><AppIcon name="i-image" />{{ part.images }}</span>
                      <span v-if="part.breakpoints.length" class="debug-mark" :title="part.breakpoints.join('\n')"><AppIcon name="i-pin" /></span>
                    </span>
                    <span class="debug-cmp">{{ part.comparison === 'changed' ? '变化' : part.comparison === 'new' ? '新增' : '' }}</span>
                    <span class="debug-size">{{ kb(part.bytes) }}</span>
                    <AppIcon name="i-chevron" class="debug-chev" />
                  </button>
                  <div v-if="open.has(part.path)" class="debug-body">
                    <p class="debug-bmeta"><code>{{ part.path }}</code><span v-if="part.wireRole">role: {{ part.wireRole }}</span><span v-for="mark in part.breakpoints" :key="mark"><AppIcon name="i-pin" class="debug-inline" /> {{ mark }}</span></p>
                    <div v-if="part.images" class="debug-imgs">
                      <figure v-for="(image, n) in imagesOf(part.path)" :key="image.path"><img :src="image.url" :alt="`发送的图片 ${n + 1}`" @load="measure(image.path, $event)" /><figcaption>图片 {{ n + 1 }}<template v-if="sizes[image.path]"> · {{ sizes[image.path] }}</template> · {{ kb(image.bytes) }}</figcaption></figure>
                    </div>
                    <pre class="debug-code">{{ part.text }}</pre>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </template>
        <p v-else class="debug-empty">发送 ASK 提问或使用 AI 命名后，可在这里查看实际调用。</p>
        <p class="debug-foot">记录仅在本页内存中保留，刷新清空，不进入备份；最多保留最近 20 次、约 16 MiB 文本，单次超出时完整保留最新一条。{{ ask.debug.value.dropped ? `已释放 ${ask.debug.value.dropped} 条较早记录。` : '' }}</p>
      </div>
    </dialog>
  </Teleport>
</template>
<style scoped>
/* Head stays on the dialog's raised surface; the body drops to chrome and
   holds raised cards, whose code wells return to chrome. Section titles sit
   outside the cards. */
.ask-debug { --modal-w: 720px; height: min(820px, calc(100dvh - 32px)); max-height: none; font: var(--fw-regular) var(--fz-sm)/1.6 var(--sans); }
/* The shared toast host teleports into this native dialog; reserve its space. */
.ask-debug :deep(.editor-toasts) { position: static; flex: none; width: auto; max-height: 35%; margin: 0 12px; overflow: auto; }
.debug-gap { flex: 1; }
.debug-top { position: relative; z-index: 1; display: flex; flex: none; align-items: center; gap: 2px; min-width: 0; padding: 10px 10px 10px 20px; box-shadow: 0 1px 0 var(--line-2); }
.debug-top h2 { flex: none; margin: 0; font-size: var(--fz-md); font-weight: var(--fw-semibold); white-space: nowrap; }
.debug-top-sep { flex: none; width: 1px; height: 16px; margin: 0 6px 0 12px; background: var(--line-2); }
.debug-top .ibtn:disabled { opacity: .35; cursor: default; }
.debug-top .ibtn[aria-expanded="true"] { color: var(--fg); background: var(--hover); }
.debug-pick { display: flex; flex: 0 1 auto; align-items: center; gap: 8px; min-width: 0; height: 32px; padding: 0 8px; color: var(--fg); border-radius: var(--r2); transition: background var(--t1) var(--e); }
.debug-pick:hover:not(:disabled), .debug-pick[aria-expanded="true"] { background: var(--hover); }
.debug-pick:disabled { color: var(--fg-3); cursor: default; }
.debug-pick-id { flex: none; color: var(--fg-3); font: var(--fz-2xs) var(--mono); }
.debug-pick-name { min-width: 0; overflow: hidden; font-weight: var(--fw-medium); text-overflow: ellipsis; white-space: nowrap; }
.debug-pick > .ico { --ico: var(--ico-sm); flex: none; color: var(--fg-3); }
.debug-down { transform: rotate(90deg); }
.debug-flip { transform: rotate(180deg); }
.debug-steps { display: flex; flex: none; }
.debug-steps .ibtn { --ico: var(--ico-sm); width: 28px; height: 28px; }
.ask-debug .debug-picker :deep(.ask-menu) { width: 360px; max-width: calc(100vw - 16px); }
.debug-mi-id { flex: none; width: 26px; color: var(--fg-3); font: var(--fz-2xs) var(--mono); }
.debug-st { display: inline-flex; flex: none; align-items: center; gap: 5px; margin-left: 4px; color: var(--fg-2); font: var(--fw-medium) var(--fz-2xs)/16px var(--sans); white-space: nowrap; }
.debug-st::before { width: 6px; height: 6px; content: ""; background: currentColor; border-radius: 50%; }
.debug-st[data-s="running"]::before { animation: debug-breathe 1.6s ease-in-out infinite; }
.debug-st[data-s="failed"] { color: var(--err); }
.debug-st[data-s="stopped"] { color: var(--fg-3); }
.debug-st[data-s="stopped"]::before { background: none; box-shadow: inset 0 0 0 1.5px currentColor; }
.debug-picker .menu-meta { padding-left: 8px; }
@keyframes debug-breathe { 50% { opacity: .3; } }

.debug-scroll { flex: 1; min-height: 0; padding: 16px 20px 20px; overflow: auto; overscroll-behavior: contain; background: var(--chrome); }
.debug-card { background: var(--raised); border-radius: var(--r3); box-shadow: var(--sh-lip); }
.debug-sec { margin-top: 20px; }
.debug-sh { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-height: 22px; margin: 0 2px 8px; }
.debug-sh h3 { margin: 0; color: var(--fg); font-size: var(--fz-sm); font-weight: var(--fw-semibold); white-space: nowrap; }
.debug-sh-n { color: var(--fg-3); font: var(--fz-xs) var(--mono); white-space: nowrap; }
.debug-sh-r { color: var(--fg-2); font-size: var(--fz-xs); white-space: nowrap; }
.debug-sh .debug-hint { margin-left: -4px; }
.debug-hint { position: relative; display: inline-grid; flex: none; place-items: center; width: 20px; height: 20px; color: var(--fg-3); border-radius: 6px; cursor: help; }
.debug-hint:is(:hover, :focus-visible) { color: var(--fg); background: var(--hover); outline: none; }
.debug-hint > .ico { --ico: var(--ico-sm); }
.debug-pop { position: absolute; top: calc(100% + 6px); left: -8px; z-index: 5; display: none; width: min(288px, calc(100vw - 48px)); padding: 8px 10px; color: var(--fg-2); font: var(--fw-regular) var(--fz-xs)/1.6 var(--sans); text-align: left; white-space: normal; background: var(--hover); border: 1px solid var(--line-2); border-radius: var(--r3); box-shadow: var(--sh-2); cursor: default; }
.debug-hint[data-end] .debug-pop { right: -8px; left: auto; }
.debug-hint:is(:hover, :focus-visible) .debug-pop { display: block; }
.debug-inline { --ico: var(--ico-xs); vertical-align: -1px; }

/* Status and comparison share one capsule; categories below use square tags. */
.debug-pill { --c: var(--fg-3); display: inline-flex; flex: none; align-items: center; gap: 5px; height: 20px; padding: 0 8px; color: var(--c); font: var(--fw-medium) var(--fz-2xs)/1 var(--sans); white-space: nowrap; background: color-mix(in srgb, var(--c) 14%, transparent); border-radius: 999px; }
.debug-pill::before { width: 6px; height: 6px; content: ""; background: currentColor; border-radius: 50%; }
.debug-pill[data-s="done"], .debug-pill[data-s="new"] { --c: var(--ok); }
.debug-pill[data-s="running"] { --c: var(--a); }
.debug-pill[data-s="running"]::before { animation: debug-breathe 1.6s ease-in-out infinite; }
.debug-pill[data-s="failed"] { --c: var(--err); }
.debug-pill[data-s="changed"] { --c: var(--warn); }
.debug-pill[data-s="new"]::before, .debug-pill[data-s="changed"]::before { display: none; }

/* Summary card: question, model and status on one line, facts beneath, usage after a hairline. */
.debug-id { padding: 16px 16px 15px; }
.debug-id-top { display: flex; align-items: center; gap: 16px; }
.debug-q { flex: 1; min-width: 0; margin: 0; overflow: hidden; color: var(--fg); font-size: var(--fz-md); font-weight: var(--fw-semibold); line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
.debug-model { display: flex; flex: none; align-items: center; gap: 8px; min-width: 0; }
.debug-model .ico { --ico: var(--ico-sm); flex: none; color: var(--fg-3); }
.debug-model b { min-width: 0; overflow: hidden; color: var(--fg); font-size: var(--fz-sm); font-weight: var(--fw-medium); text-overflow: ellipsis; white-space: nowrap; }
.debug-model span { flex: none; color: var(--fg-3); font: var(--fz-xs) var(--mono); }
.debug-facts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 28px; margin: 10px 0 0; }
.debug-facts > div { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.debug-facts dt { flex: none; color: var(--fg-3); font-size: var(--fz-xs); }
.debug-facts dd { min-width: 0; margin: 0; overflow: hidden; color: var(--fg-2); font: var(--fz-xs)/20px var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.debug-facts .debug-hint { align-self: center; margin-left: -4px; }
.debug-note { margin: 8px 0 0; color: var(--fg-3); font-size: var(--fz-xs); }
.debug-use { margin-top: 15px; padding-top: 15px; box-shadow: inset 0 1px 0 var(--line-2); }
.debug-meters { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px 16px; margin: 0; }
.debug-meters > div { min-width: 0; }
.debug-meters dt { display: flex; align-items: center; gap: 6px; color: var(--fg-3); font-size: var(--fz-xs); line-height: 16px; white-space: nowrap; }
.debug-meters dd { display: flex; align-items: baseline; gap: 6px; margin: 4px 0 0; color: var(--fg); font: var(--fw-regular) var(--fz-lg)/24px var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.debug-meters dd small { color: var(--a); font-size: var(--fz-xs); }
.debug-meters dd[data-unknown] { color: var(--fg-3); font: var(--fz-sm)/24px var(--sans); }
.debug-sw { flex: none; width: 7px; height: 7px; background: var(--c); border-radius: 2px; }
.debug-ubar { display: flex; height: 4px; margin-top: 14px; overflow: hidden; background: var(--line-2); border-radius: 2px; }
.debug-ubar i { flex: none; height: 100%; background: var(--c); }
.debug-sw[data-k="read"], .debug-ubar i[data-k="read"] { --c: var(--a); }
.debug-sw[data-k="write"], .debug-ubar i[data-k="write"] { --c: color-mix(in srgb, var(--a) 60%, transparent); }
.debug-sw[data-k="miss"], .debug-ubar i[data-k="miss"] { --c: color-mix(in srgb, var(--a) 30%, transparent); }
.debug-unone { margin: 0; color: var(--fg-2); font-size: var(--fz-sm); }

/* Images: every image the request sent, in order; a click locates its block. */
.debug-ibox { display: flex; flex-wrap: wrap; gap: 12px; padding: 12px; }
.debug-thumb { display: flex; flex-direction: column; gap: 6px; width: 64px; padding: 0; text-align: left; border-radius: var(--r2); }
.debug-thumb img { display: block; width: 64px; height: 64px; object-fit: cover; border-radius: var(--r2); box-shadow: 0 0 0 1px var(--line-2); transition: box-shadow var(--t1) var(--e); }
.debug-thumb:hover img { box-shadow: 0 0 0 1px var(--fg-3); }
.debug-thumb:focus-visible { outline: none; }
.debug-thumb:focus-visible img { box-shadow: 0 0 0 2px var(--a); }
.debug-thumb-cap { display: flex; align-items: center; gap: 6px; color: var(--fg-2); font: var(--fz-2xs) var(--mono); white-space: nowrap; }

/* Structure: segments by outbound bytes in the context popover's purple tiers
   (system 35%, tools 65%, messages 100%, history dimmed); changes override. */
.debug-sbox { padding: 14px 16px 12px; }
.debug-sbar { display: flex; gap: 4px; height: 14px; }
.debug-sbar-sec { display: flex; flex: var(--f) 1 0; gap: 2px; min-width: 6px; overflow: hidden; border-radius: 4px; }
.debug-sbar i { flex: var(--f) 1 0; min-width: 1px; background: var(--c); cursor: pointer; transition: filter var(--t1) var(--e); }
.debug-sbar i:hover { filter: brightness(1.25); }
.debug-sbar-sec[data-seg="tools"] i, .debug-sw[data-seg="tools"] { --c: color-mix(in srgb, var(--a) 65%, transparent); }
.debug-sbar-sec[data-seg="system"] i, .debug-sw[data-seg="system"] { --c: color-mix(in srgb, var(--a) 35%, transparent); }
.debug-sbar-sec[data-seg="history"] i, .debug-sw[data-seg="history"] { --c: color-mix(in srgb, var(--a) 20%, transparent); }
.debug-sbar-sec[data-seg="current"] i, .debug-sw[data-seg="current"] { --c: var(--a); }
.debug-sbar-sec i[data-c="changed"], .debug-sw[data-c="changed"] { --c: var(--warn); }
.debug-sbar-sec i[data-c="new"], .debug-sw[data-c="new"] { --c: var(--ok); }
.debug-slabels { display: flex; flex-wrap: wrap; gap: 4px 18px; margin-top: 10px; }
.debug-slabels > span { display: inline-flex; align-items: center; gap: 6px; color: var(--fg-2); font: var(--fz-xs)/18px var(--mono); white-space: nowrap; }
.debug-slabels b { color: var(--fg); font: var(--fw-medium) var(--fz-xs) var(--sans); }
.debug-legend { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; color: var(--fg-2); font-size: var(--fz-xs); line-height: 20px; }
.debug-legend > span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }

/* Groups: titles outside the card, rows inside split by hairlines. */
.debug-grp { margin-top: 14px; }
.debug-gt { display: flex; align-items: center; gap: 8px; width: 100%; height: 28px; margin: 0 0 6px; padding: 0 12px 0 2px; color: var(--fg-3); text-align: left; border-radius: var(--r2); }
button.debug-gt { width: calc(100% + 8px); margin-left: -8px; padding-left: 10px; }
button.debug-gt:hover { background: var(--ghost-hover); }
button.debug-gt[aria-expanded="false"] { margin-bottom: 0; }
.debug-gt b { color: var(--fg-2); font-size: var(--fz-xs); font-weight: var(--fw-medium); white-space: nowrap; }
.debug-gt-n { font: var(--fz-xs) var(--mono); white-space: nowrap; }
.debug-gt-img { display: inline-flex; align-items: center; gap: 3px; color: var(--fg-2); font: var(--fz-xs) var(--mono); }
.debug-gt-img .ico { --ico: var(--ico-sm); }
.debug-gt-same { color: var(--fg-3); font-size: var(--fz-xs); }
.debug-gt .debug-pill + .debug-pill { margin-left: -2px; }
.debug-chev { --ico: var(--ico-xs); flex: none; color: var(--fg-3); transition: transform var(--t1) var(--e); }
.debug-gt .debug-chev { margin-left: 2px; }
.debug-chev-slot { flex: none; width: 12px; margin-left: 2px; }
.debug-gt[aria-expanded="true"] .debug-chev, .debug-part[data-open] .debug-row .debug-chev { transform: rotate(90deg); }
.debug-rows { overflow: hidden; }
.debug-rows > .debug-part + .debug-part { box-shadow: inset 0 1px 0 var(--line-2); }
.debug-row { display: grid; grid-template-columns: 24px auto minmax(0, max-content) minmax(0, 1fr) auto auto 64px 12px; align-items: center; column-gap: 10px; width: 100%; height: 36px; padding: 0 12px; color: var(--fg); font-size: var(--fz-sm); text-align: left; transition: background var(--t1) var(--e); }
.debug-row:is(:hover, :focus-visible) { background: var(--hover); outline: none; }
.debug-idx { color: var(--fg-3); font: var(--fz-xs) var(--mono); text-align: right; }
.debug-lab { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; white-space: nowrap; }
.debug-lab .ico { --ico: var(--ico-sm); flex: none; color: var(--fg-3); }
.debug-lab code { min-width: 0; overflow: hidden; font: var(--fz-xs) var(--mono); text-overflow: ellipsis; }
.debug-gist { min-width: 0; overflow: hidden; color: var(--fg-3); font-size: var(--fz-xs); text-overflow: ellipsis; white-space: nowrap; }
.debug-marks { display: flex; gap: 8px; color: var(--fg-2); }
.debug-mark { display: inline-flex; align-items: center; gap: 3px; font: var(--fz-2xs) var(--mono); }
.debug-mark .ico { --ico: var(--ico-sm); }
.debug-cmp { display: flex; justify-content: flex-end; font-size: var(--fz-2xs); white-space: nowrap; }
.debug-cmp:not(:empty) { justify-self: end; height: 20px; padding: 0 8px; font-weight: var(--fw-medium); line-height: 20px; background: color-mix(in srgb, currentColor 14%, transparent); border-radius: 999px; }
.debug-part[data-c="changed"] .debug-cmp { color: var(--warn); }
.debug-part[data-c="new"] .debug-cmp { color: var(--ok); }
.debug-size { color: var(--fg-2); font: var(--fz-xs) var(--mono); text-align: right; white-space: nowrap; }

/* Role tags are square (capsules belong to status): user bright, model purple, tool outlined, system and definitions dim. */
.debug-role { --c: var(--fg-3); display: inline-flex; flex: none; align-items: center; justify-content: center; min-width: 34px; height: 18px; padding: 0 6px; color: var(--c); font: var(--fw-medium) var(--fz-2xs)/1 var(--sans); white-space: nowrap; background: color-mix(in srgb, var(--c) 12%, transparent); border-radius: var(--r1); }
.debug-role[data-r="user"] { --c: var(--fg); }
.debug-role[data-r="model"] { --c: var(--a); }
.debug-role[data-r="tool"] { --c: var(--fg-2); background: none; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg-2) 40%, transparent); }

.debug-body { padding: 0 12px 12px 46px; }
.debug-bmeta { display: flex; flex-wrap: wrap; gap: 2px 14px; margin: 0 0 8px; color: var(--fg-3); font: var(--fz-2xs)/18px var(--mono); }
.debug-bmeta > * { min-width: 0; overflow-wrap: anywhere; }
.debug-bmeta code { color: var(--fg-2); }
.debug-imgs { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
.debug-imgs figure { margin: 0; }
.debug-imgs img { display: block; width: 120px; height: 90px; object-fit: cover; border-radius: var(--r2); box-shadow: 0 0 0 1px var(--line-2); }
.debug-imgs figcaption { margin-top: 4px; color: var(--fg-3); font: var(--fz-2xs)/1.5 var(--mono); }
.debug-code { max-height: 360px; margin: 0; padding: 10px 12px; overflow: auto; color: var(--fg-2); font: var(--fw-regular) var(--fz-xs)/1.65 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; background: var(--well); border-radius: var(--r2); user-select: text; }
.debug-empty { margin: 0; padding: 32px 0; color: var(--fg-3); }
.debug-foot { margin: 20px 0 0; color: var(--fg-3); font-size: var(--fz-xs); line-height: 1.5; }

/* Phones: a bottom sheet with type one step up, 44px rows and two-column facts. */
@media (max-width: 640px) {
  .ask-debug { height: 90dvh; }
  .debug-top { padding: 8px 6px 8px 16px; }
  .debug-top-sep { margin: 0 2px 0 8px; }
  .debug-scroll { padding: 14px 12px 16px; }
  .debug-sh h3 { font-size: var(--fz-md); }
  .debug-id-top { flex-wrap: wrap; row-gap: 6px; }
  .debug-q { flex: 1 1 0; }
  .debug-model { flex-basis: 100%; order: 3; }
  .debug-model b { font-size: 14px; }
  .debug-facts { gap: 6px 20px; }
  .debug-facts dt, .debug-facts dd { font-size: var(--fz-sm); }
  .debug-meters { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .debug-row { grid-template-columns: 22px auto minmax(0, max-content) minmax(0, 1fr) auto auto 60px 14px; column-gap: 8px; height: 44px; font-size: 14px; }
  .debug-gist { font-size: var(--fz-sm); }
  .debug-pill, .debug-cmp:not(:empty) { font-size: var(--fz-xs); }
  .debug-gt { height: 32px; }
  .debug-gt b { font-size: var(--fz-sm); }
  .debug-body { padding-left: 12px; }
}
@media (max-width: 480px) {
  .debug-steps { display: none; }
}
@media (max-width: 360px) {
  .debug-top { padding-left: 14px; }
  .debug-top-sep { margin: 0 2px 0 6px; }
  .debug-facts { column-gap: 12px; }
  .debug-facts > div { gap: 6px; }
  .debug-facts dd { font-size: var(--fz-xs); }
  .debug-meters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .debug-row { grid-template-columns: 20px auto minmax(0, 1fr) auto auto 56px 14px; }
  .debug-gist { display: none; }
  .debug-size { font-size: var(--fz-2xs); }
  .debug-gt-n { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .debug-gt-img { display: none; }
}
@media (prefers-reduced-motion: reduce) { .debug-pill[data-s="running"]::before, .debug-st[data-s="running"]::before { animation: none; } }
</style>
