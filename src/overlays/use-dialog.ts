import { nextTick, onBeforeUnmount, watch } from "vue";
import type { ShallowRef } from "vue";
import { useShell } from "../app/shell";
import type { OverlayId } from "../app/routes";

/** Native dialog retains focus, top-layer and Escape semantics. Its subtree stays mounted. */
export function useDialog(
  id: OverlayId,
  dialog: Readonly<ShallowRef<HTMLDialogElement | null>>,
  canClose: () => boolean = () => true,
) {
  const { router } = useShell();
  let revision = 0;
  let returnFocus: HTMLElement | null = null;
  const removeGuard = router.guard(
    (previous) => previous.overlay !== id || canClose(),
  );
  watch(
    () => router.route.value.overlay,
    async (overlay) => {
      const current = ++revision;
      await nextTick();
      if (current !== revision || !dialog.value) return;
      if (overlay === id && !dialog.value.open) {
        const active = document.activeElement;
        returnFocus =
          active instanceof HTMLElement &&
          active !== document.body &&
          active.getClientRects().length
            ? active
            : document.querySelector<HTMLElement>(".switcher");
        dialog.value.showModal();
      } else if (overlay !== id && dialog.value.open) {
        dialog.value.close();
        if (!overlay) {
          const target =
            returnFocus?.isConnected && returnFocus.getClientRects().length
              ? returnFocus
              : document.querySelector<HTMLElement>(".switcher");
          target?.focus({ preventScroll: true });
        }
      }
    },
    { immediate: true, flush: "post" },
  );
  function requestClose() {
    if (canClose()) router.closeOverlay();
  }
  function cancel(event: Event) {
    event.preventDefault();
    requestClose();
  }
  // Native close events can arrive after another overlay opened; never close that overlay.
  function closed() {
    if (router.route.value.overlay === id && !dialog.value?.open)
      requestClose();
  }
  onBeforeUnmount(() => {
    removeGuard();
    revision++;
    dialog.value?.close();
  });
  return { requestClose, cancel, closed };
}
