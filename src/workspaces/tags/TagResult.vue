<script setup lang="ts">
import { computed, shallowRef, useId } from "vue";
import { CATEGORIES, formatCount, promptTag, tagUrl } from "../../domain/tags.ts";
import type { TagItem } from "../../domain/tags.ts";
import AppIcon from "../../shared/AppIcon.vue";
import PopoverMenu from "../../shared/ui/PopoverMenu.vue";

const props = withDefaults(defineProps<{
  item: TagItem;
  selected: boolean;
  variant?: "card" | "chip";
}>(), { variant: "card" });
const emit = defineEmits<{
  toggle: [item: TagItem];
  copy: [item: TagItem];
  samples: [item: TagItem, card: HTMLElement];
}>();
const root = shallowRef<HTMLElement | null>(null), menuId = `tag-menu-${useId()}`;
const name = computed(() => promptTag(props.item.name));
const category = computed(() => CATEGORIES[props.item.category] || CATEGORIES[0]);
const hasSamples = computed(() => props.item.category === 1 || props.item.category === 4);
function showSamples(close: (refocus?: boolean) => void) {
  close(true);
  if (root.value) emit("samples", props.item, root.value);
}
</script>

<template>
  <article ref="root" class="tag-card" :class="`tag-card-${variant}`">
    <button
      class="tag-card-info tag-add"
      type="button"
      :data-tag="item.name"
      :aria-pressed="selected"
      :aria-label="`${selected ? '移出' : '加入'} Prompt 组合：${name}`"
      @click="emit('toggle', item)"
    >
      <span class="tag-card-names">
        <strong>{{ name }}</strong>
        <span v-if="item.cnName || variant !== 'chip'">{{ item.cnName || (variant === 'card' ? '暂无中文翻译' : '') }}</span>
      </span>
      <span v-if="variant === 'card'" class="tag-card-meta">
        <i class="tag-category-dot" :class="category.className"></i>
        <span>{{ category.label }}{{ item.count ? ` · ${formatCount(item.count)}` : '' }}</span>
      </span>
    </button>
    <PopoverMenu :id="menuId" :label="`${name} 的操作`" side="right" class="tag-card-actions">
      <template #trigger="{ open, toggle }">
        <button class="ibtn ibtn-xs tag-more" type="button" :aria-label="`${name} 的更多操作`" data-tip="更多" aria-haspopup="menu" :aria-expanded="open" :aria-controls="menuId" @click="toggle">
          <AppIcon name="i-more" />
        </button>
      </template>
      <template #default="{ close }">
        <button class="menu-item" type="button" role="menuitem" :aria-label="`复制 ${name}`" @click="emit('copy', item); close(true)">
          <AppIcon name="tag-i-copy" /><span class="menu-label">复制 Tag</span>
        </button>
        <button v-if="hasSamples" class="menu-item" type="button" role="menuitem" :aria-label="`查看 ${name} 的示例图`" @click="showSamples(close)">
          <AppIcon name="i-image" /><span class="menu-label">示例图</span>
        </button>
        <a class="menu-item" role="menuitem" :href="tagUrl(item.name)" target="_blank" rel="noopener noreferrer" :aria-label="`在 Danbooru 打开 ${name}（新标签页）`" @click="close(true)">
          <AppIcon name="tag-i-external" /><span class="menu-label">在 Danbooru 打开</span>
        </a>
      </template>
    </PopoverMenu>
  </article>
</template>
