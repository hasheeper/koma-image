import { naiCapabilities } from "../../domain/nai.ts";
import type { DrawingForm } from "../../domain/drawing.ts";
import type { EditDraftState, EditConfiguration } from "../../domain/edit-draft.ts";
import { object } from "../../domain/value.ts";
import { naiAwareness } from "../../services/nai-awareness.ts";
import { editAwareness } from "../../services/edit-awareness.ts";
import { validateDraft } from "./validate.ts";
import type { Draft } from "./types.ts";

interface InputReaders {
  image(form: DrawingForm): Promise<unknown>;
  edit(state: EditDraftState): Promise<unknown>;
}

/** Text: has no terminator. Only explicit trailing prompt structure is a hard error;
 * commas, unquoted text and multiline dialogue alone are not placement evidence. */
export function textPlacementIssue(prompt: string): string | null {
  const marker = /\bText:\s*/i.exec(prompt);
  if (!marker) return null;
  const tail = prompt.slice(marker.index + marker[0].length).trim();
  const quote = /^(?:"(?:\\.|[^"\\])*"|“[^”]*”|「[^」]*」|『[^』]*』)/u;
  let rest = tail, quoted = false;
  while (quote.test(rest)) {
    quoted = true;
    rest = rest.replace(quote, '').replace(/^[\s,，;；.!?。！？…]+/, '');
  }
  const structural = /(?:^|\n)\s*(?:<(?:artist|style|scene|character)\b|(?:Character\s+\d+|Prompt|Negative|Style|Caption)\s*:)/i.test(tail);
  if (structural || quoted && rest) return 'Text: 文字段后还有描述结构；请将画面描述移到 Text: 前，Text: 留在该字段末尾';
  return null;
}

function mediumWrite(draft: Draft) {
  const fixed = ['steps', 'sampler', 'cfgRescale', 'negativePreset'];
  return draft.steps.some(step =>
    step.kind === 'prompt_patch' && step.target.endsWith('negative') ||
    step.kind === 'params_patch' && Object.keys(step.params).some(k => fixed.includes(k)) ||
    step.kind === 'character_edit' && !!step.negative ||
    step.kind === 'restore_partial' && step.fields.some(k => fixed.includes(k) || k === 'negative_prompt' ||
      k === 'characters' && Array.isArray(step.values.characters) && step.values.characters.some(c => object(c).negative)));
}

/** Internal preflight. It never writes a form, allocates a role ID, or requests a quote. */
export async function checkNaiInput(proposal: Draft, readers?: InputReaders) {
  const draft = proposal.editHandoff?.proposal ?? proposal;
  if (!draft.steps.some(s => ['prompt_patch', 'params_patch', 'character_edit', 'restore_partial', 'edit_config'].includes(s.kind))) return null;
  if (draft.synthetic && !draft.steps.some(s => s.kind === 'edit_config')) return null;
  let form: DrawingForm | undefined, edit: EditConfiguration | undefined;
  const plan = validateDraft(draft, draft.base, { off: new Set(), inspectInput(candidate, configuration) { form = candidate; edit = configuration; } });
  if (!form || plan.workspace === 'chat' || !naiCapabilities(form.model).supported) return null;
  const candidate = form, cap = naiCapabilities(candidate.model);
  const value = draft.target === 'edit' && draft.base.edit && edit
    ? await (readers?.edit ?? (s => editAwareness(s).counted()))({ ...draft.base.edit, config: edit })
    : await (readers?.image ?? (f => naiAwareness({ form: f, models: draft.base.models, samplers: draft.base.samplers }).counted()))(candidate);
  const data = object(value), budget = object(data.input_budget);
  const diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics.map(object) : [];
  const errors = plan.steps.filter(s => s.enabled && s.issue).map(s => s.issue);
  // Preparing words is allowed before a generation source is configured.
  // Execution readiness stays visible in state, but is not an input validity error.
  errors.push(...diagnostics.filter(d => d.severity === 'error' && d.code !== 'source_unavailable').map(d => String(d.message)));
  if (cap.medium && mediumWrite(draft)) errors.push('Medium 的步数、采样器、负向与 Rescale 固定，不能在草稿中写入这些字段');
  if (budget.status !== 'not_applicable') {
    for (const [label, text] of [['Prompt', candidate.prompt], ...candidate.characters.filter(c => c.on).map(c => [`角色 ${c.id}`, c.prompt])]) {
      const issue = textPlacementIssue(text);
      if (issue) errors.push(`${label}：${issue}`);
    }
  }
  const warnings = diagnostics.filter(d => d.severity === 'warning' || d.code === 'source_unavailable').map(d => String(d.message));
  // Token counts are advisory. A missing tokenizer is not something the model can
  // fix by repeatedly submitting the same draft; keep its unavailable status explicit.
  if (!['ready', 'not_applicable'].includes(String(budget.status))) warnings.push(String(budget.reason ?? data.reason ?? '本地分词暂不可用，Token 预算未核验'));
  // Keep the tool response small: no repeated capability catalog, form text or cost schema.
  const compact = (v: unknown) => {
    const part = object(v);
    return { ...Object.fromEntries(['used', 'limit', 'remaining', 'overflow'].flatMap(k => typeof part[k] === 'number' ? [[k, part[k]]] : [])),
      ...(typeof part.used === 'number' && typeof part.limit === 'number' ? { remaining: Math.max(0, part.limit - part.used) } : {}) };
  };
  return { ok: !errors.length, target: draft.target === 'edit' ? 'edit' as const : 'image' as const, model_id: candidate.model,
    input_budget: { status: budget.status ?? 'unavailable', ...(budget.encoder ? { encoder: budget.encoder } : {}),
      ...(budget.positive ? { positive: compact(budget.positive), negative: compact(budget.negative), text: compact(budget.text) } : {}) },
    errors: [...new Set(errors)], warnings };
}
export type NaiDraftCheck = NonNullable<Awaited<ReturnType<typeof checkNaiInput>>>;
