import { onBeforeUnmount, onDeactivated, shallowRef } from "vue";
import type { Ref } from "vue";

type ElementRef = Readonly<Ref<HTMLElement | null | undefined>>;
type Options = {
  position: () => void;
  resize?: "close" | "place";
  closeOnScroll?: "outside" | "all";
  observe?: () => (HTMLElement | null | undefined)[];
  visualViewport?: boolean;
  afterResizeFrame?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
};

/** Native popover lifecycle only. Each consumer keeps its keyboard and focus policy. */
export function usePopover(menu: ElementRef, options: Options) {
  const open = shallowRef(false);
  let listeners: AbortController | undefined, observer: ResizeObserver | undefined, frame = 0;
  function release() {
    listeners?.abort(); listeners = undefined;
    observer?.disconnect(); observer = undefined;
    cancelAnimationFrame(frame); frame = 0;
  }
  function closed() {
    release();
    if (!open.value) return;
    open.value = false; options.onClose?.();
  }
  function close() {
    if (menu.value?.matches(":popover-open")) menu.value.hidePopover();
    closed();
  }
  function resized() {
    if (options.resize !== "place") return close();
    options.position();
    // ASK also moves its surface in a native resize frame; follow its final position.
    if (options.afterResizeFrame) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = 0; if (open.value) options.position(); });
    }
  }
  function scrolled(event: Event) {
    if (options.closeOnScroll === "all" || !menu.value?.contains(event.target as Node)) close();
  }
  function beforeToggle(event: ToggleEvent) {
    if (!menu.value || event.target !== menu.value) return;
    if (event.newState !== "open") return closed();
    open.value = true;
    // Hidden popovers need a temporary display value for pre-paint measurement.
    const el = menu.value, display = el.style.display;
    el.style.display = "grid";
    options.position();
    if (display) el.style.display = display; else el.style.removeProperty("display");
  }
  function toggled(event: ToggleEvent) {
    if (!menu.value || event.target !== menu.value) return;
    if (!menu.value?.matches(":popover-open")) return closed();
    release(); open.value = true; options.position();
    listeners = new AbortController();
    const signal = listeners.signal;
    window.addEventListener("resize", resized, { signal });
    if (options.visualViewport) window.visualViewport?.addEventListener("resize", resized, { signal });
    if (options.closeOnScroll) window.addEventListener("scroll", scrolled, { capture: true, passive: true, signal });
    if (options.observe) {
      observer = new ResizeObserver(() => { if (open.value) options.position(); });
      for (const el of options.observe()) if (el) observer.observe(el);
    }
    options.onOpen?.();
  }
  onDeactivated(close);
  onBeforeUnmount(close);
  return { open, close, beforeToggle, toggled };
}
