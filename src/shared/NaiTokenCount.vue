<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useNaiComposer } from "../app/nai-composer";
import { compileNaiPrompt } from "../domain/nai";
import { naiInputLimits, naiInputParts, naiTextLength } from "../domain/nai-input";
import { countNaiTokens } from "../native/nai-tokenizer";
const props = defineProps<{ field: "prompt" | "negative"; text: string; character?: string }>();
const composer = useNaiComposer();
const input = computed(() => {
  if (composer.input) return composer.input.value;
  const { form, model } = composer.view.value;
  const compiled = compileNaiPrompt(form, model ?? { id: form.model, transparentBackground: false });
  return { model: form.model, prompt: compiled.prompt, negative_prompt: compiled.negative_prompt, characters: form.characters };
});
const result = ref<Awaited<ReturnType<typeof countNaiTokens>>>(null), failed = ref(false);
let revision = 0, timer: ReturnType<typeof setTimeout> | undefined;
watch(() => JSON.stringify(input.value), () => {
  const payload = input.value;
  const token = ++revision; clearTimeout(timer); result.value = null; failed.value = false;
  if (!naiInputLimits(payload.model)) return;
  timer = setTimeout(() => { void countNaiTokens(payload).then(value => { if (token === revision) result.value = value; }).catch(() => { if (token === revision) failed.value = true; }); }, 150);
}, { immediate: true });
onBeforeUnmount(() => { revision++; clearTimeout(timer); });
const limits = computed(() => naiInputLimits(input.value.model));
const total = computed(() => result.value?.[props.field].reduce((n, v) => n + v, 0));
const own = computed(() => result.value?.[props.field][props.character ? result.value.ids.indexOf(props.character) : 0] ?? 0);
const textCount = computed(() => naiInputParts(input.value).prompt.reduce((n, text) => n + naiTextLength(text), 0));
const over = computed(() => !!limits.value && ((total.value ?? 0) > limits.value.tokens || textCount.value > limits.value.text));
const title = computed(() => !limits.value ? `${props.text.length} 字符` : failed.value ? "NAI token 计数暂不可用" : !result.value ? "正在计算 NAI tokens" :
  `${own.value} tokens；基础与启用角色合计 ${total.value}/${limits.value.tokens}（含生效预设）${(total.value ?? 0) > limits.value.tokens ? '；超出部分可能被上游截断' : ''}${textCount.value ? `；Text: ${textCount.value}/${limits.value.text} 字符` : ''}`);
</script>
<template>
  <span class="tab-count" :class="{ 'nai-over': over }" :data-filled="text.length ? '1' : undefined" :title="title" :aria-label="title" :data-budget="limits?.tokens">{{ !limits ? text.length : result ? character ? own : total : failed ? '—' : '…' }}</span>
</template>
<style scoped>
.tab-count.nai-over { color: var(--warn); }
</style>
