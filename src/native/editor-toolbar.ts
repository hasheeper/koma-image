/** Reserve space for the wrapping tool capsules without moving Vue-owned nodes. */
export function createEditorToolbar(host: HTMLElement) {
  const toolbar = host.querySelector<HTMLElement>('.editor-toolbar')!;
  const mat = toolbar.parentElement!;
  let frame = 0, active = false;
  function layout() {
    frame = 0;
    if (!active) return;
    mat.style.setProperty('--editor-toolbar-height', `${Math.ceil(toolbar.getBoundingClientRect().height)}px`);
  }
  function schedule() {
    if (!active) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  }
  const resize = new ResizeObserver(schedule);
  function pause() {
    active = false; resize.disconnect();
    cancelAnimationFrame(frame); frame = 0;
  }
  return {
    resume() {
      if (active) return;
      active = true;
      resize.observe(toolbar);
      schedule();
    },
    pause,
    dispose() { pause(); mat.style.removeProperty('--editor-toolbar-height'); },
  };
}
