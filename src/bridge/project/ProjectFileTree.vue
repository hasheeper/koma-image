<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from 'vue';
import AppIcon from '../../shared/AppIcon.vue';
import { projectFileTree, visibleProjectTree } from './file-tree.ts';
import type { ProjectTreeFile, ProjectTreeRow } from './file-tree.ts';

const props = defineProps<{ files: readonly ProjectTreeFile[]; selected?: string; collapsed: ReadonlySet<string>; search: string }>();
const emit = defineEmits<{ select: [path: string]; 'update:collapsed': [value: ReadonlySet<string>] }>();
const host = shallowRef<HTMLElement>(), focused = shallowRef(''), searchCollapsed = shallowRef<ReadonlySet<string>>(new Set());
const searching = computed(() => !!props.search.trim());
const collapsed = computed(() => searching.value ? searchCollapsed.value : props.collapsed);
const rows = computed(() => visibleProjectTree(projectFileTree(props.files), collapsed.value));
const focusPath = computed(() => rows.value.some(row => row.node.path === focused.value) ? focused.value
  : rows.value.some(row => row.node.path === props.selected) ? props.selected : rows.value[0]?.node.path);
watch(() => props.search, () => { searchCollapsed.value = new Set(); });

function toggle(row: ProjectTreeRow) {
  if (row.node.kind !== 'folder') return;
  const next = new Set(collapsed.value);
  if (next.has(row.node.path)) next.delete(row.node.path); else next.add(row.node.path);
  if (searching.value) searchCollapsed.value = next; else emit('update:collapsed', next);
}
function activate(row: ProjectTreeRow) {
  focused.value = row.node.path;
  if (row.node.kind === 'folder') toggle(row); else emit('select', row.node.path);
}
async function focus(path: string | undefined) {
  if (!path) return;
  focused.value = path;
  await nextTick();
  Array.from(host.value?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? []).find(button => button.dataset.path === path)?.focus();
}
function keydown(event: KeyboardEvent, row: ProjectTreeRow) {
  const index = rows.value.indexOf(row), key = event.key;
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
  event.preventDefault();
  if (key === 'ArrowDown') void focus(rows.value[index + 1]?.node.path);
  else if (key === 'ArrowUp') void focus(rows.value[index - 1]?.node.path);
  else if (key === 'Home') void focus(rows.value[0]?.node.path);
  else if (key === 'End') void focus(rows.value.at(-1)?.node.path);
  else if (key === 'ArrowLeft') {
    if (row.node.kind === 'folder' && !collapsed.value.has(row.node.path)) toggle(row);
    else void focus(row.parent ?? undefined);
  } else if (row.node.kind === 'folder') {
    if (collapsed.value.has(row.node.path)) toggle(row);
    else void focus(rows.value[index + 1]?.node.path);
  }
}
function hint(row: ProjectTreeRow) {
  if (row.node.kind === 'folder') return row.node.path;
  const { path, name, file } = row.node;
  const title = file.title === name || file.title === name.replace(/\.[^.]+$/, '') ? '' : file.title;
  return [...new Set([path, title, file.note].filter(Boolean))].join('\n');
}
</script>

<template>
  <div ref="host" class="project-file-tree" role="tree" aria-label="企划资料列表">
    <button v-for="row in rows" :key="row.node.kind+':'+row.node.path" type="button" role="treeitem" class="tree-row"
      :class="{folder:row.node.kind==='folder',selected:row.node.kind==='file' && selected===row.node.path}"
      :data-path="row.node.path" :aria-label="row.node.name" :aria-level="row.depth+1" :aria-posinset="row.position" :aria-setsize="row.size"
      :aria-expanded="row.node.kind==='folder' ? !collapsed.has(row.node.path) : undefined" :aria-selected="row.node.kind==='file' ? selected===row.node.path : undefined"
      :tabindex="focusPath===row.node.path ? 0 : -1" :title="hint(row)" @focus="focused=row.node.path" @click="activate(row)" @keydown="keydown($event,row)">
      <span class="tree-indent" aria-hidden="true"><i v-for="depth in row.depth" :key="depth"/></span>
      <AppIcon v-if="row.node.kind==='folder'" name="i-chevron" class="tree-caret" :class="{open:!collapsed.has(row.node.path)}"/>
      <AppIcon v-else :name="row.node.file.image ? 'i-image' : row.node.path.startsWith('slates/') ? 'i-tasks' : 'i-file'" class="tree-icon"/>
      <span class="tree-name">{{ row.node.name }}</span>
      <AppIcon v-if="row.node.kind==='file' && row.node.file.warning" name="i-warning" class="tree-warning" :aria-label="row.node.file.note"/>
    </button>
  </div>
</template>

<style scoped>
.project-file-tree { flex: 1; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.tree-row { display: flex; align-items: center; width: 100%; min-width: 0; min-height: 32px; padding: 0 var(--sp-2); color: var(--fg-2); font-size: var(--fz-sm); text-align: left; border-radius: var(--r2); }
.tree-row:hover { background: var(--hover); }
.tree-row.selected { color: var(--fg); background: var(--nav-active-bg); }
.tree-row:focus-visible { outline: 1px solid var(--focus-line); outline-offset: -1px; }
.tree-indent { display: flex; flex: none; align-self: stretch; }
.tree-indent i { position: relative; display: block; width: var(--sp-4); }
.tree-indent i::before { position: absolute; top: 0; bottom: 0; left: 6px; border-left: 1px solid var(--line); content: ''; }
.tree-caret, .tree-icon { flex: none; color: var(--fg-3); --ico: var(--ico-sm); }
.tree-caret.open { transform: rotate(90deg); }
.tree-name { min-width: 0; padding: 6px 0 6px var(--sp-2); overflow: hidden; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.folder { color: var(--fg-3); }
.folder .tree-name { font-weight: var(--fw-medium); }
.selected .tree-icon { color: var(--a); }
.tree-warning { flex: none; margin-left: auto; color: var(--warn); --ico: var(--ico-sm); }
@media (pointer: coarse) { .tree-row { min-height: 40px; } }
</style>
