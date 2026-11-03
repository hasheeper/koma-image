<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppIcon from "../shared/AppIcon.vue";
import ModelLogos from "../shared/ModelLogos.vue";
import BoardMenu from "../shared/boards/BoardMenu.vue";
import PopoverMenu from "../shared/ui/PopoverMenu.vue";
import NaiSelect from "../shared/nai/NaiSelect.vue";
import GuidanceControl from "../shared/nai/GuidanceControl.vue";
import ConnectionsSection from "../overlays/settings/ConnectionsSection.vue";
import type { Routing } from "../config/connections";
const theme = ref("dark"), state = ref("idle"), disabled = ref(false), showMenus = ref(true);
const choice = ref("high"), guidance = ref(5), variety = ref(false), active = ref("demo-1"), notice = ref("等待操作");
watch(theme, value => { document.documentElement.dataset.theme = value; }, { immediate: true });
const items = ref([
  { id: "demo-1", name: "画板示例", color: "var(--a)", tags: ["V5", "2 角色"] },
  { id: "demo-2", name: "长名称与空白画板", color: "var(--warn)", tags: [] },
]);
let sequence = 2;
const footer = [{ id: "create", label: "新建空白", icon: "i-plus" }, { id: "copy", label: "复制当前", icon: "i-copy" }];
function create() { const id = `demo-${++sequence}`; items.value.push({ id, name: `画板 ${sequence}`, color: "var(--a)", tags: [] }); active.value = id; }
function rename(id: string, name: string) { const item = items.value.find(b => b.id === id); if (item) item.name = name; notice.value = `已重命名：${name}`; }
function remove(id: string) { if (items.value.length < 2) return; items.value = items.value.filter(b => b.id !== id); if (active.value === id) active.value = items.value[0]!.id; }
const boardItems = computed(() => items.value.map(b => ({ ...b, removeDisabled: items.value.length === 1 })));
const routing: Routing = {
  version: 1, links: {}, connections: {
    demo: { id: "demo", name: "示例供应商", baseUrl: "https://gateway.example.test", profileId: "koma-standard-v1", credentialRef: "unused", revision: "preview" },
  },
};
const statuses = computed(() => ({ demo: state.value === "error" ? { s: "err", text: "示例错误：连接暂不可用" } : state.value === "loading" ? { s: "wait", text: "检查中…" } : { s: "ok", text: "可用 · 仅示例数据" } }));
const raw = { demo: { models: { "gpt-image-2": { name: "GPT Image 2", operations: ["generate", "edit"] } } } };
const balances = { demo: { credits: { remaining: 120 }, images: { openai: { remaining: 8, limit: 10 } } } };
</script>
<template>
  <main class="ui-preview">
    <ModelLogos />
    <header class="preview-head"><h1>Koma UI</h1><p>开发预览 · 使用现有组件与样式，数据仅保留在此页内存。</p></header>
    <div class="preview-controls">
      <label>主题<select v-model="theme" aria-label="预览主题"><option value="dark">暗色</option><option value="light">亮色</option></select></label>
      <label>状态<select v-model="state" aria-label="预览状态"><option value="idle">正常</option><option value="loading">加载</option><option value="error">错误</option></select></label>
      <label><input v-model="disabled" type="checkbox" />禁用控件</label>
      <label><input v-model="showMenus" type="checkbox" />显示画板菜单</label>
    </div>
    <section class="preview-section"><h2>控件与参数</h2>
      <div class="preview-row"><button class="btn btn-primary" :disabled="disabled || state === 'loading'" :aria-busy="state === 'loading'" @click="notice = '主操作'">{{ state === 'loading' ? '处理中…' : '主操作' }}</button><button class="btn btn-quiet" :disabled="disabled" @click="notice = '次操作'">次操作</button><button class="ibtn" :disabled="disabled" aria-label="示例设置" @click="notice = '设置'"><AppIcon name="i-settings" /></button></div>
      <div class="preview-fields"><label class="fld">输入框<input type="text" placeholder="示例文本" :disabled="disabled" :aria-invalid="state === 'error'" /></label><div class="fld"><label for="preview-choice">档位菜单</label><NaiSelect id="preview-choice" label="示例档位" :disabled="disabled" :value="choice" :options="[{value:'high',label:'High'},{value:'medium',label:'Medium'},{value:'unavailable',label:'不可用',disabled:true}]" @change="choice = $event" /></div><GuidanceControl id="preview-guidance" v-model="guidance" v-model:variety-plus="variety" official /></div>
      <p v-if="state === 'error'" class="modal-error" role="alert">示例错误：请检查输入。</p>
    </section>
    <section class="preview-section"><h2>画板与操作菜单</h2>
      <div class="preview-boards">
        <KeepAlive><BoardMenu v-if="showMenus" id="preview-board-image" action-prefix="preview-image-actions" :active-id="active" :items="boardItems" :footer="footer" create-label="新建画板" remove-label="删除画板" trigger-label="IMAGE 示例画板" @select="active = $event" @create="create" @action="create" @rename="rename" @remove="remove" /></KeepAlive>
        <KeepAlive><BoardMenu v-if="showMenus" id="preview-board-edit" action-prefix="preview-edit-actions" :active-id="active" :items="boardItems" :footer="footer" create-label="新建编辑画板" remove-label="关闭画板" trigger-label="EDIT 示例画板" @select="active = $event" @create="create" @action="create" @rename="rename" @remove="remove" /></KeepAlive>
      </div>
      <PopoverMenu id="preview-actions" label="示例操作" side="right" compact>
        <template #trigger="slot"><button class="btn btn-quiet" aria-haspopup="menu" :aria-expanded="slot.open" @click="slot.toggle">操作菜单<AppIcon name="i-more" /></button></template>
        <template #default="slot"><button class="menu-item" role="menuitem" @click="notice = '已选择操作'; slot.close(true)"><AppIcon name="i-check" />选择操作</button><button class="menu-item" role="menuitem" disabled>不可用操作</button></template>
      </PopoverMenu>
    </section>
    <section class="preview-section set-ui"><h2>连接列表</h2><ConnectionsSection active :local="false" :busy="disabled" :testing="state === 'loading' ? 'demo' : null" :routing="routing" :raw="raw" :balances="balances" :statuses="statuses" :ask-counts="{}" current-ask-connection="" current-ask-model="" @add="notice = '配置供应商（预览）'" @edit="notice = '编辑供应商（预览）'" @remove="notice = '删除供应商（预览）'" @test="notice = '测试连接（预览，不发送请求）'" @models="notice = '查看模型（预览）'" @ask-models="notice = 'ASK 模型（预览）'" @move="notice = '调整顺序（预览）'" /></section>
    <p class="preview-notice" role="status">{{ notice }}</p>
    <section class="preview-section"><h2>维护入口</h2><p>通用行为：<code>shared/ui</code>；画板呈现：<code>shared/boards</code>；NAI 组合控件：<code>shared/nai</code>；设置专用组件：<code>overlays/settings</code>。完整归属见 <code>docs/engineering/ui-maintenance.md</code>。</p></section>
  </main>
</template>
<style scoped>
.ui-preview { position: fixed; inset: 0; overflow: auto; padding: 32px max(16px, calc((100vw - 1040px) / 2)); background: var(--canvas); color: var(--fg); }
.preview-head { margin-bottom: 24px; }
.preview-head h1 { font-family: var(--brand); font-size: 32px; }
.preview-head p, .preview-section > p { color: var(--fg-3); }
.preview-controls, .preview-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.preview-controls label { display: flex; align-items: center; gap: 8px; }
.preview-controls select { width: 100px; }
.preview-section { margin-block: 28px; padding: 20px; border: 1px solid var(--line); border-radius: var(--r3); background: var(--chrome); }
.preview-section h2 { font-size: var(--fz-lg); margin-bottom: 18px; }
.preview-fields, .preview-boards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin-block: 20px; }
.preview-fields .guidance { grid-column: 1 / -1; }
.preview-boards { margin-block: 24px; }
.preview-notice { color: var(--a); }
@media (max-width: 640px) { .preview-fields, .preview-boards { grid-template-columns: minmax(0, 1fr); } }
</style>
