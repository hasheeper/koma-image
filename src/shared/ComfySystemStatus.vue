<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, shallowRef, useId, watch } from "vue";
import { useServices } from "../app/services";
import { createComfyMonitor } from "../services/comfy-monitor.ts";
import type { ComfyMonitorState } from "../services/comfy-monitor.ts";
import { memoryGiB, memoryLabel, memoryPercent } from "../domain/comfy-system.ts";
import { placeMenu } from "./popover";
import AppIcon from "./AppIcon.vue";
const props = defineProps<{ connection: string; active: boolean }>();
const { connections } = useServices();
const state = shallowRef<ComfyMonitorState>({ source: "ComfyUI", loading: false, error: "", updatedAt: 0 });
const monitor = createComfyMonitor(connections, () => { state.value = monitor.snapshot(); });
const visible = ref(document.visibilityState === "visible"), activated = ref(true);
const button = shallowRef<HTMLButtonElement>(), panel = shallowRef<HTMLElement>();
const panelId = `comfy-system-${useId()}`, expanded = ref(false);
const devices = computed(() => state.value.data?.devices.filter(d => d.type !== "cpu") ?? []);
const gpu = computed(() => devices.value[0]);
const status = computed(() => state.value.error ? state.value.data ? "更新失败" : "连接失败" : state.value.data ? "已连接" : state.value.loading ? "连接中…" : "等待连接");
const statusTitle = computed(() => state.value.error || `${state.value.source} · ${gpu.value?.name || "ComfyUI"}`);
const updated = computed(() => state.value.updatedAt ? new Date(state.value.updatedAt).toLocaleTimeString("zh-CN") : "");
function close() { panel.value?.hidePopover(); }
function cleanPopover() { window.removeEventListener("resize", close); window.removeEventListener("scroll", outsideScroll, true); }
function outsideScroll(event: Event) { if (!panel.value?.contains(event.target as Node)) close(); }
function beforeToggle(event: ToggleEvent) {
  expanded.value = event.newState === "open";
  if (!expanded.value || !panel.value || !button.value) return;
  panel.value.style.display = "block";
  placeMenu(panel.value, button.value.getBoundingClientRect());
  panel.value.style.removeProperty("display");
}
function toggle() {
  cleanPopover();
  if (!panel.value?.matches(":popover-open")) return;
  window.addEventListener("resize", close); window.addEventListener("scroll", outsideScroll, true);
}
function keydown(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); button.value?.focus(); }
}
const visibility = () => { visible.value = document.visibilityState === "visible"; };
document.addEventListener("visibilitychange", visibility);
watch(() => props.connection, value => { close(); monitor.setSource(value); }, { immediate: true });
watch(() => props.active && activated.value && visible.value, value => {
  monitor.setActive(value); if (!value) close();
}, { immediate: true });
onActivated(() => { activated.value = true; });
onDeactivated(() => { activated.value = false; monitor.setActive(false); close(); cleanPopover(); });
onBeforeUnmount(() => { monitor.dispose(); cleanPopover(); document.removeEventListener("visibilitychange", visibility); });
</script>
<template>
  <div id="comfySystemStatus" class="wallet comfy-system" :data-connection="connection" :data-stale="!!state.error">
    <button ref="button" class="comfy-system-trigger" type="button" :popovertarget="panelId" :aria-expanded="expanded" :aria-controls="panelId" aria-haspopup="dialog" :aria-label="`${state.source} · GPU 运行状态`" :title="statusTitle">
      <span class="w-seg"><span class="w-k">{{ gpu?.type === 'cuda' ? '显存' : '设备内存' }}</span><span class="w-v"><b>{{ memoryPercent(gpu?.memory) }}</b></span></span>
      <span class="w-sep" aria-hidden="true"></span>
      <span class="w-seg"><span class="w-k">内存</span><span class="w-v"><b>{{ memoryPercent(state.data?.memory) }}</b></span></span>
      <AppIcon v-if="state.loading && !state.data" class="comfy-status-spin" name="i-retry" />
      <AppIcon v-else :name="state.error ? 'i-info' : 'i-chevron'" class="comfy-status-icon" />
    </button>
    <div :id="panelId" ref="panel" class="menu comfy-system-panel" popover="auto" role="dialog" aria-label="ComfyUI 运行状态" @beforetoggle="beforeToggle" @toggle="toggle" @keydown="keydown">
      <div class="comfy-status-head"><strong>{{ state.source }}</strong><span class="comfy-status-label" :class="{ 'comfy-status-error': state.error }" role="status">{{ status }}</span></div>
      <p v-if="state.error" class="comfy-status-error">{{ state.error }}{{ state.data ? '；以下为上次读数' : '' }}</p>
      <dl>
        <dt>内存 · 已用／总量</dt><dd>{{ memoryLabel(state.data?.memory) }}</dd>
        <dt>CPU 利用率</dt><dd class="comfy-unavailable">原生接口未提供</dd>
      </dl>
      <section v-for="d in devices" :key="`${d.type}:${d.index}`" class="comfy-device" :aria-label="d.name">
        <p>{{ d.name }}</p>
        <dl>
          <dt>{{ d.type === 'cuda' ? '显存' : '设备内存' }} · 已用／总量</dt><dd>{{ memoryLabel(d.memory) }}</dd>
          <dt>可用</dt><dd>{{ d.memory ? `${memoryGiB(d.memory.free)} GiB` : '未提供' }}</dd>
          <dt>GPU 利用率</dt><dd class="comfy-unavailable">原生接口未提供</dd>
        </dl>
      </section>
      <p v-if="state.data && !devices.length" class="comfy-unavailable">未报告 GPU 设备</p>
      <p class="hint">内存为服务端整机读数；显存占比不代表 GPU 计算利用率。</p>
      <div class="comfy-status-foot"><span>{{ updated ? `更新于 ${updated}` : '尚无读数' }}{{ state.data?.version ? ` · v${state.data.version}` : '' }}</span><button class="ibtn" type="button" aria-label="刷新运行状态" :disabled="state.loading" @click="monitor.refresh"><AppIcon name="i-retry" :class="{ 'comfy-status-spin': state.loading }" /></button></div>
    </div>
  </div>
</template>
<style scoped>
.comfy-system-trigger { display: flex; align-items: center; border-radius: var(--r2); }
.comfy-system-trigger:hover { background: var(--ghost-hover); }
.comfy-system-trigger:focus-visible { outline: 1px solid var(--a); outline-offset: 2px; }
.comfy-system-trigger .w-k { color: var(--fg-3); font-size: var(--fz-xs); }
.comfy-status-icon, .comfy-status-spin { flex: none; --ico: var(--ico-xs); margin-right: var(--sp-2); color: var(--fg-3); }
.comfy-system[data-stale="true"] .w-v b { color: var(--fg-4); }
.comfy-system-panel { width: min(360px, calc(100vw - 16px)); max-height: min(500px, calc(100dvh - 16px)); overflow-y: auto; padding: var(--sp-4); font-size: var(--fz-sm); }
.comfy-status-head, .comfy-status-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); }
.comfy-status-head strong { overflow-wrap: anywhere; font-weight: var(--fw-semibold); }
.comfy-status-label { flex: none; color: var(--fg-3); font-size: var(--fz-xs); }
.comfy-system-panel dl { display: grid; grid-template-columns: 1fr auto; gap: var(--sp-2); margin-block: var(--sp-3); }
.comfy-system-panel dt, .comfy-unavailable { color: var(--fg-3); }
.comfy-system-panel dd { margin: 0; font-variant-numeric: tabular-nums; text-align: right; }
.comfy-device { border-top: 1px solid var(--line); padding-top: var(--sp-3); }
.comfy-device p { overflow-wrap: anywhere; font-size: var(--fz-xs); }
.comfy-status-error { color: var(--warn); }
.comfy-status-foot { margin-top: var(--sp-3); font-size: var(--fz-2xs); color: var(--fg-4); }
.comfy-status-foot .ico { margin: 0; }
.comfy-status-spin { animation: comfy-status-spin 1s linear infinite; }
@keyframes comfy-status-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .comfy-status-spin { animation: none; } }
</style>
