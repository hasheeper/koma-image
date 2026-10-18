import {
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onScopeDispose,
} from "vue";
import type { ShallowRef } from "vue";
import { useShell } from "./shell";
import type { WorkspaceId } from "./routes";

/** Capture before KeepAlive detaches DOM; restore after activation, not after a timer. */
export function useWorkspaceLifecycle(
  id: WorkspaceId,
  scrollports: ShallowRef<HTMLElement | null>[] = [],
) {
  const { router } = useShell();
  let page = [0, 0];
  let positions: [number, number][] = [];
  let activation = 0;
  let controller: AbortController | undefined;
  const listeners = new Set<(signal: AbortSignal) => void>();
  onScopeDispose(
    router.beforeChange((previous, next) => {
      if (previous.workspace !== id || next.workspace === id) return;
      page = [window.scrollX, window.scrollY];
      positions = scrollports.map((ref) => [
        ref.value?.scrollLeft ?? 0,
        ref.value?.scrollTop ?? 0,
      ]);
    }),
  );
  function pause() {
    activation++;
    controller?.abort();
    controller = undefined;
  }
  onActivated(async () => {
    pause();
    const current = activation;
    controller = new AbortController();
    for (const start of listeners) start(controller.signal);
    await nextTick();
    if (current !== activation || router.route.value.workspace !== id) return;
    window.scrollTo({ left: page[0], top: page[1], behavior: "instant" });
    scrollports.forEach((ref, i) => {
      const position = positions[i];
      if (ref.value && position)
        ref.value.scrollTo({
          left: position[0],
          top: position[1],
          behavior: "instant",
        });
    });
  });
  onDeactivated(pause);
  onBeforeUnmount(pause);
  // Active UI listeners stop on deactivation; task lifetime is separate.
  return {
    whileActive(start: (signal: AbortSignal) => void) {
      listeners.add(start);
    },
  };
}
