import type { createAttachments, ImageAttachment } from './attachments.ts';
import type { Draft, DraftPlan, HandoffImage } from './draft/types.ts';

/** Image identity includes its ASK resource scope, never the currently mounted directory. */
export function createProjectImages(pool: (scope: string) => ReturnType<typeof createAttachments> | undefined) {
  let retained = new Set<string>();
  const parts = (ref: string) => { const at = ref.lastIndexOf('/'); return [ref.slice(0, at), ref.slice(at + 1)] as const; };
  return {
    get(ref: string): ImageAttachment | null {
      const [scope, id] = parts(ref), item = pool(scope)?.get(id);
      return item?.kind === 'image' && item.origin?.projectId ? item : null;
    },
    retain(plans: readonly DraftPlan[]) {
      const next = new Set(plans.flatMap(p => [...p.handoff?.images ?? [], ...p.editHandoff ? [p.editHandoff.image] : []]).filter(i => i.source === 'project').map(i => i.ref));
      for (const ref of next) if (!retained.has(ref)) { const [scope, id] = parts(ref); pool(scope)?.retain([id]); }
      for (const ref of retained) if (!next.has(ref)) { const [scope, id] = parts(ref); pool(scope)?.release([id]); }
      retained = next;
    },
  };
}
export type ProjectImages = ReturnType<typeof createProjectImages>;

export async function prepareProjectHandoffs(input: Readonly<Record<string, unknown>>, prepare: (path: string) => Promise<string>) {
  if (!Array.isArray(input.steps) || input.steps.length > 12) return input;
  const image = async (value: unknown) => typeof value === 'string' && !value.startsWith('#') ? prepare(value) : value;
  const steps = [];
  for (const step of input.steps) {
    if (step?.kind === 'edit_handoff') steps.push({ ...step, image: await image(step.image) });
    else if (step?.kind === 'chat_handoff' && Array.isArray(step.images) && step.images.length <= 4) {
      const images = []; for (const value of step.images) images.push(await image(value));
      steps.push({ ...step, images });
    } else steps.push(step);
  }
  return { ...input, steps };
}

/** A restored favorite owns a new scope; keep pending drafts bound to its restored assets. */
export function remapProjectDraft(draft: Draft, before: string, after: string): Draft {
  const image = (i: HandoffImage) => i.source === 'project' && i.ref.startsWith(`${before}/`) ? { ...i, ref: `${after}/${i.ref.slice(before.length + 1)}` } : i;
  return { ...draft, steps: draft.steps.map(s => s.kind === 'chat_handoff' ? { ...s, images: s.images.map(image) } : s),
    ...(draft.editHandoff ? { editHandoff: { ...draft.editHandoff, image: image(draft.editHandoff.image), proposal: remapProjectDraft(draft.editHandoff.proposal, before, after) } } : {}) };
}
