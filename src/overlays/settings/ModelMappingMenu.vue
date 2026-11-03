<script setup lang="ts">
import { useId, useTemplateRef, watch } from "vue";
import type { ModelIdentity } from "../../domain/models";
import AppIcon from "../../shared/AppIcon.vue";
import ModelIcon from "../../shared/ModelIcon.vue";
import PopoverMenu from "../../shared/ui/PopoverMenu.vue";

const props = defineProps<{ active: boolean; label: string; models: ModelIdentity[] }>();
const emit = defineEmits<{ select: [id: string] }>();
const menu = useTemplateRef<InstanceType<typeof PopoverMenu>>("menu");
const id = `model-mapping-${useId()}`;
watch(() => props.active, active => { if (!active) menu.value?.close(); });
</script>

<template>
  <PopoverMenu ref="menu" :id="id" :label="label" side="right" close-on-scroll="outside" class="model-mapping" menu-class="model-mapping-menu">
    <template #trigger="{ open, toggle }">
      <button class="model-map-trigger" type="button" :aria-label="label" aria-haspopup="menu" :aria-controls="id" :aria-expanded="open" @click="toggle">
        关联模型<AppIcon name="i-chevron" />
      </button>
    </template>
    <template #default="{ close }">
      <button v-for="model in models" :key="model.id" class="menu-item model-map-option" type="button" role="menuitem" :aria-label="model.name" @click="close(true); emit('select', model.id)">
        <ModelIcon :family="model.family" />
        <span class="model-map-copy"><span>{{ model.name }}</span><code>{{ model.templateId ?? model.id }}</code></span>
      </button>
    </template>
  </PopoverMenu>
</template>

<style scoped>
.model-mapping { flex: none; }
.model-map-trigger { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 4px 8px; color: var(--fg-3); font-size: var(--fz-xs); white-space: nowrap; border-radius: var(--r1); }
.model-map-trigger:is(:hover, [aria-expanded="true"]) { color: var(--fg); background: var(--hover); }
.model-map-trigger .ico { --ico: var(--ico-xs); transform: rotate(90deg); }
.model-mapping :deep(.model-mapping-menu) { width: 320px; max-width: calc(100vw - 16px); }
.model-map-option { align-items: start; padding-block: 8px; white-space: normal; }
.model-map-option > .vl { margin-top: 2px; }
.model-map-copy { display: grid; flex: 1; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.model-map-copy code { font: var(--fz-2xs)/1.5 var(--mono); color: var(--fg-3); }
@media (pointer: coarse), (max-width: 640px) { .model-map-trigger { min-height: 44px; } }
</style>
