<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onDeactivated,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue";
import { useUi, message } from "../app/ui";
import { useShell } from "../app/shell";
import { useServices } from "../app/services";
import {
  CATEGORIES,
  formatCount,
  hasHan,
  promptTag,
  togglePromptTag,
} from "../domain/tags.ts";
import type { TagItem } from "../domain/tags.ts";
import AppIcon from "./AppIcon.vue";
const value = defineModel<string>({ required: true }),
  ui = useUi(),
  { router } = useShell(),
  { tags } = useServices();
const root = useTemplateRef<HTMLElement>("root"),
  field = useTemplateRef<HTMLInputElement>("field");
const query = ref(""),
  items = shallowRef<TagItem[]>([]),
  selected = ref(-1),
  status = ref("输入中文或英文开始搜索"),
  tone = ref(""),
  added = ref<string[]>([]),
  visible = ref(false);
const present = (name: string) =>
  value.value
    .split(",")
    .some(
      (part) =>
        promptTag(part.trim()).toLowerCase() === promptTag(name).toLowerCase(),
    );
const chosen = computed(() => added.value.filter(present));
let timer: ReturnType<typeof setTimeout> | undefined,
  hideTimer: ReturnType<typeof setTimeout> | undefined,
  request: AbortController | undefined,
  token = 0,
  composing = false,
  lastFocus: HTMLElement | null = null;
function abort() {
  clearTimeout(timer);
  request?.abort();
  token++;
}
function close() {
  ui.pickerOpen.value = false;
}
function toggle(name: string) {
  const result = togglePromptTag(value.value, name);
  value.value = result.value;
  added.value = added.value.filter(
    (n) => promptTag(n).toLowerCase() !== promptTag(name).toLowerCase(),
  );
  if (result.added) added.value.push(name);
  ui.toast(`已${result.added ? "插入" : "移除"} ${promptTag(name)}`, "ok");
}
async function search() {
  abort();
  const q = query.value.trim();
  if (q.length < (hasHan(q) ? 1 : 2)) {
    items.value = [];
    status.value = q ? "再多输入一个字" : "输入中文或英文开始搜索";
    tone.value = "";
    return;
  }
  const current = token,
    signal = (request = new AbortController()).signal;
  status.value = "正在查词典…";
  tone.value = "load";
  try {
    const found = await tags.suggest(q, { limit: 30, broad: true, signal });
    if (current !== token || !ui.pickerOpen.value) return;
    items.value = found;
    selected.value = found.length ? 0 : -1;
    status.value = found.length ? "" : "没有匹配的 Tag";
    tone.value = "";
  } catch (error) {
    if (current !== token || signal.aborted) return;
    status.value = message(error);
    tone.value = "err";
  }
}
function schedule() {
  abort();
  if (!composing) timer = setTimeout(() => void search(), 280);
}
function startComposition() {
  composing = true;
  abort();
}
function endComposition() {
  composing = false;
  schedule();
}
async function keydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  if (event.key === "Tab") {
    const all = [
        ...root.value!.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input,a",
        ),
      ].filter((n) => n.getClientRects().length),
      first = all[0],
      last = all.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
    return;
  }
  if (composing || event.isComposing || event.target !== field.value) return;
  if (["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    selected.value =
      event.key === "ArrowDown"
        ? Math.min(items.value.length - 1, selected.value + 1)
        : Math.max(0, selected.value - 1);
    await nextTick();
    root.value
      ?.querySelector(".picker-row.on")
      ?.scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (items.value[selected.value]) toggle(items.value[selected.value].name);
  }
}
watch(ui.pickerOpen, async (open) => {
  clearTimeout(hideTimer);
  abort();
  if (open) {
    lastFocus = document.activeElement as HTMLElement;
    visible.value = true;
    await nextTick();
    field.value?.focus();
  } else {
    lastFocus?.isConnected && lastFocus.focus({ preventScroll: true });
    lastFocus = null;
    hideTimer = setTimeout(() => (visible.value = false), 320);
  }
});
function stop() {
  close();
  abort();
  clearTimeout(hideTimer);
  visible.value = false;
}
onDeactivated(stop);
onBeforeUnmount(stop);
function fullDictionary() {
  close();
  router.switchWorkspace("tags");
}
</script>
<template>
  <Teleport to="body"
    ><div
      v-if="visible"
      id="pickerSheet"
      ref="root"
      class="sheet"
      @click.self="close"
      @keydown="keydown"
    >
      <div
        class="picker-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pickerTitle"
      >
        <header class="picker-head">
          <div class="picker-title">
            <AppIcon name="i-search" /><strong id="pickerTitle"
              >查词插入</strong
            >
          </div>
          <a class="btn-link" href="#/tags" @click.prevent="fullDictionary"
            >完整词典</a
          ><button
            class="ibtn ibtn-xs"
            type="button"
            aria-label="关闭查词插入"
            @click="close"
          >
            <AppIcon name="i-close" />
          </button>
        </header>
        <div class="picker-search">
          <AppIcon name="i-search" /><input
            id="pickerSearch"
            ref="field"
            v-model="query"
            type="search"
            autocomplete="off"
            spellcheck="false"
            placeholder="蓝发 / blue hair"
            aria-label="搜索 Tag"
            @input="schedule"
            @compositionstart="startComposition"
            @compositionend="endComposition"
          />
        </div>
        <div v-show="chosen.length" class="picker-chosen">
          <span>本次插入</span>
          <div>
            <button
              v-for="name in chosen"
              :key="name"
              class="picker-chip"
              type="button"
              :aria-label="`移除 ${promptTag(name)}`"
              @click="toggle(name)"
            >
              {{ promptTag(name) }}<i aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <p
          v-show="status"
          class="picker-status"
          :class="tone"
          role="status"
          aria-live="polite"
        >
          {{ status }}
        </p>
        <div
          id="pickerResults"
          class="picker-results"
          role="listbox"
          aria-label="搜索结果"
        >
          <button
            v-for="(item, index) in items"
            :key="item.name"
            class="picker-row"
            :class="{ on: index === selected }"
            type="button"
            :aria-pressed="present(item.name)"
            @click="
              selected = index;
              toggle(item.name);
            "
          >
            <span class="picker-names"
              ><strong>{{ promptTag(item.name) }}</strong
              ><span>{{ item.cnName }}</span></span
            ><span class="picker-meta"
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
        <footer class="picker-foot">点一下插入描述，再点一下移除</footer>
      </div>
    </div></Teleport
  >
</template>
