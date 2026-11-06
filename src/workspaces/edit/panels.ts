/** Flyouts sit above the main tools, covering the contextual tools' space. */
export function placeEditorPanel(panel: HTMLElement, opener: HTMLElement) {
  const tools = (opener.closest(".editor-picture-ops") ?? opener.closest(".editor-toolbar"))?.getBoundingClientRect();
  if (!tools) return;
  const anchor = opener.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  const width = panel.getBoundingClientRect().width;
  Object.assign(panel.style, {
    left: `${Math.round(Math.max(8, Math.min(anchor.left + anchor.width / 2 - width / 2, vw - width - 8)))}px`,
    top: "auto", bottom: `${Math.round(Math.max(8, innerHeight - tools.top + 8))}px`,
    maxHeight: `${Math.max(40, Math.floor(tools.top - 16))}px`,
  });
  panel.dataset.placement = "top";
}
