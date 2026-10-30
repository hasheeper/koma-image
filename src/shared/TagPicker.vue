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
const props = defineProps<{ dataset?: "anime" | "furry" }>();
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
    status.value = q ? "再多输入一个字" : props.dataset === "furry" ? "输入英文搜索 Furry 标签" : "输入中文或英文开始搜索";
    tone.value = "";
    return;
  }
  const current = token,
    signal = (request = new AbortController()).signal;
  status.value = "正在查词典…";
  tone.value = "load";
  try {
    const found = await tags.suggest(q, { limit: 30, broad: true, signal, dataset: props.dataset });
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
watch(() => props.dataset, () => {
  abort(); items.value = []; selected.value = -1; tone.value = "";
  status.value = props.dataset === "furry" ? "输入英文搜索 Furry 标签" : "输入中文或英文开始搜索";
  if (ui.pickerOpen.value) void search();
});
watch(ui.pickerOpen, async (open) => {
  clearTimeout(hideTimer);
  abort();
  if (open) {
    lastFocus = document.activeElement as HTMLElement;
    void search();
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
            :placeholder="props.dataset === 'furry' ? 'wolf / fluffy tail' : '蓝发 / blue hair'"
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
                >{{ item.source === "nai-furry" ? "Furry" : (CATEGORIES[item.category] || CATEGORIES[0]).label }} ·
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

<style scoped>
/* ── Tag picker ──────────────────────────────────────────────── */
body[data-picker="open"] #pickerSheet { opacity: 1; }
body[data-picker="open"] .picker-card { transform: none; }
.picker-card {
  --well: var(--well-raised);
  --well-focus: var(--well-raised-focus);
  display: grid;
  grid-template-rows: auto auto auto auto minmax(0, 1fr) auto;
  gap: var(--sp-3);
  width: min(520px, 100%);
  height: min(640px, calc(100dvh - 2 * var(--sp-5)));
  padding: var(--sp-4);
  background: var(--raised);
  border: 1px solid var(--line);
  border-radius: var(--r4);
  box-shadow: var(--sh-lip), var(--sh-4);
  transform: translateY(10px) scale(0.985);
  transition: transform var(--t3) var(--e-out);
}
.picker-head { display: flex; align-items: center; gap: var(--sp-3); }
.picker-title { display: flex; align-items: center; gap: var(--sp-2); margin-right: auto; }
.picker-title .ico { color: var(--a); }
.picker-title strong { font-size: var(--fz-xl); font-weight: var(--fw-bold); letter-spacing: -0.02em; }

.picker-search {
  display: flex; align-items: center;
  background: var(--well);
  border: 1px solid var(--line-2);
  border-radius: var(--r2);
  transition: border-color var(--t1) var(--e), box-shadow var(--t1) var(--e);
}
.picker-search:focus-within { border-color: var(--a-line); box-shadow: var(--ring); }
.picker-search > .ico { margin-left: 10px; color: var(--fg-4); }
.picker-search input {
  flex: 1; width: auto;
  min-height: 38px;
  background: transparent; border: 0; box-shadow: none;
  font-size: var(--fz-md);
}
.picker-search input:hover:not(:focus),
.picker-search input:focus { background: transparent; box-shadow: none; }

/* What this session put in, so it can be taken back out without hunting
   through the prompt text. */
.picker-chosen { display: grid; gap: var(--sp-2); }
.picker-chosen[hidden] { display: none; }
.picker-chosen > span { font-size: var(--fz-2xs); color: var(--fg-4); }
.picker-chosen > div { display: flex; flex-wrap: wrap; gap: var(--sp-1); }
.picker-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 8px;
  font: var(--fw-regular) var(--fz-2xs)/1.5 var(--mono);
  color: var(--a);
  background: var(--a-dim);
  border: 1px solid var(--a-line);
  border-radius: 20px;
  transition: color var(--t1) var(--e), background var(--t1) var(--e);
}
.picker-chip i {
  width: 7px; height: 7px; flex: none;
  background: currentColor;
  clip-path: polygon(14% 0, 50% 36%, 86% 0, 100% 14%, 64% 50%, 100% 86%, 86% 100%, 50% 64%, 14% 100%, 0 86%, 36% 50%, 0 14%);
}
.picker-chip:hover { color: var(--err); background: var(--err-dim); border-color: transparent; }

.picker-status { min-height: 15px; font-size: var(--fz-xs); color: var(--fg-3); }
.picker-status[hidden] { display: none; }
.picker-status.err { color: var(--err); }
.picker-status.load { display: flex; align-items: center; gap: var(--sp-2); }
.picker-status.load::before {
  content: "";
  flex: none; width: 11px; height: 11px;
  border: 1.5px solid var(--line-2);
  border-top-color: var(--a);
  border-radius: 50%;
  animation: tagSpin 620ms linear infinite;
}

.picker-results {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  display: grid; gap: 1px;
  align-content: start;
}
.picker-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--sp-3);
  width: 100%;
  min-height: 44px;
  padding: 6px 9px;
  color: var(--fg-2);
  text-align: left;
  border: 1px solid transparent;
  border-radius: var(--r2);
  transition: color var(--t1) var(--e), background var(--t1) var(--e),
    border-color var(--t1) var(--e);
}
.picker-row:hover, .picker-row.on { color: var(--fg); background: var(--hover); }
/* Already in the prompt: clicking again removes it. */
.picker-row[aria-pressed="true"] {
  color: var(--fg);
  background: var(--a-dim);
  border-color: var(--a-line);
}
.picker-row[aria-pressed="true"] .picker-names strong::after {
  content: "";
  display: inline-block;
  width: 9px; height: 9px;
  margin-left: 6px;
  background: var(--a);
  clip-path: polygon(19% 52%, 36% 68%, 82% 22%, 92% 33%, 37% 87%, 8% 60%);
}
.picker-names { display: grid; gap: 1px; overflow: hidden; }
.picker-names strong,
.picker-names span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.picker-names strong { font: var(--fw-medium) var(--fz-sm)/1.35 var(--mono); }
.picker-names span { font-size: var(--fz-xs); color: var(--fg-3); }
.picker-meta {
  flex: none;
  display: inline-flex; align-items: center; gap: 5px;
  font: var(--fw-regular) var(--fz-2xs)/1.3 var(--mono);
  color: var(--fg-4);
  white-space: nowrap;
}
.picker-foot {
  padding-top: var(--sp-2);
  border-top: 1px solid var(--line);
  font-size: var(--fz-2xs); color: var(--fg-4);
}


@keyframes tagSpin { to { transform: rotate(1turn); } }

@media (max-width: 860px) {
.picker-card {
    width: 100%;
    height: 88dvh;
    border: 0;
    border-radius: var(--r4) var(--r4) 0 0;
    padding: var(--sp-4) var(--sp-3) calc(var(--sp-3) + env(safe-area-inset-bottom));
    transform: translateY(12px);
  }
.picker-row { min-height: 48px; }
}
</style>
