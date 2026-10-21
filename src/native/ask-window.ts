/** Vue owns the nodes and window mode; this driver owns drag geometry only. */
export function installAskWindow(
  root: HTMLElement,
  handle: HTMLElement,
  launcher: HTMLButtonElement,
  signal: AbortSignal,
) {
  let frame = 0;
  const launcherPositions = new Map<string, { x: number; y: number }>();
  const workspace = () => launcher.dataset.workspace ?? '';
  const position = (node: HTMLElement, x: number, y: number, remember = false) => {
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
    x = Math.max(left + 8, Math.min(left + width - node.offsetWidth - 8, x));
    y = Math.max(top + 8, Math.min(top + height - node.offsetHeight - 8, y));
    node.style.setProperty('--ask-left', `${x}px`);
    node.style.setProperty('--ask-top', `${y}px`);
    if (node === launcher && remember) launcherPositions.set(workspace(), { x, y });
  };
  function layout() {
    frame = 0;
    root.style.setProperty('--ask-available-height', `${window.visualViewport?.height ?? innerHeight}px`);
    for (const node of [root, launcher]) {
      if (!node.getClientRects().length || (node === root && root.classList.contains('ask-inline'))) continue;
      if (node === launcher) {
        const saved = launcherPositions.get(workspace());
        if (saved) {
          position(node, saved.x, saved.y);
          continue;
        }
        // Untouched icons follow their workspace anchor, including rail folding.
        node.style.removeProperty('--ask-left');
        node.style.removeProperty('--ask-top');
      }
      // offset coordinates exclude the enter/leave transform.
      position(node, node.offsetLeft, node.offsetTop);
    }
  }
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  }
  function drag(node: HTMLElement, grip: HTMLElement) {
    let start: { id: number; x: number; y: number; left: number; top: number } | null = null;
    let moved = false, suppressClick = false;
    const enabled = () => node !== root || !root.classList.contains('ask-inline');
    grip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary || !enabled()) return;
      const rect = node.getBoundingClientRect();
      start = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      moved = false;
      suppressClick = false;
      grip.setPointerCapture(event.pointerId);
    }, { signal });
    grip.addEventListener('pointermove', (event) => {
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      node.dataset.dragging = '';
      position(node, start.left + dx, start.top + dy, true);
    }, { signal });
    const finish = () => {
      if (!start) return;
      suppressClick = moved;
      start = null;
      delete node.dataset.dragging;
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      grip.addEventListener(type, finish, { signal });
    grip.addEventListener('click', (event) => {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { signal, capture: true });
    grip.addEventListener('keydown', (event) => {
      if (!enabled() || !event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Home') {
        event.preventDefault();
        if (node === launcher) launcherPositions.delete(workspace());
        node.style.removeProperty('--ask-left');
        node.style.removeProperty('--ask-top');
        schedule();
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const rect = node.getBoundingClientRect(), delta = event.shiftKey ? 4 : 16;
        position(node, rect.left + (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0), rect.top + (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0), true);
      }
    }, { signal });
  }
  drag(root, handle);
  drag(launcher, launcher);
  const observer = new ResizeObserver(schedule);
  observer.observe(root);
  observer.observe(launcher);
  window.addEventListener('resize', schedule, { signal });
  window.visualViewport?.addEventListener('resize', schedule, { signal });
  window.visualViewport?.addEventListener('scroll', schedule, { signal });
  signal.addEventListener('abort', () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    delete root.dataset.dragging;
    delete launcher.dataset.dragging;
  }, { once: true });
  schedule();
  return schedule;
}
