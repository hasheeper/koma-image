<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";
import AppIcon from "../shared/AppIcon.vue";

const props = defineProps<{ id: number; question: string; hasAttachments?: boolean }>(), emit = defineEmits<{ cancel: [] }>(), ask = useAsk();
const text = shallowRef(props.question), field = shallowRef<HTMLTextAreaElement | null>(null);
function resize() {
  const el = field.value;
  if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
}
function cancel() { if (ask.canManage.value) emit("cancel"); }
async function submit() {
  if (!ask.canManage.value || (!text.value.trim() && !props.hasAttachments)) return;
  if (!await ask.editTurn(props.id, text.value)) {
    await nextTick();
    field.value?.focus({ preventScroll: true });
  }
}
function key(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  void submit();
}
// Registered only while mounted; later-opened popovers take Esc first.
const stopLayer = ask.layer(() => { if (ask.running.value) return false; cancel(); return true; });
watch(text, () => nextTick(resize));
watch(ask.running, on => { if (!on) void nextTick(() => field.value?.focus({ preventScroll: true })); });
onMounted(() => {
  resize();
  field.value?.focus({ preventScroll: true });
  field.value?.setSelectionRange(text.value.length, text.value.length);
  field.value?.closest(".ask-edit")?.scrollIntoView({ block: "nearest" });
});
onBeforeUnmount(stopLayer);
</script>
<template>
  <form class="ask-edit" :aria-busy="ask.writingDraft.value || ask.running.value" @submit.prevent="submit">
    <textarea ref="field" v-model="text" aria-label="编辑提问" rows="1" maxlength="4000" :disabled="!ask.canManage.value" @keydown="key"></textarea>
    <div class="ask-edit-bar">
      <button class="ask-edit-cancel" type="button" :disabled="!ask.canManage.value" @click="cancel">取消</button>
      <button class="btn btn-primary ask-edit-send" type="submit" aria-label="重新回答" title="删除这条之后的对话，撤回其中的草稿，重新回答" :disabled="!ask.canManage.value || (!text.trim() && !hasAttachments) || !!ask.preparing.value"><AppIcon name="i-up" /></button>
    </div>
  </form>
</template>
<style scoped>
.ask-edit { align-self: stretch; margin-bottom: 10px; padding: 9px 8px 8px 15px; background: var(--ask-hover); border: 1px solid var(--line-2); border-radius: 18px; }
.ask-edit textarea { display: block; width: 100%; max-height: 40dvh; padding: 0 6px 0 0; color: var(--fg); font: var(--fw-regular) 13px/1.6 var(--sans); background: none; border: 0; box-shadow: none; outline: none; resize: none; }
.ask-edit textarea:focus { outline: none; box-shadow: none; }
.ask-edit-bar { display: flex; justify-content: flex-end; align-items: center; gap: 4px; margin-top: 6px; }
.ask-edit-cancel { height: 28px; padding: 0 10px; color: var(--fg-2); font-size: 13px; border-radius: 8px; }
.ask-edit-cancel:hover { color: var(--fg); background: var(--ask-hover); }
.ask-edit-send { display: grid; place-items: center; width: 28px; height: 28px; min-height: 0; padding: 0; border-radius: 50%; }
.ask-edit-send .ico { width: 16px; height: 16px; stroke-width: 2; }
@media (hover: none) { .ask-edit-cancel { height: 36px; } .ask-edit-send { width: 36px; height: 36px; } }
</style>
