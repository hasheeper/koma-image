import { nextTick, onBeforeUnmount, watch } from 'vue';
import type { Ref } from 'vue';
import type { Ask } from '../service.ts';

/** A single dialog moves with Vue. Embedded it is nonmodal; elsewhere it owns the modal ASK host. */
export function useRetrospectSurface(ask: Ask, dialog: Ref<HTMLDialogElement | null>, mount: Ref<HTMLElement | null>, state: () => { embedded: boolean; visible: boolean; target?: HTMLElement | null }) {
  let previousHost: HTMLElement | null = null, revision = 0, returnFocus: Element | null = null;
  const release = () => {
    if (ask.retrospects.host.value === mount.value && mount.value) ask.retrospects.host.value = previousHost?.isConnected ? previousHost : null;
    dialog.value?.close();
  };
  watch(state, async (next, previous) => {
    const token = ++revision;
    const modalWasOpen = dialog.value?.matches(':modal');
    release();
    await nextTick();
    if (token !== revision || !next.visible || !dialog.value?.isConnected) {
      if (modalWasOpen && !next.visible && returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
      return;
    }
    if (next.embedded) { const focus = document.activeElement; dialog.value.show(); if (focus instanceof HTMLElement && focus.isConnected) focus.focus({ preventScroll: true }); }
    else {
      if (!previous?.visible || previous.embedded) returnFocus = document.activeElement;
      previousHost = ask.retrospects.host.value;
      dialog.value.showModal(); ask.hide(); ask.retrospects.host.value = mount.value;
    }
  }, { immediate: true, flush: 'post' });
  onBeforeUnmount(() => { revision++; release(); });
}
