<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import { render } from "../domain/highlight.ts";
import {
  CATEGORIES,
  formatCount,
  hasHan,
  fragmentAtCaret,
  insertTag,
  promptTag,
} from "../domain/tags.ts";
import type { TagItem } from "../domain/tags.ts";
import { useServices } from "../app/services";
import { message } from "../app/ui";
import { placeSuggestions } from "./caret-layout";
const props = defineProps<{
    id: string;
    label: string;
    placeholder?: string;
    suggest?: boolean;
    disabled?: boolean;
    maxLength?: number;
  }>(),
  value = defineModel<string>({ required: true });
const { tags } = useServices(),
  textarea = useTemplateRef<HTMLTextAreaElement>("textarea"),
  wrap = useTemplateRef<HTMLElement>("wrap"),
  popover = useTemplateRef<HTMLElement>("popover"),
  measurement = useTemplateRef<HTMLElement>("measurement");
const html = computed(() => render(value.value)),
  enabled = ref(true),
  open = ref(false),
  busy = ref(false),
  note = ref(""),
  items = shallowRef<TagItem[]>([]),
  selected = ref(-1),
  listId = `tag-suggest-${useId()}`;
let timer: ReturnType<typeof setTimeout> | undefined,
  request: AbortController | undefined,
  token = 0,
  composing = false,
  cleanup = () => {},
  resize: ResizeObserver | undefined,
  growthFrame = 0,
  observedWidth = -1;
function dismiss() {
  clearTimeout(timer);
  request?.abort();
  token++;
  open.value = false;
  busy.value = false;
}
function grow() {
  const el = textarea.value;
  if (!el || !enabled.value || !el.getClientRects().length) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
function position() {
  if (open.value && textarea.value && popover.value && measurement.value)
    placeSuggestions(textarea.value, popover.value, measurement.value);
}
function fragment() {
  const el = textarea.value;
  return el
    ? fragmentAtCaret(el.value, el.selectionStart, el.selectionEnd)
    : { query: "", start: 0, end: 0 };
}
async function search() {
  if (!enabled.value || !props.suggest) return;
  const q = fragment().query;
  if (q.length < (hasHan(q) ? 1 : 2)) {
    dismiss();
    return;
  }
  request?.abort();
  const current = ++token,
    signal = (request = new AbortController()).signal;
  busy.value = true;
  if (!open.value) {
    items.value = [];
    note.value = "正在查词典…";
    open.value = true;
    await nextTick();
    if (current !== token) return;
    position();
  }
  try {
    const found = await tags.suggest(q, { limit: 20, broad: true, signal });
    if (current !== token || fragment().query !== q || !enabled.value) return;
    items.value = found;
    selected.value = found.length ? 0 : -1;
    note.value = found.length ? "" : "没有匹配的 Danbooru Tag";
    open.value = true;
    await nextTick();
    position();
  } catch (error) {
    if (current === token && !signal.aborted) {
      items.value = [];
      selected.value = -1;
      note.value = message(error);
      open.value = true;
      await nextTick();
      position();
    }
  } finally {
    if (current === token) busy.value = false;
  }
}
function schedule() {
  clearTimeout(timer);
  if (composing) return;
  if (document.activeElement !== textarea.value) {
    dismiss();
    return;
  }
  const q = fragment().query;
  if (q.length < (hasHan(q) ? 1 : 2)) {
    dismiss();
    return;
  }
  timer = setTimeout(() => void search(), 280);
}
async function choose(index: number) {
  const item = items.value[index],
    el = textarea.value;
  if (!item || !el) return;
  const inserted = insertTag(
    el.value,
    el.selectionStart,
    el.selectionEnd,
    item.name,
  );
  value.value = inserted.value;
  dismiss();
  await nextTick();
  el.focus();
  el.setSelectionRange(inserted.caret, inserted.caret);
}
async function keydown(event: KeyboardEvent) {
  if (composing || event.isComposing || !open.value) return;
  if (["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    selected.value =
      event.key === "ArrowDown"
        ? Math.min(items.value.length - 1, selected.value + 1)
        : Math.max(0, selected.value - 1);
    await nextTick();
    popover.value
      ?.querySelector("[aria-selected=true]")
      ?.scrollIntoView({ block: "nearest" });
  } else if (["Enter", "Tab"].includes(event.key) && selected.value >= 0) {
    event.preventDefault();
    event.stopPropagation();
    void choose(selected.value);
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  }
}
function attach() {
  cleanup();
  dismiss();
  const el = textarea.value;
  if (!el || !enabled.value || !props.suggest) return;
  const events = new AbortController(),
    options = { signal: events.signal };
  el.addEventListener("blur", dismiss, options);
  el.addEventListener("input", schedule, options);
  el.addEventListener("click", schedule, options);
  el.addEventListener(
    "compositionstart",
    () => {
      composing = true;
      dismiss();
    },
    options,
  );
  el.addEventListener(
    "compositionend",
    () => {
      composing = false;
      schedule();
    },
    options,
  );
  el.addEventListener("keydown", keydown, options);
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.target !== el && !popover.value?.contains(event.target as Node))
        dismiss();
    },
    options,
  );
  document.addEventListener("selectionchange", position, options);
  document.addEventListener("scroll", position, { ...options, capture: true });
  window.addEventListener("resize", position, options);
  window.visualViewport?.addEventListener("resize", position, options);
  window.visualViewport?.addEventListener("scroll", position, options);
  cleanup = () => events.abort();
}
watch([() => props.suggest, enabled, textarea], attach, { flush: "post" });
watch(
  value,
  () => {
    void nextTick(grow);
  },
  { flush: "sync" },
);
onActivated(() => {
  enabled.value = true;
  resize?.disconnect();
  resize = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width;
    if (width !== observedWidth) {
      observedWidth = width;
      cancelAnimationFrame(growthFrame);
      growthFrame = requestAnimationFrame(() => {
        grow();
        position();
      });
    }
  });
  if (wrap.value) resize.observe(wrap.value);
  void nextTick(grow);
});
function pause() {
  enabled.value = false;
  cleanup();
  dismiss();
  resize?.disconnect();
  cancelAnimationFrame(growthFrame);
  observedWidth = -1;
  measurement.value?.replaceChildren();
}
onDeactivated(pause);
onBeforeUnmount(pause);
defineExpose({
  focus() {
    textarea.value?.focus();
  },
  end() {
    const el = textarea.value;
    el?.focus();
    el?.setSelectionRange(value.value.length, value.value.length);
  },
});
</script>
<template>
  <div ref="wrap" class="hl-wrap">
    <div class="hl-mirror" aria-hidden="true" v-html="html"></div>
    <textarea
      :id="id"
      :disabled="disabled"
      :maxlength="maxLength"
      ref="textarea"
      v-model="value"
      :aria-label="label"
      :placeholder="placeholder"
      autocomplete="off"
      spellcheck="false"
      :aria-autocomplete="suggest && enabled ? 'list' : undefined"
      :aria-controls="suggest && enabled ? listId : undefined"
      :aria-expanded="suggest && enabled ? open : undefined"
      :aria-haspopup="suggest && enabled ? 'listbox' : undefined"
      :aria-activedescendant="
        open && selected >= 0 ? `${listId}-option-${selected}` : undefined
      "
    ></textarea>
  </div>
  <Teleport to="body"
    ><div
      v-if="enabled"
      :id="listId"
      ref="popover"
      class="tag-suggest"
      role="listbox"
      :hidden="!open"
      :aria-busy="busy"
    >
      <div v-if="items.length" class="tag-suggest-list">
        <button
          v-for="(item, index) in items"
          :id="`${listId}-option-${index}`"
          :key="item.name"
          class="tag-suggest-option"
          type="button"
          role="option"
          :aria-selected="selected === index"
          :data-category="item.category"
          @pointerdown.prevent
          @click="choose(index)"
          @mouseenter="selected = index"
        >
          <span class="tag-suggest-names"
            ><strong>{{ item.name }}</strong
            ><span>{{ item.cnName || promptTag(item.name) }}</span></span
          ><span class="tag-suggest-meta"
            ><i
              class="tag-category-dot"
              :class="(CATEGORIES[item.category] || CATEGORIES[0]).className"
            ></i
            ><span
              >{{ (CATEGORIES[item.category] || CATEGORIES[0]).label }} ·
              {{ formatCount(item.count) }}</span
            ></span
          >
        </button>
      </div>
      <p
        v-else
        class="tag-suggest-note"
        :class="busy ? 'load' : ''"
        role="status"
      >
        {{ note }}
      </p>
    </div>
    <!-- Only this empty measurement host delegates its contents and styles to the native caret driver. -->
    <div
      v-if="enabled"
      ref="measurement"
      aria-hidden="true"
      style="position: fixed; visibility: hidden; pointer-events: none"
    ></div>
  </Teleport>
</template>
