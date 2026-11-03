<script setup lang="ts">
import { onBeforeUnmount, useTemplateRef } from "vue";
import type { Connection } from "../../config/connections";
import AppIcon from "../../shared/AppIcon.vue";
import ConnectionAvatar from "../../shared/ConnectionAvatar.vue";

defineProps<{ connections: Connection[]; busy: boolean }>();
const emit = defineEmits<{ move: [id: string, delta: number] }>();
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
function open() { if (!dialog.value?.open) dialog.value?.showModal(); }
function close() { dialog.value?.close(); }
onBeforeUnmount(close);
defineExpose({ open, close });
</script>

<template>
  <dialog ref="dialog" class="modal set-ui connection-order-dialog" aria-labelledby="connectionOrderTitle" aria-describedby="connectionOrderHint" @cancel.prevent="close">
    <header class="modal-head">
      <h2 id="connectionOrderTitle">生图顺序</h2>
      <button class="ibtn" type="button" aria-label="关闭生图顺序" @click="close"><AppIcon name="i-close" /></button>
    </header>
    <div class="modal-body">
      <p id="connectionOrderHint" class="order-hint">越靠前越优先。ASK 使用单独选定的连接与模型。</p>
      <ol class="order-list" aria-label="生图连接顺序" :aria-busy="busy">
        <li v-for="(c, index) in connections" :key="c.id" class="order-row" :data-connection="c.id">
          <span class="order-number" :aria-label="`第 ${index + 1} 位`">{{ index + 1 }}</span>
          <ConnectionAvatar :connection="c" />
          <div class="order-name"><b>{{ c.name }}</b><span :title="c.baseUrl">{{ c.baseUrl.replace(/^https:\/\//, '') }}</span></div>
          <div class="order-actions">
            <button class="ibtn" type="button" :aria-label="`提高 ${c.name} 的优先级`" title="提高优先级" :disabled="busy || index === 0" @click="emit('move', c.id, -1)"><AppIcon name="i-up" /></button>
            <button class="ibtn" type="button" :aria-label="`降低 ${c.name} 的优先级`" title="降低优先级" :disabled="busy || index === connections.length - 1" @click="emit('move', c.id, 1)"><AppIcon name="i-down" /></button>
          </div>
        </li>
      </ol>
      <p v-if="!connections.length" class="order-hint">尚未开启图像用途。</p>
    </div>
  </dialog>
</template>

<style scoped>
.order-hint { margin: 0 0 12px; color: var(--fg-3); font-size: var(--fz-xs); line-height: 1.6; }
.order-list { margin: 0; padding: 0; list-style: none; }
.order-row { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 12px 0; }
.order-row + .order-row { border-top: 1px solid var(--line); }
.order-number { min-width: 16px; flex: none; color: var(--fg-3); font: var(--fz-xs) var(--mono); text-align: center; }
.order-name { flex: 1; min-width: 0; display: grid; gap: 4px; }
.order-name b { font-size: var(--fz-sm); font-weight: var(--fw-medium); }
.order-name span { color: var(--fg-3); font-size: var(--fz-xs); }
.order-name :is(b, span) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.order-actions { display: flex; flex: none; gap: 2px; }
.order-actions .ibtn { color: var(--fg-3); }
.order-actions .ico { --ico: var(--ico-sm); }
</style>
