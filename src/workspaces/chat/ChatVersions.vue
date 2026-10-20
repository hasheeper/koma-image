<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from "vue";
import type {
  ConversationTurn,
  ConversationVersion,
} from "../../storage/records";
import { useChat } from "../../app/chat";
import AppIcon from "../../shared/AppIcon.vue";
const props = defineProps<{ turn: ConversationTurn }>();
const { chat, view } = useChat();
const host = shallowRef<HTMLElement | null>(null);
const versions = computed(() => {
    view.value;
    return [...props.turn.versions];
  }),
  selected = computed(() => {
    view.value;
    return props.turn.selectedVersion;
  });
const status = {
  pending: "生成中",
  done: "已完成",
  error: "失败",
  cancelled: "已取消",
};
watch(
  () => `${props.turn.id}:${selected.value}:${versions.value.length}`,
  async () => {
    await nextTick();
    const list = host.value,
      button = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!list || !button) return;
    const outer = list.getBoundingClientRect(),
      inner = button.getBoundingClientRect();
    // Scroll only the thumbnail strip, never the surrounding conversation.
    if (inner.top < outer.top + 3) list.scrollTop += inner.top - outer.top - 3;
    else if (inner.bottom > outer.bottom - 3)
      list.scrollTop += inner.bottom - outer.bottom + 3;
    if (inner.left < outer.left + 3)
      list.scrollLeft += inner.left - outer.left - 3;
    else if (inner.right > outer.right - 3)
      list.scrollLeft += inner.right - outer.right + 3;
  },
  { immediate: true },
);
function preview(version: ConversationVersion) {
  const image = version.blocks.find((block) => block.type === "image");
  return image && chat.assets.assets.get(image.assetId)?.url;
}
</script>
<template>
  <div
    v-if="versions.length > 1"
    ref="host"
    class="chat-versions"
    role="group"
    aria-label="生成版本"
  >
    <button
      v-for="(v, i) in versions"
      :key="v.id"
      type="button"
      class="chat-version"
      :data-status="v.status"
      :aria-label="`第 ${i + 1} 个版本 · ${status[v.status]}`"
      :aria-pressed="selected === i"
      @click="chat.mutate(() => (turn.selectedVersion = i), true)"
    >
      <img v-if="preview(v)" :src="preview(v)" alt="" />
      <AppIcon
        v-else
        :name="
          v.status === 'error'
            ? 'i-alert'
            : v.status === 'cancelled'
              ? 'i-stop'
              : v.status === 'pending'
                ? 'i-points'
                : 'i-image'
        "
      />
      <span class="mono">{{ i + 1 }}</span>
    </button>
    <span class="version-count sr-only"
      >{{ selected + 1 }}/{{ versions.length }}</span
    >
  </div>
</template>
