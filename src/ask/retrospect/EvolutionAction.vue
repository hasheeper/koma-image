<script setup lang="ts">
import { computed, shallowRef, useId } from 'vue';
import { useAsk } from '../../app/ask.ts';
import { useUi, message } from '../../app/ui.ts';
import AppIcon from '../../shared/AppIcon.vue';
import PopoverMenu from '../../shared/ui/PopoverMenu.vue';
const props = defineProps<{ recordId: string; target?: string; disabled?: boolean }>();
const ask = useAsk(), ui = useUi(), id = useId(), busy = shallowRef(false);
const promotion = computed(() => props.target ? undefined : ask.promoteTarget(props.recordId));
const choices = computed(() => (props.target ? ask.workshopChoices(props.target, props.recordId) : []).map(choice => ({
  ...choice,
  recorded: choice.record.value.nodes.find(node => node.image_ids.some(tag => choice.record.pictureRefs[tag]?.record_id === props.recordId)),
})));
const recorded = computed(() => choices.value.length > 0 && choices.value.every(choice => choice.recorded));
const entryLabel = computed(() => recorded.value ? choices.value.length === 1 ? `已记入 ${choices.value[0].recorded!.id}` : '已记入演进' : '记入演进');
async function act(run: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  try { await run(); } catch (error) { ui.toast(message(error), 'err'); } finally { busy.value = false; }
}
</script>
<template>
  <button v-if="promotion" class="ibtn" type="button" aria-label="立为阶段" data-tip="立为阶段 · 仅提拔此图" :disabled="disabled || busy || !ask.canManage.value" @click="act(() => ask.promoteEvolution(promotion!, recordId))"><AppIcon name="i-branch" /></button>
  <PopoverMenu v-else-if="choices.length" :id="id" label="记入演进" side="up" compact>
    <template #trigger="{ open, toggle }"><button class="ibtn" type="button" :aria-label="entryLabel" :data-tip="entryLabel" aria-haspopup="menu" :aria-expanded="open" :aria-controls="id" :disabled="disabled || busy || !ask.canManage.value" @click="toggle"><AppIcon :name="recorded ? 'i-check' : 'i-branch'" /></button></template>
    <template #default="{ close }">
      <template v-for="{ record, ticket, recorded: stage } in choices" :key="ticket.id">
        <span v-if="choices.length > 1" class="menu-label">{{ record.value.title }} · {{ Object.keys(record.pictureRefs).find(tag => record.pictureRefs[tag].record_id === ticket.sourceRecordId) }} · {{ ticket.name }}</span>
        <template v-if="stage">
          <span class="menu-label">这张图已记入 {{ stage.id }}</span>
          <button class="menu-item" type="button" role="menuitem" @click="close(); act(() => ask.deliverEvolution(record.id, ticket.id, recordId, 'append'))"><AppIcon name="i-branch" />查看 {{ stage.id }}</button>
        </template>
        <template v-else>
        <button class="menu-item" type="button" role="menuitem" @click="close(); act(() => ask.deliverEvolution(record.id, ticket.id, recordId, 'append'))"><AppIcon name="i-check" />{{ ticket.nodeId ? `追加到本阶段 ${ticket.nodeId}` : '阶段成品' }}</button>
        <button v-if="ticket.nodeId" class="menu-item" type="button" role="menuitem" @click="close(); act(() => ask.deliverEvolution(record.id, ticket.id, recordId, 'next'))"><AppIcon name="i-branch" />作为下一步</button>
        <button class="menu-item" type="button" role="menuitem" @click="close(); act(() => ask.deliverEvolution(record.id, ticket.id, recordId, 'append', 'rejected'))"><AppIcon name="i-close" />{{ ticket.nodeId ? '追加方向否定样本' : '方向否定' }}</button>
        <button v-if="ticket.nodeId" class="menu-item" type="button" role="menuitem" @click="close(); act(() => ask.deliverEvolution(record.id, ticket.id, recordId, 'next', 'rejected'))"><AppIcon name="i-branch" />下一步 · 方向否定</button>
        </template>
        <div class="delivery-separator" role="separator"></div>
        <button class="menu-item" type="button" role="menuitem" @click="close(); act(() => ask.deliverEvolution(record.id, ticket.id, recordId, 'append', 'final'))"><AppIcon name="i-star" />设为最终定稿</button>
        <button class="menu-item" type="button" role="menuitem" @click="close(); act(() => ask.cancelWorkshop(record.id, ticket.id))"><AppIcon name="i-close" />取消挂靠</button>
      </template>
    </template>
  </PopoverMenu>
</template>

<style scoped>
.delivery-separator { height: 1px; margin: var(--sp-1) var(--sp-2); background: var(--line-2); }
</style>
