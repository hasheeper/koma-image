/** Canvas operation sheets stay six pixels above the whole toolbar. */
export function placeEditorPanel(panel: HTMLElement, opener: HTMLElement) {
  const toolbar = opener.closest(".editor-toolbar")?.getBoundingClientRect();
  if (!toolbar) return;
  const anchor = opener.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  const width = panel.getBoundingClientRect().width;
  Object.assign(panel.style, {
    left: `${Math.round(Math.max(8, Math.min(anchor.left + anchor.width / 2 - width / 2, vw - width - 8)))}px`,
    top: "auto", bottom: `${Math.round(Math.max(8, innerHeight - toolbar.top + 6))}px`,
    maxHeight: `${Math.max(40, Math.floor(toolbar.top - 14))}px`,
  });
  panel.dataset.placement = "top";
}
