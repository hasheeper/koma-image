<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
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
    title?: string;
    placeholder?: string;
    suggest?: boolean;
    dataset?: "anime" | "furry";
    disabled?: boolean;
    readonly?: boolean;
    maxLength?: number;
  }>(),
  value = defineModel<string>({ required: true });
const { tags } = useServices(),
  textarea = useTemplateRef<HTMLTextAreaElement>("textarea"),
  wrap = useTemplateRef<HTMLElement>("wrap"),
  mirror = useTemplateRef<HTMLElement>("mirror"),
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
  observedWidth = -1,
  observedMirrorHeight = -1;
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
  if (!enabled.value || !props.suggest || props.readonly) return;
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
    const found = await tags.suggest(q, { limit: 20, broad: true, signal, dataset: props.dataset });
    if (current !== token || fragment().query !== q || !enabled.value) return;
    items.value = found;
    selected.value = found.length ? 0 : -1;
    note.value = found.length ? "" : props.dataset === "furry" ? "没有匹配的 Furry Tag" : "没有匹配的 Danbooru Tag";
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
  if (!el || !enabled.value || !props.suggest || props.readonly) return;
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
watch([() => props.suggest, () => props.readonly, () => props.dataset, enabled, textarea], attach, { flush: "post" });
watch(
  value,
  () => {
    void nextTick(grow);
  },
  { flush: "sync" },
);
function resume() {
  enabled.value = true;
  resize?.disconnect();
  cancelAnimationFrame(growthFrame);
  observedWidth = observedMirrorHeight = -1;
  resize = new ResizeObserver((entries) => {
    let changed = false;
    for (const { target, contentRect } of entries) {
      if (target === wrap.value && contentRect.width !== observedWidth) {
        observedWidth = contentRect.width;
        changed = true;
      } else if (
        target === mirror.value &&
        contentRect.height !== observedMirrorHeight
      ) {
        // Font loading can change wrapping without changing the wrapper width.
        observedMirrorHeight = contentRect.height;
        changed = true;
      }
    }
    if (changed) {
      cancelAnimationFrame(growthFrame);
      growthFrame = requestAnimationFrame(() => {
        grow();
        position();
      });
    }
  });
  if (wrap.value) resize.observe(wrap.value);
  if (mirror.value) resize.observe(mirror.value);
  void nextTick(grow);
}
// Dialog inputs mount outside KeepAlive; they need the same layout setup.
onMounted(resume);
onActivated(resume);
function pause() {
  enabled.value = false;
  cleanup();
  dismiss();
  resize?.disconnect();
  cancelAnimationFrame(growthFrame);
  observedWidth = observedMirrorHeight = -1;
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
    <div ref="mirror" class="hl-mirror" aria-hidden="true" v-html="html"></div>
    <textarea
      :id="id"
      :disabled="disabled"
      :readonly="readonly"
      :maxlength="maxLength"
      ref="textarea"
      v-model="value"
      :aria-label="label"
      :title="title"
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
              >{{ item.source === "nai-furry" ? "Furry" : (CATEGORIES[item.category] || CATEGORIES[0]).label }} ·
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

<!-- Wrapper metrics stay global so workspace-specific height overrides retain their precedence.
     v-html weight marks are explicitly limited to the mirror, without raising specificity. -->
<style>
/* ── Weight highlighting ─────────────────────────────────────── */
/* A mirror sits behind a transparent textarea. Three things previously broke:
   1) The textarea showed an 11px scrollbar (from the global scrollbar rule)
      while the mirror used overflow:hidden. Different content widths mean
      different line-break points, so every wrapped line drifted. Both now
      reserve the same gutter via `scrollbar-gutter: stable`.
   2) The mirror drew its own border/background and fought the textarea's
      focus ring. The wrapper owns all chrome now; both children are bare.
   3) Sub-pixel font differences: `font: inherit` does not carry every metric,
      so the shared block below sets each one explicitly on both elements. */
/* THE WRAPPER IS THE ONLY SCROLLER.
   The mirror and the textarea live in this one scrolling box, so scrolling
   moves both at once, natively. Earlier versions gave each its own scrollport
   and synced with `mirror.scrollTop = textarea.scrollTop`, which is always a
   frame late (blocks lag behind the caret) and clamps differently at the
   ends (blocks visibly detach at the top). There is no sync code now. */
.hl-wrap {
  position: relative;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  background: var(--well);
  border: 1px solid var(--line);
  border-radius: var(--r3);
  transition: border-color var(--t1) var(--e), background var(--t1) var(--e),
    box-shadow var(--t1) var(--e);
  /* the handle now resizes the scroller itself */
  resize: vertical;
}
.hl-wrap:hover { border-color: var(--line-2); }
.hl-wrap:focus-within {
  border-color: var(--a-line);
  background: var(--well-focus);
  box-shadow: 0 0 0 3px var(--a-dim);
}

/* Every property here affects text layout and MUST be identical on both.
   Neither element scrolls; both grow to full content height inside the
   wrapper, so their glyphs cannot drift apart at any scroll offset. */
.hl-wrap > textarea,
.hl-wrap > .hl-mirror {
  display: block;
  width: 100%;
  min-width: 0;
  margin: 0;
  border: 0;
  padding: var(--sp-3);
  font-family: var(--sans);
  font-size: var(--fz-md);
  font-weight: var(--fw-regular);
  font-style: normal;
  font-variant: normal;
  line-height: 1.62;
  letter-spacing: -0.006em;
  word-spacing: normal;
  text-indent: 0;
  text-transform: none;
  tab-size: 4;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: normal;
  overflow: hidden;
  background: none;
  box-sizing: border-box;
}
/* The textarea is in flow and auto-grown by JS to its full content height,
   so it defines the scroll length. It never scrolls internally. */
.hl-wrap > textarea {
  position: relative;
  z-index: 1;
  height: auto;
  color: var(--fg);
  caret-color: var(--a);
  resize: none;
  border-radius: inherit;
}
.hl-wrap > textarea:focus { outline: none; box-shadow: none; background: none; }
.hl-wrap > textarea::placeholder { color: var(--fg-4); }

/* Painted underneath at the same origin. Because it is inside the same
   scrollport, it translates with the content automatically. */
.hl-wrap > .hl-mirror {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 0;
  min-height: 100%;
  color: transparent;
  pointer-events: none;
  user-select: none;
}

:where(.hl-mirror) .w { border-radius: 2px; }
/* Weight punctuation stays readable but recedes. */
:where(.hl-mirror) .w-mark { opacity: 0.85; }

</style>

<style scoped>
/* ── Danbooru Tag autocomplete ─────────────────────────────── */
.tag-suggest {
  position: fixed;
  z-index: var(--z-pop);
  max-height: min(360px, calc(100dvh - 16px));
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  touch-action: pan-y;
  padding: 3px;
  background: color-mix(in srgb, var(--raised) 97%, transparent);
  border: 1px solid var(--line-2);
  border-radius: var(--r3);
  box-shadow: var(--sh-3), var(--sh-lip);
  backdrop-filter: blur(16px);
  animation: tagSuggestIn var(--t1) var(--e-out);
}
.tag-suggest[hidden] { display: none; }
.tag-suggest-list { display: grid; gap: 1px; }
.tag-suggest-option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
  min-height: 48px;
  padding: 6px 8px;
  color: var(--fg-2);
  text-align: left;
  border-radius: var(--r2);
  transition: color var(--t1) var(--e), background var(--t1) var(--e);
}
.tag-suggest-option:hover,
.tag-suggest-option[aria-selected="true"] { color: var(--fg); background: var(--hover); }
.tag-suggest-names { display: grid; gap: 0; overflow: hidden; }
.tag-suggest-names strong,
.tag-suggest-names span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tag-suggest-names strong { font: var(--fw-medium) var(--fz-2xs)/1.3 var(--mono); color: inherit; }
.tag-suggest-names span { font-size: var(--fz-2xs); line-height: 1.3; color: var(--fg-3); }
.tag-suggest-meta {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: var(--fw-regular) var(--fz-2xs)/1.3 var(--mono);
  color: var(--fg-4);
  white-space: nowrap;
}
.tag-suggest-note {
  display: flex; align-items: center; justify-content: center; gap: var(--sp-2);
  padding: 12px; font-size: var(--fz-xs); color: var(--fg-3); text-align: center;
}
.tag-suggest-note.err { color: var(--err); }
/* Inline spinner so the debounce + request window is not silent. */
.tag-suggest-note.load::before {
  content: "";
  flex: none; width: 11px; height: 11px;
  border: 1.5px solid var(--line-2);
  border-top-color: var(--a);
  border-radius: 50%;
  animation: tagSpin 620ms linear infinite;
}
@keyframes tagSpin { to { transform: rotate(1turn); } }
@keyframes tagSuggestIn {
  from { opacity: 0; transform: translateY(3px) scale(.99); }
}


@media (max-width: 860px) {
.tag-suggest { padding: 4px; border-radius: 11px; }
.tag-suggest-option { min-height: 44px; padding: 6px 8px; }
.tag-suggest-names strong { font-size: var(--fz-sm); }
.tag-suggest-names span { font-size: var(--fz-xs); }
}
</style>
