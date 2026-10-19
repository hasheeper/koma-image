import { inject, onScopeDispose, shallowRef } from "vue";
import type { InjectionKey } from "vue";
import type { Editor } from "../services/editor";
export const editorKey: InjectionKey<Editor> = Symbol("editor");
export function useEditor() {
  const editor = inject(editorKey);
  if (!editor) throw new Error("Editor unavailable");
  const view = shallowRef(editor.snapshot());
  const stop = editor.subscribe(() => (view.value = editor.snapshot()));
  onScopeDispose(stop);
  return { editor, view };
}
