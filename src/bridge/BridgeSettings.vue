<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { useBridge } from "../app/bridge.ts";
import AppIcon from "../shared/AppIcon.vue";
const bridge = useBridge(), input = shallowRef<HTMLInputElement | null>(null);
const status = computed(() => ({ off: bridge.supported ? '未挂载' : '此浏览器不支持目录挂载', permission: '需要授权', occupied: '其他页面正在使用', active: bridge.directory.value, error: '连接已暂停' })[bridge.phase.value]);
async function imported(event: Event) { const target = event.target as HTMLInputElement, file = target.files?.[0]; target.value = ''; if (file) await bridge.importFile(file); }
</script>
<template>
  <section class="sp-sec" aria-label="外部协同">
    <div class="sp-sec-head"><h3>外部协同</h3></div>
    <div class="sp-group">
      <div class="s-row"><div class="bridge-directory-label"><b>协同目录</b><span :title="bridge.directory.value">{{ status }}</span></div><div class="s-ctl"><button v-if="bridge.directory.value && bridge.phase.value !== 'active'" class="btn btn-quiet btn-sm" type="button" :disabled="bridge.busy.value" @click="bridge.resume()">恢复连接</button><button v-if="bridge.supported" class="btn btn-quiet btn-sm" type="button" :disabled="bridge.busy.value" @click="bridge.mount()">{{ bridge.directory.value ? '切换' : '挂载' }}</button><button v-if="bridge.directory.value" class="btn btn-quiet btn-sm" type="button" :disabled="bridge.busy.value" @click="bridge.unmount()">卸载</button></div></div>
      <div class="s-row"><div><b>导入草稿 JSON</b></div><button class="ibtn" type="button" aria-label="导入草稿 JSON" :disabled="bridge.busy.value" @click="input?.click()"><AppIcon name="i-upload" /></button></div>
      <div class="s-row"><div><b>导出工作台状态</b></div><button class="ibtn" type="button" aria-label="导出工作台状态" :disabled="bridge.busy.value" @click="bridge.exportState()"><AppIcon name="i-download" /></button></div>
      <div class="s-row"><div><b>导出协同协议</b></div><button class="ibtn" type="button" aria-label="导出协同协议" @click="bridge.exportProtocol()"><AppIcon name="i-download" /></button></div>
    </div>
    <input ref="input" hidden type="file" accept=".json,application/json" aria-label="导入外部草稿" @change="imported" />
    <p v-if="bridge.error.value" class="bridge-error" role="status">{{ bridge.error.value }}</p>
  </section>
</template>
<style scoped>
.bridge-directory-label { min-width: 0; }
.bridge-directory-label > span { display: block; margin-top: 4px; overflow: hidden; color: var(--fg-3); font-size: var(--fz-xs); text-overflow: ellipsis; white-space: nowrap; }
.bridge-error { margin-top: 8px; color: var(--warn); font-size: var(--fz-xs); overflow-wrap: anywhere; }
</style>
