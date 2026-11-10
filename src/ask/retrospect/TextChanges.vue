<script setup lang="ts">
import type { TextField } from './groups.ts';
import { computed } from 'vue';
import { textHunks } from './text-diff.ts';
const props = defineProps<{ field: TextField; full?: boolean; hasBaseline?: boolean }>();
const hunks = computed(() => textHunks(props.field.before ?? '', props.field.after ?? ''));
</script>
<template>
  <p v-if="!hasBaseline" class="text-original">{{ field.after === '' ? '空' : field.after ?? '未记录' }}</p>
  <div v-else-if="full" class="full-pair">
    <div v-for="side in (['before', 'after'] as const)" :key="side" class="full-row"><small>{{ side === 'before' ? 'A' : 'B' }}</small><p><template v-for="(part, i) in field.parts" :key="i"><span v-if="part.kind === 'same'">{{ part.text }}</span><del v-else-if="side === 'before' && part.kind === 'del'">{{ part.text }}</del><ins v-else-if="side === 'after' && part.kind === 'ins'">{{ part.text }}</ins></template><template v-if="field[side] === null">未记录</template><template v-else-if="field[side] === ''">空</template></p></div>
  </div>
  <template v-else>
    <p v-if="field.before === null || field.after === null" class="missing">{{ field.before === null ? '基准未记录' : '此版未记录' }}</p>
    <div v-for="(hunk, i) in hunks" :key="i" class="change-hunk">
      <template v-for="side in (['before', 'after'] as const)" :key="side"><div v-if="hunk[side]" class="change-line" :class="side === 'before' ? 'del' : 'ins'"><span class="sign">{{ side === 'before' ? '−' : '+' }}</span><span class="text"><template v-for="(part, j) in hunk.parts" :key="j"><span v-if="part.kind === 'same'">{{ part.text }}</span><del v-else-if="side === 'before' && part.kind === 'del'">{{ part.text }}</del><ins v-else-if="side === 'after' && part.kind === 'ins'">{{ part.text }}</ins></template></span></div></template>
    </div>
    <details v-if="!field.changed" class="unchanged"><summary>未改动</summary><p class="text-original">{{ field.after === '' ? '空' : field.after ?? '未记录' }}</p></details>
  </template>
</template>
<style scoped>
/* The read-only hunk follows DraftCard.vue .draft-hunk / .draft-line / .draft-sign. */
.change-hunk { overflow: hidden; border-radius: 6px; }
.change-line { display: grid; grid-template-columns: 22px minmax(0, 1fr); padding: 4px 8px 4px 0; color: var(--fg); font-size: var(--fz-sm); line-height: 1.6; }
.sign { padding-left: 7px; font-weight: var(--fw-medium); }
.text { min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.change-line.del { color: var(--fg-2); background: var(--diff-del); }
.change-line.ins { background: var(--diff-ins); }
.del .sign { color: var(--err); }
.ins .sign { color: var(--ok); }
.text-original, .full-row p { color: var(--fg-2); font-size: var(--fz-sm); line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
.full-pair { display: grid; gap: 10px; }
.full-row { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 6px; }
.full-row small { color: var(--fg-3); font: var(--fz-2xs)/1.75 var(--mono); padding-top: 2px; }
.full-row del, .change-line del { background: var(--diff-del-strong); text-decoration-color: var(--err); }
.full-row ins, .change-line ins { background: var(--diff-ins-strong); text-decoration: none; }
.full-row :is(del, ins) { padding: 1px 2px; border-radius: 3px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.missing, .unchanged summary { color: var(--fg-3); font-size: var(--fz-xs); margin: 0; }
.unchanged summary { cursor: pointer; padding: 4px 0; }
.unchanged p { margin: 6px 0; }
</style>
