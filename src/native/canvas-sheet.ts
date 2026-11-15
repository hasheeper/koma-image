export type SheetDetent = 'half' | 'full';
type SheetActions = {
  /** Whether the phone sheet applies right now (BETA on a small screen in this workspace). */
  enabled(): boolean;
  isOpen(): boolean;
  detent(): SheetDetent;
  /** Opens the last pane from the peek grip; the sheet then follows the finger from zero height. */
  open(): void;
  settle(next: 'close' | SheetDetent): void;
};

/* The half detent's top edge sits this share of the root's height up from the root's bottom
   (`55%` in the workspace CSS), whichever pane is open; full reaches the top gap. */
export const SHEET_HALF = .55;
const TOP_GAP = 8, SLOP = 6, FLING = .5;

/**
 * Phone bottom sheet: dragging a `[data-sheet-grip]` writes only `--sheet-drag` on the root and marks it
 * `data-sheet-dragging`; the detent (or closing) commits on release. A drag swallows the click that
 * follows, so a plain tap stays the grip's own button action.
 */
export function installCanvasSheet(root: HTMLElement, sheet: () => HTMLElement | null, actions: SheetActions, signal: AbortSignal) {
  let drag: { id: number; y: number; height: number; moved: boolean; opened: boolean; samples: { y: number; t: number }[] } | null = null;
  let swallowClick = false;
  /* Heights of the two detents for the sheet's current bottom edge. */
  const detents = () => {
    const box = root.getBoundingClientRect(), node = sheet();
    const bottom = node && node.offsetParent ? node.getBoundingClientRect().bottom : box.bottom;
    return { full: Math.max(0, bottom - box.top - TOP_GAP), half: Math.max(0, bottom - box.bottom + box.height * SHEET_HALF) };
  };
  const paint = (height: number) => root.style.setProperty('--sheet-drag', `${Math.round(height)}px`);
  root.addEventListener('pointerdown', event => {
    const grip = (event.target as Element | null)?.closest<HTMLElement>('[data-sheet-grip]');
    if (!grip || !root.contains(grip) || event.button !== 0 || !event.isPrimary || !actions.enabled()) return;
    /* No text selection or native scrolling starts from the grip; the click (tap) still follows. */
    event.preventDefault();
    const node = sheet(), open = actions.isOpen();
    drag = { id: event.pointerId, y: event.clientY, height: open && node ? node.getBoundingClientRect().height : 0, moved: false, opened: open, samples: [{ y: event.clientY, t: event.timeStamp }] };
  }, { signal });
  root.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dy = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(dy) < SLOP) return;
      /* A closed sheet only opens upwards. */
      if (!drag.opened && dy > 0) return;
      drag.moved = true; root.dataset.sheetDragging = '';
      /* Capture on the root, and only once a drag starts: a composer grip hides when ASK opens and would drop
         the pointer, while a plain tap must still deliver its click to the grip. */
      root.setPointerCapture(drag.id);
      paint(drag.height);
      if (!drag.opened) { actions.open(); drag.opened = true; }
    }
    drag.samples.push({ y: event.clientY, t: event.timeStamp });
    if (drag.samples.length > 6) drag.samples.shift();
    paint(Math.min(detents().full, Math.max(0, drag.height - dy)));
  }, { signal });
  const finish = (event: Event) => {
    if (!drag || (event as PointerEvent).pointerId !== drag.id) return;
    const { moved, samples } = drag;
    if (root.hasPointerCapture(drag.id)) root.releasePointerCapture(drag.id);
    drag = null;
    if (!moved) return;
    /* Only the click dispatched right after this release belongs to the drag. */
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 0);
    const first = samples[0]!, last = samples.at(-1)!;
    const velocity = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
    const height = sheet()?.getBoundingClientRect().height ?? 0, { half, full } = detents();
    let next: 'close' | SheetDetent;
    if (velocity > FLING) next = actions.detent() === 'full' && height > half * .8 ? 'half' : 'close';
    else if (velocity < -FLING) next = 'full';
    else next = height < half * .5 ? 'close' : height < (half + full) / 2 ? 'half' : 'full';
    delete root.dataset.sheetDragging;
    /* Closing keeps the dragged height so the exit leaves from where the finger let go. */
    if (next !== 'close') root.style.removeProperty('--sheet-drag');
    actions.settle(next);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) root.addEventListener(type, finish, { signal });
  root.addEventListener('selectstart', event => { if (drag) event.preventDefault(); }, { signal });
  root.addEventListener('click', event => {
    if (!swallowClick) return;
    swallowClick = false;
    if ((event.target as Element | null)?.closest('[data-sheet-grip]')) { event.preventDefault(); event.stopPropagation(); }
  }, { capture: true, signal });
  signal.addEventListener('abort', () => {
    if (drag && root.hasPointerCapture(drag.id)) root.releasePointerCapture(drag.id);
    drag = null; delete root.dataset.sheetDragging; root.style.removeProperty('--sheet-drag');
  }, { once: true });
}
