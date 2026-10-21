<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { useAsk } from "../app/ask";
import AppIcon from "../shared/AppIcon.vue";
import { keptParts } from "./draft/validate.ts";

defineProps<{ compact?: boolean }>();
defineEmits<{ review: [] }>();
const ask = useAsk(), plan = ask.draftPlan;
const originals = shallowRef<ReadonlySet<string>>(new Set());
watch([() => !!plan.value, ask.draftStatus], () => { originals.value = new Set(); });
const issues = computed(() => plan.value?.steps.some((s) => !!s.issue));
const currentStep = computed(() => plan.value?.steps.find((s) => s.enabled && !s.issue)?.id);
const count = computed(() => plan.value?.steps.filter((s) => s.enabled && !s.issue && s.before !== s.after).length ?? 0);
function original(id: string, on: boolean) {
  const next = new Set(originals.value);
  if (on) next.add(id); else next.delete(id);
  originals.value = next;
}
function apply(event: MouseEvent) {
  const button = event.currentTarget as HTMLButtonElement;
  void ask.applyDraft(button.dataset.fingerprint ?? "");
}
</script>
<template>
  <section v-if="plan" class="ask-draft" :class="{ compact }" aria-label="待确认草稿" :data-status="ask.draftStatus.value" :aria-busy="ask.writingDraft.value">
    <div v-if="ask.draftStatus.value === 'applied'" class="draft-done">
      <AppIcon name="i-check" />
      <span>{{ plan.workspace === 'image' ? '已写入表单 · 未生成' : '已写入输入框 · 未发送' }}</span>
      <button type="button" :disabled="!ask.canUndoDraft.value || ask.writingDraft.value || ask.running.value" :title="ask.canUndoDraft.value ? '撤销本次草稿' : '目标内容已变化，保留你的后续修改'" @click="ask.undoDraft()">撤销</button>
    </div>
    <template v-else>
      <header class="draft-head">
        <AppIcon name="i-edit" />
        <button v-if="compact" class="draft-title draft-review" type="button" aria-label="查看草稿修改" :title="plan.title" @click="$emit('review')"><strong>{{ plan.title }} · {{ count }} 处</strong><small>{{ plan.workspace === 'image' ? '应用后不会生成' : '应用后不会发送' }}</small></button>
        <div v-else class="draft-title"><strong>{{ plan.title }}</strong><small>{{ count }} 处 · {{ plan.workspace === 'image' ? '应用后不会生成' : '应用后不会发送' }}</small></div>
        <div class="draft-actions">
          <button class="btn btn-quiet btn-sm" type="button" :disabled="ask.writingDraft.value" @click="ask.ignoreDraft()">忽略<kbd>Esc</kbd></button>
          <button class="btn btn-primary btn-sm ask-draft-apply" type="button" :data-fingerprint="plan.fingerprint" :disabled="(!plan.changes.length && !plan.branch) || ask.writingDraft.value || ask.running.value" :aria-disabled="(!plan.changes.length && !plan.branch) || ask.writingDraft.value || ask.running.value" @click="apply">{{ ask.writingDraft.value ? '写入中…' : ask.draftApplyLabel.value }}<kbd>Tab</kbd></button>
        </div>
      </header>
      <p v-if="plan.aligned" class="draft-aligned">已按当前内容对齐，请核对后应用</p>
      <ol v-show="!compact" class="draft-steps" :class="{ multi: plan.steps.length > 1 }">
        <li v-for="(step, index) in plan.steps" :key="step.id" class="draft-step" :class="{ off: !step.enabled, invalid: !!step.issue, parameter: step.kind === 'parameter', cur: step.id === currentStep, changed: step.before !== step.after }" :data-step="step.id">
          <div class="draft-step-head">
            <span class="draft-number">{{ index + 1 }}</span><span class="draft-label">{{ step.label }}</span>
            <span v-if="step.locked" class="draft-lock">起点</span>
            <button v-else type="button" :disabled="!!step.issue || ask.writingDraft.value" :aria-label="`${step.enabled ? '撤回' : '恢复'} ${step.label}`" @click="ask.toggleDraftStep(step.id)">{{ step.enabled ? '撤回' : '恢复' }}</button>
          </div>
          <p v-if="step.issue" class="draft-issue">{{ step.issue }}</p>
          <div v-if="step.kind === 'parameter'" class="draft-values" :class="{ changed: step.before !== step.after }">
            <del v-if="step.before !== step.after">{{ step.displayBefore ?? (step.before || '随机') }}</del><strong>{{ step.displayAfter ?? (step.after || '随机') }}</strong>
          </div>
          <div v-else-if="step.kind === 'branch'" class="draft-slice">{{ step.after }}</div>
          <template v-else-if="step.kind === 'rewrite'">
            <div class="draft-tabs" role="group" :aria-label="`${step.label} 对照`">
              <button type="button" :aria-pressed="!originals.has(step.id)" @click="original(step.id, false)">新稿</button>
              <button type="button" :aria-pressed="originals.has(step.id)" @click="original(step.id, true)">原文</button>
            </div>
            <div class="draft-slice rewrite">
              <template v-if="originals.has(step.id)">{{ step.before || '（空）' }}</template>
              <template v-else><span v-for="(part, n) in keptParts(step.before, step.after)" :key="n" :class="{ keep: part.kept }">{{ part.text }}</span><span v-if="!step.after">（清空）</span><span v-if="plan.branch" class="draft-cursor" aria-hidden="true"></span></template>
            </div>
          </template>
          <div v-else class="draft-slice patch" :class="{ insertion: !step.before }"><span class="dim">{{ step.prefix }}</span><del v-if="step.before">{{ step.before }}</del><ins v-if="step.after">{{ step.after }}</ins><span class="dim">{{ step.suffix }}</span></div>
        </li>
      </ol>
      <footer v-if="issues" class="draft-conflict"><span>冲突步骤不会写入</span><button v-if="compact" type="button" @click="$emit('review')">核对草稿</button><button v-else type="button" :disabled="ask.writingDraft.value || ask.running.value" @click="ask.reproposeDraft()">基于当前内容重新提议</button></footer>
    </template>
  </section>
</template>
<style scoped>
.ask-draft { display: flex; flex: 0 1 auto; flex-direction: column; min-height: 0; max-height: min(30dvh, 240px); margin-bottom: 10px; overflow: hidden; color: var(--fg-2); background: var(--ask-layer, var(--raised)); border: 1px solid var(--line-2); border-radius: 16px; }
.draft-head { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px; }
.draft-head > .ico { flex: none; color: var(--a); }
.draft-title { flex: 1; min-width: 100px; overflow-wrap: anywhere; }
.draft-title strong { display: block; color: var(--fg); font-size: var(--fz-sm); font-weight: var(--fw-semibold); }
.draft-title small { display: block; margin-top: 3px; color: var(--fg-3); font-size: var(--fz-2xs); }
.draft-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; margin-left: auto; }
.draft-actions .btn { min-height: 30px; padding: 0 9px; }
.draft-actions kbd { margin-left: 5px; font: var(--fw-regular) 10px/1 var(--mono); opacity: .6; }
.draft-aligned { flex: none; padding: 0 14px 8px; color: var(--warn); font-size: var(--fz-xs); }
.draft-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 7px; min-height: 0; margin: 0; padding: 0 12px 12px; overflow-y: auto; list-style: none; overscroll-behavior: contain; }
.draft-step { position: relative; grid-column: 1 / -1; min-width: 0; transition: opacity var(--t1) var(--e); }
.draft-step.off { opacity: .3; }
.multi .draft-step:not(.parameter, :last-child)::after { position: absolute; top: 36px; bottom: -10px; left: 15px; width: 1px; content: ""; background: var(--line-2); }
.multi .draft-step:not(.parameter) > :not(.draft-step-head) { margin-left: 38px; }
.draft-step.cur .draft-number { color: var(--a); background: var(--a-dim); }
.draft-step.invalid { color: var(--fg-3); }
.draft-step-head { display: flex; align-items: center; gap: 6px; min-height: 30px; margin-bottom: 5px; font-size: var(--fz-xs); }
.draft-number { display: grid; flex: none; place-items: center; width: 32px; height: 32px; color: var(--fg-3); font-family: var(--mono); background: var(--ask-hover, var(--hover)); border-radius: 8px; }
.draft-lock { margin-left: auto; color: var(--fg-3); font-size: var(--fz-2xs); }
.draft-cursor { display: inline-block; width: 2px; height: 1em; margin-left: 3px; vertical-align: text-bottom; background: var(--a); animation: draft-caret 1s steps(1) infinite; }
@keyframes draft-caret { 50% { opacity: 0; } }
.draft-label { min-width: 0; overflow-wrap: anywhere; }
.draft-step-head > button { flex: none; margin-left: auto; padding: 4px; color: var(--fg-3); font-size: var(--fz-2xs); border-radius: 5px; }
.draft-step-head > button:hover { color: var(--fg); background: var(--ask-hover, var(--hover)); }
.draft-issue { padding: 0 0 6px; color: var(--warn); font-size: var(--fz-2xs); line-height: 1.5; overflow-wrap: anywhere; }
.draft-slice { padding: 9px 11px; font: var(--fw-regular) var(--fz-xs)/1.85 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; background: var(--ask-field, var(--sunken)); border-radius: 8px; }
.draft-slice.patch { border-left: 3px solid var(--a); }
.draft-slice.insertion { border-left-color: var(--ok); }
.draft-slice .dim { color: var(--fg-4); }
.draft-slice del { padding: 1px 3px; color: var(--err); background: color-mix(in srgb, var(--err) 12%, transparent); border-radius: 4px; }
.draft-slice ins { padding: 1px 3px; color: var(--ok); text-decoration: none; background: color-mix(in srgb, var(--ok) 12%, transparent); border-radius: 4px; }
.draft-slice .keep { text-decoration: underline; text-decoration-color: var(--a); text-decoration-thickness: 1.5px; text-underline-offset: 5px; }
.draft-tabs { display: flex; justify-content: flex-end; gap: 3px; margin: -3px 0 5px; }
.draft-tabs button { padding: 3px 6px; color: var(--fg-3); font-size: var(--fz-2xs); border-radius: 5px; }
.draft-tabs button[aria-pressed="true"] { color: var(--fg); background: var(--ask-hover, var(--hover)); }
.draft-step.parameter { grid-column: auto; padding: 7px; background: var(--ask-field, var(--sunken)); border: 1px solid var(--line); border-radius: 8px; }
.draft-step.parameter.changed:not(.invalid, .off) { box-shadow: inset 0 0 0 1.5px var(--a); }
.parameter .draft-step-head { flex-wrap: wrap; gap: 3px; }
.parameter .draft-number { display: none; }
.parameter .draft-label { flex: 1 1 40px; }
.draft-values { display: flex; flex-wrap: wrap; gap: 4px 6px; font: var(--fw-regular) var(--fz-xs)/1.6 var(--mono); overflow-wrap: anywhere; opacity: .4; }
.draft-values.changed { opacity: 1; }
.draft-values del { color: var(--fg-4); }
.draft-values strong { color: var(--a); font-weight: var(--fw-semibold); }
.draft-conflict { display: flex; flex: none; flex-wrap: wrap; justify-content: space-between; gap: 6px; padding: 8px 12px 12px; color: var(--fg-3); font-size: var(--fz-2xs); }
.draft-conflict button { color: var(--a); text-decoration: underline; text-underline-offset: 3px; }
.draft-done { display: flex; align-items: center; gap: 8px; padding: 11px 13px; color: var(--fg-3); font-size: var(--fz-xs); }
.draft-done > .ico { color: var(--ok); }
.draft-done button { flex: none; margin-left: auto; padding: 5px; color: var(--a); }
.draft-done button:disabled { color: var(--fg-4); }
.compact { flex: none; max-height: none; margin-bottom: 0; border: 0; border-radius: 12px; }
.compact .draft-head { flex-wrap: nowrap; gap: 8px; padding: 8px 6px 8px 10px; }
.compact .draft-head > .ico { width: 16px; height: 16px; }
.compact .draft-title { min-width: 0; text-align: left; line-height: 1.35; }
.compact .draft-title strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.compact .draft-title small { margin-top: 2px; font-size: 11.5px; white-space: nowrap; }
.draft-review:hover strong { color: var(--a); }
.compact .draft-actions { flex: none; flex-wrap: nowrap; gap: 2px; margin-left: 0; }
.compact .draft-actions .btn { min-height: 28px; padding: 0 7px; font-size: 12.5px; border-radius: 8px; }
.compact .draft-actions kbd { margin-left: 4px; padding: 2px 3px; font-size: 10.5px; border: 1px solid var(--line-2); border-radius: 5px; }
.compact .draft-aligned, .compact .draft-conflict { padding: 0 10px 8px; }
@media (max-width: 860px) {
  .draft-actions kbd { display: none; }
  .draft-actions .btn, .draft-done button, .draft-step-head > button, .draft-tabs button { min-height: 36px; }
}
@media (max-width: 360px) {
  .compact .draft-head { flex-wrap: wrap; }
  .compact .draft-title { flex: 1 1 180px; }
  .compact .draft-actions { margin-left: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .draft-step { transition: none; }
  .draft-cursor { animation: none; }
}
</style>
