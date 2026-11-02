<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { useEditor } from "../../app/editor";
import { message, useUi } from "../../app/ui";
import { findModel } from "../../domain/models";
import BoardMenu from "../../shared/boards/BoardMenu.vue";
const { editor, view } = useEditor(), ui = useUi();
const emit = defineEmits<{ openImage: [] }>();
const menu = shallowRef<InstanceType<typeof BoardMenu>>();
const items = computed(() => view.value.boards.map(board => {
  const session = editor.board(board.id)!;
  const model = session.chosen[session.mode];
  return { id: board.id, name: board.name, color: typeof session.provenance.boardColor === "string" ? session.provenance.boardColor : "var(--a)",
    tags: [...(model ? [modelTag(model)] : []), ...(board.busy ? ["运行中"] : []), ...(session.characters.length ? [`${session.characters.length} 角色`] : [])],
    removeDisabled: board.busy };
}));
const footer = [{ id: "create", label: "新建空白", icon: "i-plus" }, { id: "open", label: "打开图片", icon: "i-upload" }];
function modelTag(id: string) { return id.includes("4-5") ? "V4.5" : id.includes("diffusion-5") ? "V5" : findModel(id)?.name ?? id; }
function run(action: () => unknown) { try { action(); } catch (error) { ui.toast(message(error), "err"); } }
async function remove(id: string) {
  const board = view.value.boards.find(b => b.id === id); if (!board) return;
  if (await ui.confirm({ title: `关闭画板“${board.name}”？`, message: "编辑版本、蒙版和 Photopea 分层将释放，已保存的历史与收藏保留。", confirmLabel: "关闭", tone: "danger" }))
    run(() => { if (!editor.removeBoard(id)) ui.toast("请先完成当前编辑操作"); });
}
defineExpose({ close: () => menu.value?.close() });
</script>
<template>
  <BoardMenu ref="menu" id="editBoardMenu" action-prefix="editBoardActions" :items="items" :active-id="view.session.id" trigger-label="切换编辑画板" create-label="新建编辑画板" remove-label="关闭画板" :footer="footer"
    @select="id => run(() => editor.switchBoard(id))" @rename="(id, name) => run(() => editor.renameBoard(id, name))" @remove="remove"
    @create="run(() => editor.createBoard())" @action="id => id === 'open' ? emit('openImage') : run(() => editor.createBoard())" />
</template>
