/** Canvases paint with theme tokens, so they repaint when <html data-theme> changes. Returns the cleanup. */
export function watchTheme(changed: () => void) {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
