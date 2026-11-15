import { computed, watch } from 'vue';
import type { ShallowRef } from 'vue';
import type { CanvasPresentation } from './canvas-presentation.ts';
import { installCanvasSheet } from '../native/canvas-sheet.ts';

type SheetOptions = {
  /** The positioning box the sheet rises in; it carries `--sheet-cover` and `data-sheet-dragging`. */
  host: ShallowRef<HTMLElement | null>;
  /** The tray element itself; only this subtree inherits the driver's `--sheet-drag`. */
  sheet: ShallowRef<HTMLElement | null>;
  /** The scroller or stage whose visible bottom the sheet may overlap; the overlap is written as `--sheet-cover`. */
  cover?: () => HTMLElement | null;
  /** Opens a pane the way the workspace's switch does (ASK also reveals the conversation). */
  open(pane: 'ask' | 'context'): void;
};

/**
 * Phone bottom sheet for a canvas collaboration workspace: the same tray, rising from the bottom at half or
 * full height. Presentation only — panes, conversations and forms stay where they are; this adds the detent
 * logic, the grip's tap and drag, raising to full when a pane's input takes focus, and the cover height that
 * keeps the workspace's content reachable above the sheet.
 */
export function useCanvasSheet(layout: CanvasPresentation, options: SheetOptions) {
  const mode = computed(() => layout.active.value && layout.compact.value);
  /* Half height leaves the stage usable; only ASK at full height covers (and pauses) it. */
  const stageCovered = computed(() => mode.value ? layout.panel.value === 'ask' && layout.detent.value === 'full' : layout.covered.value);
  /* Closed on a phone, the workspace's own entries open the sheet; the switch only rides in its head. */
  const switchShown = computed(() => layout.active.value && (!mode.value || layout.switchInTray.value));
  const dragging = () => !!options.host.value && 'sheetDragging' in options.host.value.dataset;
  /* A pane opened by tap or switch drops any height left from a drag that closed the sheet. */
  watch(() => layout.panel.value, (value, previous) => {
    if (value && !previous && !dragging()) options.sheet.value?.style.removeProperty('--sheet-drag');
  });
  return {
    mode, stageCovered, switchShown,
    /** The grip's button action: open the last pane at half height, or toggle half and full. */
    tap() {
      if (!layout.panel.value) options.open(layout.lastPanel.value);
      else layout.detent.value = layout.detent.value === 'half' ? 'full' : 'half';
    },
    /** Input focus in a pane raises the half sheet to full for editing. */
    focus(event: FocusEvent) {
      if (mode.value && layout.detent.value === 'half' && (event.target as Element | null)?.closest('textarea, input, [contenteditable]')) layout.detent.value = 'full';
    },
    /** Installs the grip driver and the cover observer for one active period of the workspace. */
    install(signal: AbortSignal) {
      const host = options.host.value;
      if (!host) return;
      installCanvasSheet(host, () => options.sheet.value, {
        enabled: () => mode.value,
        isOpen: () => !!layout.panel.value,
        detent: () => layout.detent.value,
        open: () => options.open(layout.lastPanel.value),
        settle: next => { if (next === 'close') layout.panel.value = null; else layout.detent.value = next; },
      }, signal);
      const cover = () => {
        if (dragging()) return;
        const node = options.sheet.value, target = options.cover?.();
        const overlap = mode.value && layout.panel.value && node?.offsetParent && target ? Math.max(0, target.getBoundingClientRect().bottom - node.getBoundingClientRect().top) : 0;
        const value = `${Math.round(overlap)}px`;
        if (host.style.getPropertyValue('--sheet-cover') !== value) host.style.setProperty('--sheet-cover', value);
      };
      /* Border boxes: the workspace may answer the cover with padding inside the target, which must not re-trigger it. */
      const observer = new ResizeObserver(cover);
      if (options.sheet.value) observer.observe(options.sheet.value, { box: 'border-box' });
      const target = options.cover?.();
      if (target) observer.observe(target, { box: 'border-box' });
      host.addEventListener('transitionend', event => {
        if (event.target === options.sheet.value || event.target === options.cover?.()) cover();
      }, { signal });
      signal.addEventListener('abort', () => observer.disconnect(), { once: true });
    },
  };
}
