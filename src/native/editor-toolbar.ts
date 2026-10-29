/** Measure the single-row tools without moving Vue-owned nodes. */
export function createEditorToolbar(host: HTMLElement) {
  const toolbar = host.querySelector<HTMLElement>('.editor-toolbar')!;
  const controls = toolbar.querySelector<HTMLElement>('.editor-tool-controls')!;
  const actions = toolbar.querySelector<HTMLElement>('.editor-info-actions')!;
  let frame = 0, active = false;
  const pixels = (value: string) => parseFloat(value) || 0;
  function contentWidth(group: HTMLElement, includeDivider = false) {
    const gap = pixels(getComputedStyle(group).columnGap);
    let width = 0, count = 0;
    for (const child of group.children) {
      if (!(child instanceof HTMLElement)) continue;
      const divider = includeDivider && child.classList.contains('editor-sep');
      if (!divider && !child.getClientRects().length) continue;
      const style = getComputedStyle(child);
      width += (divider ? pixels(style.width) : child.getBoundingClientRect().width)
        + pixels(style.marginLeft) + pixels(style.marginRight);
      count++;
    }
    return width + Math.max(0, count - 1) * gap;
  }
  function layout() {
    frame = 0;
    if (!active || !toolbar.getClientRects().length) return;
    const style = getComputedStyle(toolbar);
    const available = toolbar.parentElement!.clientWidth - 2 * pixels(style.getPropertyValue('--editor-toolbar-inset'));
    // Include the attached divider even while the capsule is detached, so the
    // threshold stays stable when the capsule's own border/padding changes.
    const required = contentWidth(controls) + contentWidth(actions, true)
      + pixels(style.columnGap) + pixels(style.paddingLeft) + pixels(style.paddingRight)
      + pixels(style.borderLeftWidth) + pixels(style.borderRightWidth);
    toolbar.toggleAttribute('data-actions-detached', required > available + 1);
  }
  function schedule() {
    if (!active) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  }
  const resize = new ResizeObserver(schedule);
  const mutations = new MutationObserver(schedule);
  function pause() {
    active = false; resize.disconnect(); mutations.disconnect();
    cancelAnimationFrame(frame); frame = 0;
  }
  return {
    resume() {
      if (active) return;
      active = true;
      for (const target of [toolbar.parentElement!, toolbar, controls, actions, ...controls.children]) resize.observe(target);
      mutations.observe(toolbar, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
      schedule();
    },
    pause,
    dispose() { pause(); toolbar.removeAttribute('data-actions-detached'); },
  };
}
