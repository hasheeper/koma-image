<script setup lang="ts">
import AppIcon from '../../shared/AppIcon.vue';
defineProps<{ ticket: { id: string; name: string; target: string; available: boolean; ended: boolean }; disabled: boolean }>();
defineEmits<{ open: []; cancel: [] }>();
</script>
<template>
  <article class="workshop-node" :data-node="ticket.id" data-kind="workshop" :aria-label="`${ticket.name} 待交付工坊`">
    <div class="node-image workshop-ticket" :title="ticket.name">
      <span class="ticket-ring" aria-hidden="true"></span><strong>{{ ticket.target.startsWith('edit:') ? 'EDIT' : 'CHAT' }}</strong><span>{{ !ticket.available ? '目标已失效' : ticket.ended ? '已停止' : '待交付' }}</span>
      <div class="ticket-actions" data-node-control @pointerdown.stop>
        <button class="ibtn" type="button" :disabled="!ticket.available" aria-label="打开工坊" data-tip="打开工坊" @click.stop="$emit('open')"><AppIcon name="i-expand" /></button>
        <button class="ibtn" type="button" :disabled="disabled" aria-label="取消挂靠" data-tip="取消挂靠" @click.stop="$emit('cancel')"><AppIcon name="i-close" /></button>
      </div>
    </div>
  </article>
</template>
<style scoped>
.workshop-node { position: absolute; transition: none; }
.workshop-ticket { position: absolute; top: calc(var(--node-meta-room) + 22px); left: 0; display: flex; align-items: center; gap: var(--sp-2); width: max-content; height: 36px; padding: 0 var(--sp-1) 0 var(--sp-3); border: 1px solid var(--line-2); border-radius: var(--r3); background: var(--chrome); color: var(--fg-3); font-size: var(--fz-xs); white-space: nowrap; transform: translateY(-50%) scale(var(--node-ui-scale, 1)); transform-origin: left center; cursor: grab; user-select: none; }
.workshop-ticket strong { color: var(--fg-2); font-weight: var(--fw-medium); }
.ticket-ring { width: 7px; height: 7px; border: 1px solid currentcolor; border-radius: 50%; }
.ticket-actions { display: flex; align-items: center; gap: 2px; padding-left: var(--sp-2); margin-left: var(--sp-1); border-left: 1px solid var(--line-2); }
.ticket-actions .ibtn { width: 26px; height: 26px; --ico: var(--ico-sm); }
.node-drag-active .workshop-ticket { cursor: grabbing; box-shadow: var(--sh-1); }
</style>
