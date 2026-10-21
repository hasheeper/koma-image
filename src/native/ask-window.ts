/** Vue owns the layers; this driver owns the surface's anchor and pointer work. */
export function installAskWindow(root: HTMLElement, signal: AbortSignal) {
  let frame = 0;
  const positions = new Map<string, { right: number; top: number }>();
  const workspace = () => root.dataset.workspace ?? '';
  function position(right: number, top: number, remember = false) {
    const v = window.visualViewport;
    const left = v?.offsetLeft ?? 0, above = v?.offsetTop ?? 0;
    const width = v?.width ?? innerWidth, height = v?.height ?? innerHeight;
    if (remember) positions.set(workspace(), { right, top });
    // Keep the desired anchor, so a temporary large window doesn't move the icon.
    right = Math.max(innerWidth - left - width + 8, Math.min(innerWidth - left - root.offsetWidth - 8, right));
    top = Math.max(above + 8, Math.min(above + height - root.offsetHeight - 8, top));
    root.style.setProperty('--ask-right', `${right}px`);
    root.style.setProperty('--ask-top', `${top}px`);
  }
  const ready = root.querySelector<HTMLElement>('.ask-ready');
  function layout() {
    frame = 0;
    root.style.setProperty('--ask-available-height', `${window.visualViewport?.height ?? innerHeight}px`);
    if (!root.getClientRects().length) return;
    if (root.dataset.mode === 'ready' && ready) root.style.setProperty('--ask-ready-height', `${ready.offsetHeight}px`);
    if (root.classList.contains('ask-inline')) return;
    const saved = positions.get(workspace());
    if (saved) position(saved.right, saved.top);
    else {
      root.style.removeProperty('--ask-right');
      root.style.removeProperty('--ask-top');
      const style = getComputedStyle(root);
      position(parseFloat(style.right), parseFloat(style.top));
    }
  }
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  }
  root.querySelectorAll<HTMLElement>('[data-ask-grip]').forEach(grip => {
    let start: { id: number; x: number; y: number; right: number; top: number } | null = null;
    let moved = false, suppressClick = false;
    const enabled = () => !root.classList.contains('ask-inline');
    grip.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || !enabled()) return;
      // The idle press scales visually; layout coordinates keep the drag stable.
      start = { id: event.pointerId, x: event.clientX, y: event.clientY, right: innerWidth - root.offsetLeft - root.offsetWidth, top: root.offsetTop };
      moved = false; suppressClick = false;
      grip.setPointerCapture(event.pointerId);
    }, { signal });
    grip.addEventListener('pointermove', event => {
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true; root.dataset.dragging = '';
      position(start.right - dx, start.top + dy, true);
    }, { signal });
    const finish = () => {
      if (!start) return;
      suppressClick = moved; start = null;
      delete root.dataset.dragging;
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) grip.addEventListener(type, finish, { signal });
    grip.addEventListener('click', event => {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
    }, { signal, capture: true });
    grip.addEventListener('keydown', event => {
      if (!enabled() || !event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Home') {
        event.preventDefault(); positions.delete(workspace()); schedule();
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const rect = root.getBoundingClientRect(), delta = event.shiftKey ? 4 : 16;
        position(innerWidth - rect.right + (event.key === 'ArrowLeft' ? delta : event.key === 'ArrowRight' ? -delta : 0), rect.top + (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0), true);
      }
    }, { signal });
  });
  const observer = new ResizeObserver(schedule);
  observer.observe(root);
  if (ready) observer.observe(ready);
  window.addEventListener('resize', schedule, { signal });
  window.visualViewport?.addEventListener('resize', schedule, { signal });
  window.visualViewport?.addEventListener('scroll', schedule, { signal });
  signal.addEventListener('abort', () => { observer.disconnect(); cancelAnimationFrame(frame); delete root.dataset.dragging; }, { once: true });
  schedule();
  return schedule;
}
