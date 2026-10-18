<script setup lang="ts">
import { ref } from "vue";
import { useShell } from "../../app/shell";
import { useWorkspaceLifecycle } from "../../app/workspace-lifecycle";
import WorkspaceSwitch from "../../shared/WorkspaceSwitch.vue";
import AppIcon from "../../shared/AppIcon.vue";

const { router, tags } = useShell();
const query = ref(new URLSearchParams(location.search).get("q") ?? "");
const filters = ref([0, 3, 4]);
const categories = [
  { id: 0, name: "通用", css: "general" },
  { id: 3, name: "作品", css: "copyright" },
  { id: 4, name: "角色", css: "character" },
  { id: 1, name: "画师", css: "artist" },
  { id: 5, name: "元数据", css: "meta" },
];
function toggle(id: number) {
  filters.value = filters.value.includes(id)
    ? filters.value.filter((item) => item !== id)
    : [...filters.value, id];
}
const lifecycle = useWorkspaceLifecycle("tags");
lifecycle.whileActive((signal) =>
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        !document.querySelector("dialog[open], :popover-open")
      )
        tags.cartOpen = false;
    },
    { signal },
  ),
);
</script>
<template>
  <header class="topbar tags-topbar">
    <WorkspaceSwitch workspace="tags" /><a
      class="btn btn-quiet btn-sm tags-back"
      href="#/image"
      @click.prevent="router.switchWorkspace('image')"
      >回到绘图</a
    >
  </header>
  <main class="tags-main" data-workspace-root="tags">
    <div class="tags-content">
      <section class="tags-hero">
        <p class="tags-kicker">DANBOORU TAG DICTIONARY</p>
        <h1>中文 / 英文 Tag 词典</h1>
        <p class="tags-lede">中文找词，英文确认，复制后直接用于 Prompt。</p>
        <form class="tags-search" role="search" @submit.prevent>
          <AppIcon name="i-search" /><input
            id="tagSearch"
            v-model="query"
            type="search"
            autocomplete="off"
            spellcheck="false"
            placeholder="例如：蓝发 / blue hair"
            aria-label="搜索 Danbooru Tag"
          /><button class="btn btn-primary" type="submit" disabled>搜索</button>
        </form>
        <div class="tags-filters" aria-label="Tag 类型筛选">
          <span class="tags-filter-label">类型</span
          ><button
            v-for="category in categories"
            :key="category.id"
            class="tag-filter"
            type="button"
            :aria-pressed="filters.includes(category.id)"
            @click="toggle(category.id)"
          >
            <i class="tag-category-dot" :class="category.css"></i
            >{{ category.name }}</button
          ><span class="tags-filter-sync">同步补全</span>
        </div>
      </section>
      <section class="tags-results" aria-busy="false">
        <div class="tags-results-head">
          <p role="status">输入关键词开始搜索</p>
          <span></span>
        </div>
        <div class="tags-grid"></div>
      </section>
      <footer class="tags-foot">
        搜索词会发送到在线双语 Tag 服务；英文查询在需要时回退至 Danbooru
        官方接口。
      </footer>
    </div>
    <aside class="tag-cart" id="tagCart" aria-label="Prompt Tag 组合">
      <header class="tag-cart-head">
        <div><strong>Prompt 组合</strong><span class="badge">0</span></div>
        <button
          class="ibtn ibtn-xs tag-cart-close"
          type="button"
          aria-label="关闭组合侧栏"
          @click="tags.cartOpen = false"
        >
          <AppIcon name="i-close" />
        </button>
      </header>
      <div class="tag-cart-list"></div>
      <p class="tag-cart-empty">从搜索结果添加 Tag</p>
      <footer class="tag-cart-foot">
        <button
          class="btn btn-primary btn-sm tag-cart-apply"
          type="button"
          disabled
        >
          <AppIcon name="i-send" />应用到生成器
        </button>
        <div class="tag-cart-foot-row">
          <button class="btn btn-quiet btn-sm" type="button" disabled>
            <AppIcon name="i-trash" />清空</button
          ><button class="btn btn-quiet btn-sm" type="button" disabled>
            <AppIcon name="i-copy" />复制
          </button>
        </div>
      </footer>
    </aside>
  </main>
  <button
    class="tag-cart-fab"
    type="button"
    aria-label="打开 Prompt 组合"
    aria-controls="tagCart"
    :aria-expanded="tags.cartOpen"
    @click="tags.cartOpen = true"
  >
    <AppIcon name="i-cart" /><span>0</span>
  </button>
  <button
    class="tag-cart-backdrop"
    type="button"
    aria-label="关闭组合侧栏"
    @click="tags.cartOpen = false"
  ></button>
</template>
