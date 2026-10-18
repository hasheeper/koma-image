import { inject, onScopeDispose, shallowRef } from "vue";
import type { InjectionKey } from "vue";
import type { Drawing } from "../services/drawing";
export const drawingKey: InjectionKey<Drawing> = Symbol("drawing");
export function useDrawing() {
  const drawing = inject(drawingKey);
  if (!drawing) throw new Error("Drawing unavailable");
  const view = shallowRef(drawing.snapshot());
  const stop = drawing.subscribe(() => {
    view.value = drawing.snapshot();
  });
  onScopeDispose(stop);
  return { drawing, view };
}
