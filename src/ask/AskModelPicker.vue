<script setup lang="ts">
import { computed, useId } from 'vue';
import { useAsk } from '../app/ask.ts';
import { useUi, message } from '../app/ui.ts';
import AppIcon from '../shared/AppIcon.vue';
import ModelIcon from '../shared/ModelIcon.vue';
import AskMenu from './AskMenu.vue';
import { familyOf } from './model-family.ts';
const props = defineProps<{ id?: string }>();
const ask = useAsk(), ui = useUi(), generatedId = useId();
const menuId = computed(() => props.id ?? generatedId);
const switchable = computed(() => ask.picks.value.length > 0);
const modelTitle = computed(() => `${ask.estimate.value && !ask.running.value ? `本轮输入约 ${ask.estimate.value} tokens · ` : ''}点击切换模型`);
async function useModel(connectionId: string, id: string, close: (refocus?: boolean) => void) {
  close(true);
  try { await ask.useModel(connectionId, id); } catch (error) { ui.toast(message(error), 'err'); }
}
</script>
<template>
          <AskMenu :id="menuId" label="切换模型" side="up">
            <template #trigger="{ open, toggle }">
              <button
                class="ask-model"
                type="button"
                :title="modelTitle"
                :aria-label="`ASK 模型：${ask.settings.value.model || '未选择'}`"
                :aria-haspopup="switchable ? 'menu' : undefined"
                :aria-expanded="switchable ? open : undefined"
                :aria-controls="switchable ? menuId : undefined"
                @click="switchable ? toggle() : ask.openSettings()"
              >
                <span class="ask-model-name">{{ ask.settings.value.model || "选择模型" }}</span>
                <AppIcon name="i-chevron" class="ask-model-chev" />
              </button>
            </template>
            <template #default="{ close }">
              <template v-for="c in ask.picks.value" :key="c.id">
                <div v-if="ask.picks.value.length > 1" class="menu-group ask-menu-group" role="presentation">{{ c.name }}</div>
                <button
                  v-for="id in c.ids"
                  :key="id"
                  class="menu-item"
                  type="button"
                  role="menuitemradio"
                  :aria-checked="ask.settings.value.connectionId === c.id && ask.settings.value.model === id"
                  :disabled="ask.running.value"
                  :title="id"
                  @click="useModel(c.id, id, close)"
                ><ModelIcon :family="familyOf(id)" /><span class="menu-label">{{ id }}</span><AppIcon name="i-check" class="menu-check ask-menu-check" /></button>
              </template>
              <hr role="separator" />
              <button class="menu-item" type="button" role="menuitem" @click="close(); ask.openSettings()"><AppIcon name="i-settings" /><span class="menu-label">管理模型</span></button>
            </template>
          </AskMenu>
</template>
<style scoped>
.ask-model { display: inline-flex; align-items: center; gap: 2px; min-width: 0; height: 28px; padding: 0 0 0 8px; color: var(--fg-3); font: var(--fw-regular) 12px/1 var(--sans); border-radius: 8px; transition: color var(--t1) var(--e), background var(--t1) var(--e); }
.ask-model:hover { color: var(--fg); background: var(--ask-hover, var(--hover)); }
.ask-model-name { min-width: 0; overflow: hidden; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.ask-model-chev { flex: none; --ico: var(--ico-xs); color: var(--fg-4); transform: rotate(90deg); }
@media (max-width: 860px) { .ask-model { height: 36px; } }
</style>
