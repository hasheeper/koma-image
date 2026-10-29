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
import { useAskPresentation } from "../../ask/presentation";
const { fullscreen: askFullscreen } = useAskPresentation();
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
  formatCount,
  tagUrl,
} from "../../domain/tags.ts";
import type { TagItem, CartTag } from "../../domain/tags.ts";
import { copyText } from "../../shared/files";
import WorkspaceSwitch from "../../shared/WorkspaceSwitch.vue";
import AppIcon from "../../shared/AppIcon.vue";
const { router, tags: shellTags, narrow } = useShell(),
  { tags: search, preferences } = useServices(),
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
  page = ref(1),
  hasNext = ref(false),
  searched = ref(false);
const prompt = computed(() => combinedPrompt(cart.value));
const categories = [0, 3, 4, 1, 5];
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
      if (
        event.key === "Escape" &&
        !document.querySelector("dialog[open], :popover-open")
      )
        shellTags.cartOpen = false;
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
    await nextTick();
    if (!narrow.value) return;
    if (open) document.querySelector<HTMLElement>(".tag-cart-close")?.focus();
    else if (was) document.querySelector<HTMLElement>(".tag-cart-fab")?.focus();
  },
);
async function run(nextPage = 1, updateUrl = true) {
  clearTimeout(timer);
  request?.abort();
  const id = ++token,
    q = query.value.trim();
  page.value = nextPage;
  error.value = "";
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
      pageSize: 25,
      categories: filters.value,
      signal,
    });
    if (id !== token || !active) return;
    items.value = result.items;
    hasNext.value = result.hasNext;
    status.value = `“${q}”的匹配结果`;
    searched.value = true;
  } catch (e) {
    if (id !== token || signal.aborted) return;
    items.value = [];
    error.value = message(e);
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
async function toggle(item: TagItem) {
  const found = cart.value.some((v) => v.name === item.name);
  if (
    await save(
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
    )
  )
    ui.toast(`已${found ? "移除" : "添加"} ${promptTag(item.name)}`, "ok");
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
  <header class="topbar tags-topbar" :inert="askFullscreen">
    <WorkspaceSwitch workspace="tags" /><a
      class="btn btn-quiet btn-sm tags-back"
      href="#/image"
      @click.prevent="router.switchWorkspace('image')"
      >回到绘图</a
    >
  </header>
  <main class="tags-main" data-workspace-root="tags" :inert="askFullscreen">
    <div class="tags-content">
      <section class="tags-hero">
        <p class="tags-kicker">DANBOORU TAG DICTIONARY</p>
        <h1>中文 / 英文 Tag 词典</h1>
        <p class="tags-lede">中文找词，英文确认，复制后直接用于 Prompt。</p>
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
            placeholder="例如：蓝发 / blue hair"
            aria-label="搜索 Danbooru Tag"
            @input="schedule"
            @compositionstart="startComposition"
            @compositionend="endComposition"
          /><button class="btn btn-primary" type="submit" :disabled="busy">
            搜索
          </button>
        </form>
        <div class="tags-filters" aria-label="Tag 类型筛选">
          <span class="tags-filter-label">类型</span
          ><button
            v-for="id in categories"
            :key="id"
            class="tag-filter"
            type="button"
            :aria-pressed="filters.includes(id)"
            @click="toggleFilter(id)"
          >
            <i class="tag-category-dot" :class="CATEGORIES[id].className"></i
            >{{ CATEGORIES[id].label }}</button
          ><span class="tags-filter-sync">同步补全</span>
        </div>
      </section>
      <section class="tags-results" :aria-busy="busy">
        <div class="tags-results-head">
          <p role="status">{{ status }}</p>
          <span>{{
            searched && !busy && !error
              ? `${items.length} 个 · 第 ${page} 页`
              : ""
          }}</span>
        </div>
        <div class="tags-grid">
          <p
            v-if="error || (searched && !items.length && !busy)"
            class="tags-empty"
          >
            {{ error || "没有找到匹配的 Danbooru Tag" }}
          </p>
          <article v-for="item in items" :key="item.name" class="tag-card">
            <button
              class="tag-card-info tag-add"
              type="button"
              :data-tag="item.name"
              :aria-pressed="cart.some((v) => v.name === item.name)"
              :aria-label="`${cart.some((v) => v.name === item.name) ? '移出' : '加入'} Prompt 组合：${promptTag(item.name)}`"
              @click="toggle(item)"
            >
              <span class="tag-card-names"
                ><strong>{{ item.name }}</strong
                ><span>{{ item.cnName || "暂无中文翻译" }}</span></span
              ><span class="tag-card-meta"
                ><i
                  class="tag-category-dot"
                  :class="
                    (CATEGORIES[item.category] || CATEGORIES[0]).className
                  "
                ></i
                ><span
                  >{{ (CATEGORIES[item.category] || CATEGORIES[0]).label }} ·
                  {{ formatCount(item.count) }}</span
                ></span
              >
            </button>
            <div class="tag-card-actions">
              <button
                class="ibtn ibtn-xs"
                type="button"
                :aria-label="`复制 ${promptTag(item.name)}`"
                data-tip="复制"
                @click="
                  copy(promptTag(item.name), `已复制 ${promptTag(item.name)}`)
                "
              >
                <AppIcon name="tag-i-copy" /></button
              ><a
                class="ibtn ibtn-xs"
                :href="tagUrl(item.name)"
                target="_blank"
                rel="noopener noreferrer"
                data-tip="Danbooru"
                :aria-label="`在 Danbooru 打开 ${item.name}（新标签页）`"
                ><AppIcon name="tag-i-external"
              /></a>
            </div>
          </article>
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
        搜索词会发送到在线双语 Tag 服务；英文查询在需要时回退至 Danbooru
        官方接口。
      </footer>
    </div>
    <aside
      id="tagCart"
      class="tag-cart"
      aria-label="Prompt Tag 组合"
      :inert="narrow && !shellTags.cartOpen"
      :role="narrow ? 'dialog' : undefined"
      :aria-modal="narrow ? 'true' : undefined"
    >
      <header class="tag-cart-head">
        <div>
          <strong>Prompt 组合</strong
          ><span class="badge">{{ cart.length }}</span>
        </div>
        <button
          class="ibtn ibtn-xs tag-cart-close"
          type="button"
          aria-label="关闭组合侧栏"
          @click="shellTags.cartOpen = false"
        >
          <AppIcon name="tag-i-close" />
        </button>
      </header>
      <div class="tag-cart-list">
        <article
          v-for="(item, index) in cart"
          :key="item.name"
          class="tag-cart-item"
        >
          <div class="tag-cart-item-names">
            <strong>{{ item.name }}</strong
            ><span>{{ item.cnName || "暂无中文翻译" }}</span>
          </div>
          <div class="tag-weight">
            <span>权重</span
            ><button
              class="ibtn ibtn-xs tag-weight-step"
              type="button"
              :aria-label="`降低 ${item.name} 的权重`"
              @click="weight(index, item.weight - 0.1)"
            >
              <AppIcon name="tag-i-minus" /></button
            ><input
              type="number"
              min="0.1"
              max="5"
              step="0.1"
              :value="item.weight"
              :aria-label="`${item.name} 权重`"
              @change="weight(index, ($event.target as HTMLInputElement).value)"
            /><button
              class="ibtn ibtn-xs tag-weight-step"
              type="button"
              :aria-label="`提高 ${item.name} 的权重`"
              @click="weight(index, item.weight + 0.1)"
            >
              <AppIcon name="tag-i-plus" /></button
            ><button
              class="ibtn ibtn-xs tag-cart-remove"
              type="button"
              :aria-label="`移除 ${item.name}`"
              @click="save(cart.filter((_, i) => i !== index))"
            >
              <AppIcon name="tag-i-close" />
            </button>
          </div>
        </article>
      </div>
      <p v-if="!cart.length" class="tag-cart-empty">从搜索结果添加 Tag</p>
      <div v-else class="tag-cart-preview">
        <span>组合预览</span><code id="tagCartPrompt">{{ prompt }}</code>
      </div>
      <footer class="tag-cart-foot">
        <button
          class="btn btn-primary btn-sm tag-cart-apply"
          type="button"
          :disabled="!cart.length"
          @click="apply"
        >
          <AppIcon name="tag-i-send" />应用到生成器
        </button>
        <div class="tag-cart-foot-row">
          <button
            class="btn btn-quiet btn-sm"
            type="button"
            :disabled="!cart.length"
            @click="clear"
          >
            <AppIcon name="tag-i-trash" />清空</button
          ><button
            class="btn btn-quiet btn-sm"
            type="button"
            :disabled="!cart.length"
            @click="copy(prompt, `已复制 ${cart.length} 个 Tag`)"
          >
            <AppIcon name="tag-i-copy" />复制
          </button>
        </div>
      </footer>
    </aside>
  </main>
  <button
    class="tag-cart-fab"
    :inert="askFullscreen"
    type="button"
    aria-label="打开 Prompt 组合"
    aria-controls="tagCart"
    :aria-expanded="shellTags.cartOpen"
    @click="shellTags.cartOpen = true"
  >
    <AppIcon name="tag-i-cart" /><span>{{ cart.length }}</span></button
  ><button
    class="tag-cart-backdrop"
    :inert="askFullscreen"
    type="button"
    aria-label="关闭组合侧栏"
    @click="shellTags.cartOpen = false"
  ></button>
</template>
