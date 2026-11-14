import { canvasRatio } from '../ask/canvas-presentation.ts';

/** Pointer frames write only the width variable; preference commits happen on release. */
export function installCanvasSplitter(node: HTMLElement, root: HTMLElement, value: () => number, commit: (ratio: number) => void, signal: AbortSignal) {
  let ratio = value(), start: { id: number; x: number; ratio: number; width: number } | null = null;
  const paint = (next: number) => {
    ratio = canvasRatio(next);
    root.style.setProperty('--canvas-ask-width', `${ratio * 100}%`);
    node.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    node.setAttribute('aria-valuetext', `侧栏 ${Math.round(ratio * 100)}%`);
  };
  paint(ratio);
  node.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); start = { id: event.pointerId, x: event.clientX, ratio: value(), width: root.clientWidth };
    node.setPointerCapture(event.pointerId); root.dataset.resizing = '';
  }, { signal });
  node.addEventListener('pointermove', event => { if (start) paint(start.ratio - (event.clientX - start.x) / start.width); }, { signal });
  const finish = () => { if (!start) return; start = null; delete root.dataset.resizing; commit(ratio); };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) node.addEventListener(type, finish, { signal });
  node.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault(); paint(event.key === 'Home' ? .4 : value() + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? .025 : .01)); commit(ratio);
  }, { signal });
  node.addEventListener('dblclick', () => { paint(.4); commit(ratio); }, { signal });
  signal.addEventListener('abort', () => { if (start && node.hasPointerCapture(start.id)) node.releasePointerCapture(start.id); start = null; delete root.dataset.resizing; }, { once: true });
}
