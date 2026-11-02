<script setup lang="ts">
import { computed } from "vue";
import { useDrawing } from "../../app/drawing";
import { message, useUi } from "../../app/ui";
import { findModel } from "../../domain/models";
import BoardMenu from "../../shared/boards/BoardMenu.vue";
import AiNameButton from "../../shared/AiNameButton.vue";
const { drawing, view } = useDrawing(), ui = useUi();
const items = computed(() => view.value.boards.map(board => ({
  id: board.id, name: board.name, color: board.color,
  tags: [modelTag(board.form.model), ...(board.form.characters.length ? [`${board.form.characters.length} 角色`] : [])],
  removeDisabled: view.value.boards.length === 1,
})));
const footer = [{ id: "create", label: "新建空白", icon: "i-plus" }, { id: "copy", label: "复制当前", icon: "i-copy" }];
function modelTag(id: string) { return id.includes("4-5") ? "V4.5" : id.includes("diffusion-5") ? "V5" : findModel(id)?.name ?? id; }
async function run(action: () => Promise<unknown>) { try { await action(); } catch (error) { ui.toast(message(error), "err"); } }
async function remove(id: string) {
  const board = view.value.boards.find(b => b.id === id); if (!board) return;
  if (await ui.confirm({ title: `删除画板“${board.name}”？`, message: "历史与收藏会保留。", confirmLabel: "删除", tone: "danger" })) await run(() => drawing.removeBoard(id));
}
</script>
<template>
  <BoardMenu id="boardMenu" action-prefix="boardActions" :items="items" :active-id="view.activeBoardId" create-label="新建空白画板" remove-label="删除画板" :footer="footer"
    @select="id => run(() => drawing.switchBoard(id))" @rename="(id, name) => run(() => drawing.renameBoard(id, name))" @remove="remove"
    @create="run(() => drawing.createBoard(false))" @action="id => run(() => drawing.createBoard(id === 'copy'))">
    <template #currentActions="{ id }"><AiNameButton class="bd-ai" kind="board" :id="id" /></template>
  </BoardMenu>
</template>
