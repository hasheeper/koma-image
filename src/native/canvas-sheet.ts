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
 * Phone bottom sheet: dragging a `[data-sheet-grip]` writes `--sheet-drag` on the tray and marks the root
 * `data-sheet-dragging`; the detent (or closing) commits on release. A drag swallows the click that
 * follows, so a plain tap stays the grip's own button action.
 */
export function installCanvasSheet(root: HTMLElement, sheet: () => HTMLElement | null, actions: SheetActions, signal: AbortSignal) {
  let drag: { id: number; y: number; start: number; height: number; half: number; full: number; detent: SheetDetent; moved: boolean; opened: boolean; samples: { y: number; t: number }[] } | null = null;
  let frame = 0;
  let swallowClick = false;
  /* Keep the frame's variable inside the tray, so the canvas and its other controls do not inherit it. */
  const paint = (height: number) => sheet()?.style.setProperty('--sheet-drag', `${Math.round(height)}px`);
  const cancelFrame = () => { cancelAnimationFrame(frame); frame = 0; };
  const release = (id: number) => { if (root.hasPointerCapture(id)) root.releasePointerCapture(id); };
  root.addEventListener('pointerdown', event => {
    swallowClick = false;
    const grip = (event.target as Element | null)?.closest<HTMLElement>('[data-sheet-grip]');
    if (drag || !grip || !root.contains(grip) || event.button !== 0 || !event.isPrimary || !actions.enabled()) return;
    /* No text selection or native scrolling starts from the grip; the click (tap) still follows. */
    event.preventDefault();
    const node = sheet(), open = actions.isOpen();
    /* Read once, before any writes. The CSS bottom also works while the tray is hidden and does not
       include its enter/leave transform. Moves never measure a height they have just changed. */
    const room = root.getBoundingClientRect().height, bottom = node ? parseFloat(getComputedStyle(node).bottom) || 0 : 0;
    const height = open && node ? node.getBoundingClientRect().height : 0;
    drag = { id: event.pointerId, y: event.clientY, start: height, height, half: Math.max(0, room * SHEET_HALF - bottom), full: Math.max(0, room - bottom - TOP_GAP), detent: actions.detent(), moved: false, opened: open, samples: [{ y: event.clientY, t: event.timeStamp }] };
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
      if (!drag.opened) actions.open();
    }
    drag.samples.push({ y: event.clientY, t: event.timeStamp });
    if (drag.samples.length > 6) drag.samples.shift();
    drag.height = Math.min(drag.full, Math.max(0, drag.start - dy));
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (drag) paint(drag.height); });
  }, { signal });
  const finish = (cancelled: boolean, time = performance.now()) => {
    if (!drag) return;
    const { id, moved, opened, detent, height, half, full, samples } = drag;
    drag = null;
    cancelFrame();
    release(id);
    if (!moved) return;
    /* A touch click may be delayed; the next pointerdown starts a new gesture and clears this flag. */
    swallowClick = true;
    const first = samples[0]!, last = samples.at(-1)!;
    const velocity = !cancelled && time - last.t < 100 && last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
    let next: 'close' | SheetDetent;
    if (cancelled) next = opened ? detent : 'close';
    else if (velocity > FLING) next = detent === 'full' && height > half * .8 ? 'half' : 'close';
    else if (velocity < -FLING) next = 'full';
    else next = height < half * .5 ? 'close' : height < (half + full) / 2 ? 'half' : 'full';
    delete root.dataset.sheetDragging;
    /* Closing keeps the dragged height so the exit leaves from where the finger let go. */
    if (next === 'close') paint(height); else sheet()?.style.removeProperty('--sheet-drag');
    actions.settle(next);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) root.addEventListener(type, event => {
    if (!drag || (event as PointerEvent).pointerId !== drag.id) return;
    /* Touch starts with implicit capture on the grip. Transferring it to root emits a bubbling loss
       from that grip; it is not the end of the gesture. Only losing root's own capture cancels it. */
    if (type === 'lostpointercapture' && event.target !== root) return;
    finish(type !== 'pointerup', event.timeStamp);
  }, { signal });
  window.addEventListener('blur', () => finish(true), { signal });
  window.addEventListener('resize', () => finish(true), { signal });
  window.visualViewport?.addEventListener('resize', () => finish(true), { signal });
  root.addEventListener('selectstart', event => { if (drag) event.preventDefault(); }, { signal });
  root.addEventListener('click', event => {
    if (!swallowClick || !event.detail) return;
    swallowClick = false;
    event.preventDefault(); event.stopPropagation();
  }, { capture: true, signal });
  signal.addEventListener('abort', () => {
    const id = drag?.id;
    drag = null; cancelFrame();
    if (id !== undefined) release(id);
    delete root.dataset.sheetDragging; sheet()?.style.removeProperty('--sheet-drag');
  }, { once: true });
}
