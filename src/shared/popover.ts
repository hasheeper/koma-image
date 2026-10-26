export function placeMenu(
  pop: HTMLElement,
  anchor: DOMRect | { x: number; y: number },
) {
  const vw = document.documentElement.clientWidth,
    vh = innerHeight,
    { width, height } = pop.getBoundingClientRect();
  const box =
    "width" in anchor
      ? anchor
      : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const up = box.bottom + 4 + height > vh - 8;
  pop.style.left = `${Math.round(Math.max(8, Math.min(vw - width - 8, "width" in anchor ? box.right - width : box.left)))}px`;
  pop.style.top = `${Math.round(up ? Math.max(8, box.top - 4 - height) : box.bottom + 4)}px`;
  pop.dataset.placement = up ? "top" : "bottom";
}
export function menuKeys(e: KeyboardEvent) {
  const host = e.currentTarget as HTMLElement,
    items = [
      ...host.querySelectorAll<HTMLElement>(
        "button:not([hidden]):not(:disabled), a[href]:not([hidden])",
      ),
    ];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const to: Record<string, number> = {
    ArrowDown: at + 1,
    ArrowUp: at - 1,
    Home: 0,
    End: items.length - 1,
  };
  if (to[e.key] !== undefined) {
    e.preventDefault();
    items[(to[e.key] + items.length) % items.length]?.focus();
  }
}
