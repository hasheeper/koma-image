<script setup lang="ts">
import { onBeforeUnmount, onDeactivated, shallowRef, useId } from "vue";
import AppIcon from "../../shared/AppIcon.vue";
import { placeMenu } from "../../shared/popover";
defineProps<{ url: string; filename: string; base: boolean }>();
const emit = defineEmits<{
  upscale: [];
  continue: [];
  retain: [];
  retry: [];
}>();
const id = useId(),
  trigger = shallowRef<HTMLButtonElement | null>(null),
  bars = shallowRef<HTMLElement[]>([]);
function close() {
  bars.value.find((bar) => bar.matches(":popover-open"))?.hidePopover();
  unlisten();
}
function unlisten() {
  window.removeEventListener("resize", close);
  document.removeEventListener("scroll", close, true);
}
function position(event: Event) {
  const pop = event.currentTarget as HTMLElement;
  unlisten();
  if (pop.matches(":popover-open") && trigger.value) {
    placeMenu(pop, trigger.value.getBoundingClientRect());
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, {
      capture: true,
      passive: true,
    });
  }
}
onDeactivated(close);
onBeforeUnmount(close);
</script>
<template>
  <button
    ref="trigger"
    class="ibtn result-menu-trigger"
    type="button"
    aria-label="图片操作"
    :popovertarget="id"
  >
    <AppIcon name="i-more" />
  </button>
  <!-- The same actions have a floating bar and a compact popover. CSS selects
       one surface by the actual image width, including unusually narrow art. -->
  <div
    v-for="surface in ['overlay', 'menu']"
    :key="surface"
    ref="bars"
    class="result-actions"
    :class="`result-actions-${surface}`"
    :id="surface === 'menu' ? id : undefined"
    :popover="surface === 'menu' ? 'auto' : undefined"
    role="group"
    aria-label="图片操作"
    @toggle="position"
    @click="surface === 'menu' && close()"
  >
    <a
      class="ibtn"
      :href="url"
      :download="filename"
      aria-label="下载图片"
      title="下载图片"
      ><AppIcon name="i-download"
    /></a>
    <button
      class="ibtn"
      type="button"
      aria-label="放大图片"
      title="放大图片"
      @click="emit('upscale')"
    >
      <AppIcon name="i-upscale" />
    </button>
    <button
      class="ibtn continue-edit"
      :class="{ 'ibtn-accent': base }"
      type="button"
      aria-label="继续编辑这张图"
      title="继续编辑这张图"
      @click="emit('continue')"
    >
      <AppIcon name="i-edit" />
    </button>
    <button
      class="ibtn"
      type="button"
      aria-label="添加为参考图"
      title="添加为参考图"
      @click="emit('retain')"
    >
      <AppIcon name="i-image-plus" />
    </button>
    <button
      class="ibtn"
      type="button"
      aria-label="重新生成此版本"
      title="重新生成此版本"
      @click="emit('retry')"
    >
      <AppIcon name="i-retry" />
    </button>
  </div>
</template>
