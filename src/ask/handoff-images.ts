import type { createAttachments, ImageAttachment } from './attachments.ts';
import type { Draft, DraftPlan, HandoffImage } from './draft/types.ts';

/** Image identity includes its ASK resource scope, never the currently mounted directory. */
export function createHandoffImages(pool: (scope: string) => ReturnType<typeof createAttachments> | undefined) {
  let retained = new Set<string>();
  const parts = (ref: string) => { const at = ref.lastIndexOf('/'); return [ref.slice(0, at), ref.slice(at + 1)] as const; };
  return {
    get(ref: string): ImageAttachment | null {
      const [scope, id] = parts(ref), item = pool(scope)?.get(id);
      return item?.kind === 'image' ? item : null;
    },
    retain(plans: readonly DraftPlan[]) {
      const next = new Set(plans.flatMap(p => [...p.handoff?.images ?? [], ...p.editReferences?.map(i=>i.image) ?? [], ...p.editHandoff ? [p.editHandoff.image] : []]).filter(i => (i.source === 'project' || i.source === 'attachment')).map(i => i.ref));
      for (const ref of next) if (!retained.has(ref)) { const [scope, id] = parts(ref); pool(scope)?.retain([id]); }
      for (const ref of retained) if (!next.has(ref)) { const [scope, id] = parts(ref); pool(scope)?.release([id]); }
      retained = next;
    },
  };
}
export type HandoffImages = ReturnType<typeof createHandoffImages>;

export async function prepareProjectHandoffs(input: Readonly<Record<string, unknown>>, prepare: (path: string) => Promise<string>) {
  if (!Array.isArray(input.steps) || input.steps.length > 12) return input;
  const image = async (value: unknown) => typeof value === 'string' && !value.startsWith('#') ? prepare(value) : value;
  const prepared = new Map<string, Promise<unknown>>();
  const resolve = (value: unknown) => {
    if (typeof value !== 'string') return Promise.resolve(value);
    if (!prepared.has(value)) prepared.set(value, image(value));
    return prepared.get(value)!;
  };
  const steps = [];
  for (const step of input.steps) {
    if (step?.kind === 'edit_handoff' || step?.kind === 'edit_references') {
      const references = []; if (Array.isArray(step.references) && step.references.length<=16) for (const r of step.references) references.push({...r,image:await resolve(r.image)});
      steps.push({...step,...(step.kind==='edit_handoff'?{image:await resolve(step.image)}:{}),...(step.references!==undefined?{references:Array.isArray(step.references)&&step.references.length<=16?references:step.references}:{})});
    }
    else if (step?.kind === 'chat_handoff' && Array.isArray(step.images) && step.images.length <= 64) {
      const images = []; for (const value of step.images) images.push(await resolve(value));
      steps.push({ ...step, images, ...(step.base_image !== undefined ? { base_image: await resolve(step.base_image) } : {}) });
    } else steps.push(step);
  }
  return { ...input, steps };
}

/** A restored favorite owns a new scope; keep pending drafts bound to its restored assets. */
export function remapHandoffDraft(draft: Draft, before: string, after: string): Draft {
  const ref = (value: string) => value.startsWith(`${before}/`) ? `${after}/${value.slice(before.length + 1)}` : value;
  const image = (i: HandoffImage) => (i.source === 'project' || i.source === 'attachment') && i.ref.startsWith(`${before}/`) ? { ...i, ref: ref(i.ref), ...(i.binding?.scope.kind === 'ask' ? { binding: { ...i.binding, scope: { ...i.binding.scope, id: after } } } : {}) } : i;
  return { ...draft, steps: draft.steps.map(s => s.kind === 'chat_handoff' ? { ...s, images: s.images.map(image), ...(s.baseImage ? { baseImage: ref(s.baseImage) } : {}) } : s.kind === 'edit_references' ? {...s,items:s.items.map(item=>({...item,image:image(item.image)}))} : s),
    ...(draft.editHandoff ? { editHandoff: { ...draft.editHandoff, image: image(draft.editHandoff.image), proposal: remapHandoffDraft(draft.editHandoff.proposal, before, after) } } : {}) };
}
