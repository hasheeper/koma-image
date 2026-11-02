<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  shallowRef,
  watch,
} from "vue";
import { useShell } from "../../app/shell";
import { useAsk } from "../../app/ask";
import { useAskPresentation } from "../../ask/presentation";
import { useServices } from "../../app/services";
import { useUi, message } from "../../app/ui";
import { useWorkspaceLifecycle } from "../../app/workspace-lifecycle";
import { names } from "../../storage/names.ts";
import {
  CATEGORIES,
  DEFAULT_CATEGORIES,
  normalizeCategories,
  readCart,
  combinedPrompt,
  clampWeight,
  promptTag,
} from "../../domain/tags.ts";
import type { TagItem, CartTag } from "../../domain/tags.ts";
import { copyText } from "../../shared/files";
import WorkspaceSwitch from "../../shared/WorkspaceSwitch.vue";
import ThemeToggle from "../../shared/ThemeToggle.vue";
import WaveMark from "../../shared/WaveMark.vue";
import AppIcon from "../../shared/AppIcon.vue";
import PopoverMenu from "../../shared/ui/PopoverMenu.vue";
import TagResult from "./TagResult.vue";
const { router, tags: shellTags, narrow } = useShell(),
  { tags: search, preferences } = useServices(),
  ask = useAsk(),
  { shown: askShown, fullscreen: askFullscreen } = useAskPresentation(),
  ui = useUi();
const query = ref(new URLSearchParams(location.search).get("q") ?? "");
const filters = ref(
  normalizeCategories(preferences.get(names.tagCategories, DEFAULT_CATEGORIES)),
);
const cart = shallowRef<CartTag[]>(
  readCart(preferences.get(names.tagCart, [])),
);
const items = shallowRef<TagItem[]>([]),
  busy = ref(false),
  status = ref("输入关键词开始搜索"),
  error = ref(""),
  last = ref(""),
  page = ref(1),
  hasNext = ref(false),
  searched = ref(false);
const prompt = computed(() => combinedPrompt(cart.value));
const categories = [0, 3, 4, 1, 5];
// One card covers the start, no-match and failure; results replace it.
const view = computed(() =>
  items.value.length ? "results" : !searched.value ? "initial" : error.value ? "error" : "none",
);
const selectedTags = computed(() => new Set(cart.value.map((item) => item.name)));
const typeLabel = computed(() => {
  const on = categories.filter((id) => filters.value.includes(id));
  if (on.length === categories.length) return "全部类型";
  return on.length > 3 ? `${on.length} 类` : on.map((id) => CATEGORIES[id].label).join("、");
});
// The cart and an expanded ASK share one right-hand slot on wide screens; the last opened holds it.
const side = computed(() =>
  narrow.value ? undefined : shellTags.cartOpen ? "cart" : askShown.value ? "ask" : undefined,
);
const fab = shallowRef<HTMLButtonElement | null>(null),
  cartPanel = shallowRef<HTMLElement | null>(null);
const lifecycle = useWorkspaceLifecycle("tags");
let timer: ReturnType<typeof setTimeout> | undefined,
  request: AbortController | undefined,
  token = 0,
  composing = false,
  active = false,
  initial = true;
const unsub = preferences.subscribe((key) => {
  if (!key || key === names.tagCategories)
    filters.value = normalizeCategories(
      preferences.get(names.tagCategories, DEFAULT_CATEGORIES),
    );
  if (!key || key === names.tagCart)
    cart.value = readCart(preferences.get(names.tagCart, []));
});
function pause() {
  active = false;
  clearTimeout(timer);
  request?.abort();
  token++;
  busy.value = false;
}
const unsubDispose = () => {
  pause();
  unsub();
};
onBeforeUnmount(unsubDispose);
onDeactivated(pause);
onActivated(() => {
  active = true;
  if (initial) {
    initial = false;
    if (query.value)
      void run(
        Math.max(
          1,
          parseInt(new URLSearchParams(location.search).get("page") || "1") ||
            1,
        ),
        false,
      );
  }
});
lifecycle.whileActive((signal) =>
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        if (!document.querySelector(":popover-open")) shellTags.cartOpen = false;
      }
      if (event.key === "Tab" && narrow.value && shellTags.cartOpen) {
        const focus = [
          ...document.querySelectorAll<HTMLElement>(
            "#tagCart button:not([disabled]), #tagCart input",
          ),
        ].filter((n) => n.getClientRects().length);
        const first = focus[0],
          last = focus.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    },
    { signal },
  ),
);
watch(
  () => shellTags.cartOpen,
  async (open, was) => {
    if (open && active && !narrow.value && askShown.value) ask.hide();
    const inside = !!cartPanel.value?.contains(document.activeElement);
    await nextTick();
    if (!active) return;
    if (open) cartPanel.value?.querySelector<HTMLElement>(".tag-cart-close")?.focus();
    else if (was && inside)
      (fab.value ?? document.getElementById("tagSearch"))?.focus({ preventScroll: true });
  },
);
watch(askShown, (shown) => {
  if (shown && active && !narrow.value) shellTags.cartOpen = false;
});
// A small nudge when the count grows, so an add reads as landing in the capsule.
watch(
  () => cart.value.length,
  (count, previous) => {
    if (count > previous && previous > 0 && !matchMedia("(prefers-reduced-motion: reduce)").matches)
      fab.value?.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }],
        { duration: 320, easing: "cubic-bezier(.32, .72, 0, 1)" },
      );
  },
);
async function run(nextPage = 1, updateUrl = true) {
  clearTimeout(timer);
  request?.abort();
  const id = ++token, q = query.value.trim();
  page.value = nextPage;
  if (updateUrl) {
    const url = new URL(location.href);
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    if (nextPage > 1) url.searchParams.set("page", String(nextPage));
    else url.searchParams.delete("page");
    history.replaceState(history.state, "", url);
  }
  if (!q) {
    items.value = [];
    error.value = "";
    status.value = "输入关键词开始搜索";
    searched.value = false;
    hasNext.value = false;
    busy.value = false;
    return;
  }
  const signal = (request = new AbortController()).signal;
  busy.value = true;
  status.value = `正在搜索“${q}”…`;
  try {
    const result = await search.page(q, {
      page: nextPage,
      pageSize: 24,
      categories: filters.value,
      signal,
    });
    if (id !== token || !active) return;
    items.value = result.items;
    hasNext.value = result.hasNext;
    error.value = "";
    last.value = q;
    status.value = `“${q}”的匹配结果`;
    searched.value = true;
  } catch (e) {
    if (id !== token || signal.aborted) return;
    items.value = [];
    error.value = message(e);
    last.value = q;
    status.value = "搜索失败";
    hasNext.value = false;
    searched.value = true;
  } finally {
    if (id === token) busy.value = false;
  }
}
function schedule() {
  clearTimeout(timer);
  if (composing) return;
  if (!query.value.trim()) {
    void run();
    return;
  }
  timer = setTimeout(() => void run(), 320);
}
function startComposition() {
  composing = true;
  clearTimeout(timer);
  request?.abort();
  token++;
}
function endComposition() {
  composing = false;
  schedule();
}
async function toggleFilter(id: number) {
  const next = filters.value.includes(id)
    ? filters.value.filter((v) => v !== id)
    : [...filters.value, id];
  if (!next.length) {
    ui.toast("请至少保留一种类型");
    return;
  }
  try {
    await preferences.set(names.tagCategories, next);
    if (query.value.trim()) void run();
  } catch (e) {
    ui.toast(message(e), "err");
  }
}
async function save(next: CartTag[]) {
  try {
    await preferences.set(names.tagCart, next);
    cart.value = next;
    return true;
  } catch (e) {
    ui.toast(message(e), "err");
    return false;
  }
}
// The card's pressed state and the capsule's count are the feedback; no toast.
function toggle(item: TagItem) {
  const found = cart.value.some((v) => v.name === item.name);
  void save(
    found
      ? cart.value.filter((v) => v.name !== item.name)
      : [
          ...cart.value,
          {
            name: item.name,
            cnName: item.cnName,
            category: item.category,
            weight: 1,
          },
        ],
  );
}
function weight(index: number, value: unknown) {
  const next = cart.value.map((item, i) =>
    i === index ? { ...item, weight: clampWeight(value) } : item,
  );
  void save(next);
}
async function copy(text: string, label: string) {
  try {
    await copyText(text);
    ui.toast(label, "ok");
  } catch (e) {
    ui.toast(message(e), "err");
  }
}
async function clear() {
  if (
    await ui.confirm({
      title: `清空组合中的 ${cart.value.length} 个 Tag？`,
      message: "组合保存在本机，清空后无法恢复。",
      confirmLabel: "清空",
      tone: "danger",
    })
  ) {
    if (await save([])) ui.toast("已清空", "ok");
  }
}
async function apply() {
  try {
    await preferences.set(names.tagHandoff, {
      prompt: prompt.value,
      at: Date.now(),
    });
    ui.tagDelivery.value++;
    router.switchWorkspace("image");
  } catch (e) {
    ui.toast(message(e), "err");
  }
}
function turn(next: number) {
  void run(next);
  document
    .querySelector(".tags-results")
    ?.scrollIntoView({ block: "start", behavior: "smooth" });
}
</script>
<template>
  <header class="tags-nav" :inert="askFullscreen">
    <WorkspaceSwitch workspace="tags" />
    <ThemeToggle />
  </header>
  <main class="tags-main" data-workspace-root="tags" :data-state="view" :data-side="side" :inert="askFullscreen">
    <div class="tags-content">
      <p class="sr-only" role="status">{{ status }}</p>
      <section class="tags-hero">
        <h1 class="tags-lock" :class="{ 'sr-only': view !== 'initial' }" aria-label="Koma TAGS">
          <WaveMark surface="tags" /><span class="tags-word"><span class="brand-title">Koma</span><span class="brand-subtitle">TAGS</span></span>
        </h1>
        <form
          class="tags-search"
          role="search"
          @submit.prevent="!composing && run()"
        >
          <AppIcon name="tag-i-search" /><input
            id="tagSearch"
            v-model="query"
            type="search"
            autocomplete="off"
            spellcheck="false"
            placeholder="蓝发 / blue hair"
            aria-label="搜索 Danbooru Tag"
            @input="schedule"
            @compositionstart="startComposition"
            @compositionend="endComposition"
          /><PopoverMenu
            v-if="view !== 'initial'"
            id="tagTypes"
            label="Tag 类型"
            side="right"
            menu-class="tag-types-menu"
          >
            <template #trigger="{ open, toggle: toggleMenu }">
              <button class="tag-type" type="button" aria-haspopup="menu" aria-controls="tagTypes" :aria-expanded="open" @click="toggleMenu">
                <span class="sr-only">Tag 类型：</span><span class="tag-type-name">{{ typeLabel }}</span><AppIcon name="i-chevron" />
              </button>
            </template>
            <p class="menu-group" role="presentation">类型</p>
            <button
              v-for="id in categories"
              :key="id"
              class="menu-item"
              type="button"
              role="menuitemcheckbox"
              :aria-checked="filters.includes(id)"
              @click="toggleFilter(id)"
            >
              <i class="tag-category-dot" :class="CATEGORIES[id].className"></i
              ><span class="menu-label">{{ CATEGORIES[id].label }}</span
              ><AppIcon name="i-check" class="menu-check" />
            </button>
            <hr /><p class="tag-types-note" role="presentation">与绘图的 Tag 补全同步</p>
          </PopoverMenu><button class="btn btn-primary tags-send" type="submit" aria-label="搜索" :disabled="busy">
            <AppIcon name="i-up" />
          </button>
        </form>
        <div v-if="view === 'initial'" class="tags-filters" role="group" aria-label="Tag 类型筛选">
          <button
            v-for="id in categories"
            :key="id"
            class="tag-filter"
            type="button"
            :aria-pressed="filters.includes(id)"
            @click="toggleFilter(id)"
          >
            <i class="tag-category-dot" :class="CATEGORIES[id].className"></i
            >{{ CATEGORIES[id].label }}
          </button>
        </div>
      </section>
      <section v-if="view !== 'results'" class="tags-card" :data-state="view">
        <svg class="tags-card-art" viewBox="0 0 64 64" width="80" height="80" aria-hidden="true">
          <g fill="var(--empty-mark-back)">
            <rect x="8" y="8" width="22" height="22" rx="6" />
            <rect x="34" y="8" width="22" height="22" rx="6" />
            <rect x="8" y="34" width="22" height="22" rx="6" />
            <rect x="34" y="34" width="22" height="22" rx="6" />
          </g>
          <rect x="18.75" y="18.75" width="26.5" height="26.5" rx="7.25" fill="var(--empty-mark-front)" stroke-opacity=".75" stroke-width="1.5" />
        </svg>
        <template v-if="view === 'initial'">
          <h2>从一个词开始</h2>
          <p>中文找词，英文确认，复制后直接用于 Prompt。</p>
        </template>
        <template v-else-if="view === 'none'">
          <h2>没有找到“{{ last }}”</h2>
          <p>换个写法，或打开更多类型。</p>
        </template>
        <template v-else>
          <h2>搜索失败</h2>
          <p>{{ error }}<button class="tags-retry" type="button" :disabled="busy" @click="run(page)">重试</button></p>
        </template>
      </section>
      <section v-else class="tags-results" :aria-busy="busy">
        <div class="tags-results-head">
          <h2>{{ busy ? status : `“${last}”的匹配结果` }}</h2>
          <span v-if="!busy">{{ items.length }} 个 · 第 {{ page }} 页</span>
        </div>
        <div class="tags-grid">
          <TagResult
            v-for="item in items" :key="item.name" :item="item"
            :selected="selectedTags.has(item.name)"
            @toggle="toggle" @copy="copy(promptTag($event.name), `已复制 ${promptTag($event.name)}`)"
          />
        </div>
        <nav
          v-if="page > 1 || hasNext"
          class="tag-pagination"
          aria-label="搜索结果分页"
        >
          <button
            class="btn btn-quiet btn-sm"
            type="button"
            :disabled="page <= 1 || busy"
            @click="turn(page - 1)"
          >
            <AppIcon name="tag-i-back" />上一页</button
          ><span>第 {{ page }} 页</span
          ><button
            class="btn btn-quiet btn-sm"
            type="button"
            :disabled="!hasNext || busy"
            @click="turn(page + 1)"
          >
            下一页<AppIcon name="tag-i-next" />
          </button>
        </nav>
      </section>
      <footer class="tags-foot">
        搜索词会发送到在线双语 Tag 服务，英文查询在需要时回退至 Danbooru
        官方接口。
      </footer>
    </div>
    <aside
      id="tagCart"
      ref="cartPanel"
      class="tag-cart"
      aria-label="Prompt Tag 组合"
      :inert="!shellTags.cartOpen"
      :role="narrow ? 'dialog' : undefined"
      :aria-modal="narrow ? 'true' : undefined"
    >
      <header class="tag-cart-head">
        <div>
          <strong>Prompt 组合</strong
          ><span class="badge">{{ cart.length }}</span>
        </div>
        <button
          class="ibtn ibtn-xs tag-cart-clear"
          type="button"
          aria-label="清空组合"
          :disabled="!cart.length"
          @click="clear"
        >
          <AppIcon name="tag-i-trash" /></button
        ><button
          class="ibtn ibtn-xs tag-cart-close"
          type="button"
          aria-label="关闭组合侧栏"
          @click="shellTags.cartOpen = false"
        >
          <AppIcon name="tag-i-close" />
        </button>
      </header>
      <div v-if="cart.length" class="tag-cart-list">
        <article
          v-for="(item, index) in cart"
          :key="item.name"
          class="tag-cart-item"
        >
          <div class="tag-cart-item-names">
            <strong>{{ promptTag(item.name) }}</strong
            ><span>{{ item.cnName || "暂无中文翻译" }}</span>
          </div>
          <div class="tag-weight">
            <button
              class="ibtn ibtn-xs tag-weight-step"
              type="button"
              :aria-label="`降低 ${promptTag(item.name)} 的权重`"
              @click="weight(index, item.weight - 0.1)"
            >
              <AppIcon name="tag-i-minus" /></button
            ><input
              type="number"
              min="0.1"
              max="5"
              step="0.1"
              :value="item.weight"
              :aria-label="`${promptTag(item.name)} 权重`"
              @change="weight(index, ($event.target as HTMLInputElement).value)"
            /><button
              class="ibtn ibtn-xs tag-weight-step"
              type="button"
              :aria-label="`提高 ${promptTag(item.name)} 的权重`"
              @click="weight(index, item.weight + 0.1)"
            >
              <AppIcon name="tag-i-plus" /></button
            ><button
              class="ibtn ibtn-xs tag-cart-remove"
              type="button"
              :aria-label="`移除 ${promptTag(item.name)}`"
              @click="save(cart.filter((_, i) => i !== index))"
            >
              <AppIcon name="tag-i-close" />
            </button>
          </div>
        </article>
      </div>
      <p v-else class="tag-cart-empty">从搜索结果添加 Tag</p>
      <div v-if="cart.length" class="tag-cart-preview">
        <span>组合预览</span
        ><button
          class="tag-cart-copy"
          type="button"
          @click="copy(prompt, `已复制 ${cart.length} 个 Tag`)"
        >
          <AppIcon name="tag-i-copy" />复制</button
        ><code id="tagCartPrompt">{{ prompt }}</code>
      </div>
      <footer class="tag-cart-foot">
        <button
          class="btn btn-primary tag-cart-apply"
          type="button"
          :disabled="!cart.length"
          @click="apply"
        >
          <AppIcon name="tag-i-send" />应用到生成器
        </button>
      </footer>
    </aside>
  </main>
  <button
    v-if="cart.length"
    ref="fab"
    class="tag-cart-fab"
    :data-side="side"
    :inert="askFullscreen"
    type="button"
    aria-label="打开 Prompt 组合"
    aria-controls="tagCart"
    :aria-expanded="shellTags.cartOpen"
    @click="shellTags.cartOpen = true"
  >
    <b>组合</b><span>{{ cart.length }}</span></button
  ><button
    class="tag-cart-backdrop"
    :inert="askFullscreen"
    type="button"
    aria-label="关闭组合侧栏"
    @click="shellTags.cartOpen = false"
  ></button>
</template>
