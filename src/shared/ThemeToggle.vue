<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { themeChoices, useTheme } from "../app/theme";
import { message, useUi } from "../app/ui";
import AppIcon from "./AppIcon.vue";

const theme = useTheme(), ui = useUi();
const pending = shallowRef(false);
const current = computed(() => themeChoices[theme.choice.value]);
const next = computed(() => theme.choice.value === "dark" ? "light" : "dark");
const label = computed(() => `切换到${themeChoices[next.value].label}`);
async function toggle() {
  if (pending.value) return;
  pending.value = true;
  try { await theme.set(next.value); }
  catch (error) { ui.toast(message(error), "err"); }
  finally { pending.value = false; }
}
</script>
<template>
  <button class="ibtn theme-toggle" type="button" :disabled="pending"
    :aria-label="label" :data-tip="`当前${current.label} · ${label}`" @click="toggle">
    <AppIcon :name="current.icon" />
  </button>
</template>
