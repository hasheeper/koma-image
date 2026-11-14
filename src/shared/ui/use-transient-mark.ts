import { onScopeDispose, shallowRef } from "vue";

/** A marker that stays on for one entrance animation, then clears, so a
 *  KeepAlive re-insertion or a later re-render never replays it. */
export function useTransientMark(duration = 400) {
  const on = shallowRef(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onScopeDispose(() => clearTimeout(timer));
  return {
    on,
    mark() {
      on.value = true;
      clearTimeout(timer);
      timer = setTimeout(() => { on.value = false; }, duration);
    },
  };
}
