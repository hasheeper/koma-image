<script setup lang="ts">
import { useAskPresentation } from './presentation.ts';
defineProps<{ progress?: boolean }>();
const { activity, completed } = useAskPresentation();
</script>
<template>
  <span v-if="progress" class="ask-progress" :class="{ empty: !completed }" :title="`${completed} 项工具已完成`">{{ completed > 99 ? '99+' : completed }}✓</span>
  <span v-else :key="activity.key" class="ask-activity" :title="`${activity.verb} ${activity.object} ${activity.stat}`"><span class="ask-verb">{{ activity.verb }}</span><span v-if="activity.object" class="ask-object">{{ activity.object }}</span><span v-if="activity.stat" class="ask-stat">{{ activity.stat }}</span></span>
</template>
<style scoped>
.ask-activity { display: flex; flex: 1; align-items: baseline; gap: 6px; min-width: 0; overflow: hidden; font-size: 13px; line-height: 1; white-space: nowrap; animation: ask-activity-in .22s var(--e); }
.ask-verb { flex: none; color: var(--fg-3); font-weight: var(--fw-regular); }
.ask-object { min-width: 0; overflow: hidden; font-weight: var(--fw-medium); text-overflow: ellipsis; background: linear-gradient(90deg, var(--fg-3) 0% 26%, color-mix(in srgb, var(--fg) 22%, var(--fg-3)) 35%, color-mix(in srgb, var(--fg) 72%, var(--fg-3)) 44%, var(--fg) 50%, color-mix(in srgb, var(--fg) 72%, var(--fg-3)) 56%, color-mix(in srgb, var(--fg) 22%, var(--fg-3)) 65%, var(--fg-3) 74% 100%) 130% 0 / 200% 100%; background-clip: text; color: transparent; animation: ask-shimmer 2.4s linear infinite; }
.ask-stat { flex: none; color: var(--fg-4); font: var(--fw-regular) 11.5px/1 var(--mono); font-variant-numeric: tabular-nums; }

.ask-progress { display: grid; flex: none; place-items: center; width: 34px; height: 20px; padding: 0 4px; color: var(--fg-3); font: var(--fw-medium) 11px/1 var(--mono); font-variant-numeric: tabular-nums; background: var(--ask-hover); border-radius: 10px; transition: opacity .15s var(--e); }
.ask-progress.empty { opacity: 0; }
@keyframes ask-activity-in { from { opacity: 0; transform: translateY(2px); } }
@keyframes ask-shimmer { from { background-position: 130% 0; } to { background-position: -70% 0; } }
@media (prefers-reduced-motion: reduce) { .ask-activity, .ask-object { animation: none; } .ask-object { color: var(--fg); background: none; } }
</style>
