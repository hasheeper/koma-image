import { inject, onScopeDispose, shallowRef } from "vue";
import type { InjectionKey } from "vue";
export interface Confirmation {
  title: string;
  message?: string;
  items?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
}
export function createUi() {
  const confirmation = shallowRef<Confirmation | null>(null);
  const credential = shallowRef<{
    id: string;
    action: "key" | "passphrase";
  } | null>(null);
  const notices = shallowRef<
    {
      id: number;
      text: string;
      tone: string;
      count: number;
      duration: number;
      out: boolean;
      action?: { label: string; run: () => Promise<boolean | void> };
    }[]
  >([]);
  const tagDelivery = shallowRef(0);
  const pickerOpen = shallowRef(false);
  let resolve: ((value: boolean) => void) | undefined,
    queue = Promise.resolve(),
    sequence = 0,
    disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function answer(value: boolean) {
    confirmation.value = null;
    resolve?.(value);
    resolve = undefined;
  }
  onScopeDispose(() => {
    disposed = true;
    answer(false);
    for (const timer of timers) clearTimeout(timer);
  });
  return {
    confirmation,
    credential,
    notices,
    answer,
    tagDelivery,
    pickerOpen,
    confirm(options: Confirmation): Promise<boolean> {
      const next = queue.then(() =>
        disposed
          ? false
          : new Promise<boolean>((done) => {
              resolve = done;
              confirmation.value = options;
            }),
      );
      queue = next.then(() => {});
      return next;
    },
    toast(
      text: string,
      tone = "info",
      action?: { label: string; run: () => Promise<boolean | void> },
    ) {
      const same = notices.value.find(
        (n) => n.text === text && n.tone === tone && !n.out,
      );
      const duration = action
        ? 8000
        : ({ ok: 3000, info: 4000, warn: 6000, err: 8000 }[tone] ?? 8000);
      notices.value = [
        {
          id: ++sequence,
          text,
          tone,
          count: (same?.count ?? 0) + 1,
          duration,
          out: false,
          action,
        },
        ...notices.value.filter((n) => n !== same).slice(0, 2),
      ];
    },
    dismissNotice(id: number) {
      if (!notices.value.some((n) => n.id === id && !n.out)) return;
      notices.value = notices.value.map((n) =>
        n.id === id ? { ...n, out: true } : n,
      );
      const timer = setTimeout(() => {
        notices.value = notices.value.filter((n) => n.id !== id);
        timers.delete(timer);
      }, 240);
      timers.add(timer);
    },
    requestKey(id: string) {
      credential.value = { id, action: "key" };
    },
  };
}
export type Ui = ReturnType<typeof createUi>;
export const uiKey: InjectionKey<Ui> = Symbol("ui");
export function useUi(): Ui {
  const ui = inject(uiKey);
  if (!ui) throw new Error("UI unavailable");
  return ui;
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试";
