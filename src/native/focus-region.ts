import { inpaintFocusPlan, snapFocusRect } from "../domain/inpaint-focus.ts";
import type { FocusRect } from "../domain/inpaint-focus.ts";

/** Template-owned nodes; only transient geometry changes during a pointer gesture. */
export function createFocusRegion(root: HTMLElement, host: HTMLElement, deps: {
  size: () => { width: number; height: number } | undefined;
  rect: () => FocusRect | null;
  visible: () => boolean;
  selecting: () => boolean;
  locked: () => boolean;
  commit: (rect: FocusRect) => void;
  settled: () => void;
}) {
  const box = host.querySelector<HTMLElement>(".focus-box")!, label = host.querySelector<HTMLElement>(".focus-label")!;
  let events: AbortController | undefined;
  let gesture: { id: number; x: number; y: number; original: FocusRect | null; kind: string; preview: FocusRect | null } | undefined;
  const active = () => deps.selecting() && !deps.locked() && root.dataset.hand !== "on";
  function paint(rect: FocusRect | null) {
    const size = deps.size();
    host.hidden = !deps.visible() || !size;
    host.dataset.selecting = String(deps.selecting() && !deps.locked());
    box.hidden = !rect || !size;
    box.tabIndex = active() ? 0 : -1;
    if (!size || !rect) return;
    Object.assign(box.style, { left: `${100 * rect.x / size.width}%`, top: `${100 * rect.y / size.height}%`, width: `${100 * rect.width / size.width}%`, height: `${100 * rect.height / size.height}%` });
    let dimensions = `${rect.width}×${rect.height}`;
    try {
      const plan = inpaintFocusPlan(size, rect);
      dimensions += ` → ${plan.targetWidth}×${plan.targetHeight}`;
    } catch { /* Invalid preview geometry has no processing size yet. */ }
    label.textContent = dimensions;
    box.setAttribute("aria-label", `聚焦范围 ${dimensions}，方向键移动，Shift 加速`);
  }
  function sync() { if (!gesture) paint(deps.rect()); }
  function release(id: number) { if (host.hasPointerCapture(id)) host.releasePointerCapture(id); }
  function cancel() {
    const pending = !!gesture;
    if (gesture) { const id = gesture.id; gesture = undefined; release(id); }
    paint(deps.rect());
    if (pending) deps.settled();
  }
  function point(e: PointerEvent) {
    const size = deps.size()!, bounds = host.getBoundingClientRect();
    return { x: Math.max(0, Math.min(size.width, (e.clientX - bounds.left) * size.width / bounds.width)),
      y: Math.max(0, Math.min(size.height, (e.clientY - bounds.top) * size.height / bounds.height)) };
  }
  function pause() { cancel(); events?.abort(); events = undefined; }
  function resume() {
    if (events) return;
    events = new AbortController(); const signal = events.signal;
    host.addEventListener("pointerdown", e => {
      if (!active() || !deps.size() || gesture || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const p = point(e), original = deps.rect(), handle = (e.target as HTMLElement).dataset.corner;
      const kind = handle ?? ((e.target as HTMLElement).closest(".focus-box") && original ? "move" : "new");
      gesture = { id: e.pointerId, ...p, original, kind, preview: original };
      host.setPointerCapture(e.pointerId);
    }, { signal });
    host.addEventListener("pointermove", e => {
      const g = gesture, size = deps.size();
      if (!g || g.id !== e.pointerId || !size) return;
      if (!active()) { cancel(); return; }
      e.preventDefault();
      const p = point(e), start = g.original;
      let rect: FocusRect;
      if (g.kind === "move" && start) rect = { ...start, x: Math.round(Math.max(0, Math.min(size.width - start.width, start.x + p.x - g.x)) / 8) * 8,
        y: Math.round(Math.max(0, Math.min(size.height - start.height, start.y + p.y - g.y)) / 8) * 8 };
      else {
        const x = start && g.kind !== "new" ? g.kind.includes("w") ? start.x + start.width : start.x : g.x;
        const y = start && g.kind !== "new" ? g.kind.includes("n") ? start.y + start.height : start.y : g.y;
        rect = snapFocusRect(size, { x: Math.min(x, p.x), y: Math.min(y, p.y), width: Math.abs(p.x - x), height: Math.abs(p.y - y) });
      }
      g.preview = rect; paint(rect);
    }, { signal });
    host.addEventListener("pointerup", e => {
      const g = gesture;
      if (!g || g.id !== e.pointerId) return;
      gesture = undefined; release(g.id);
      if (active() && g.preview) deps.commit(g.preview);
      else deps.settled();
      sync();
    }, { signal });
    for (const type of ["pointercancel", "lostpointercapture"]) host.addEventListener(type, () => { if (gesture) cancel(); }, { signal });
    box.addEventListener("keydown", e => {
      const rect = deps.rect(), size = deps.size();
      if (!active() || !rect || !size || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const step = e.shiftKey ? 32 : 8;
      deps.commit({ ...rect, x: Math.max(0, Math.min(size.width - rect.width, rect.x + (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0))),
        y: Math.max(0, Math.min(size.height - rect.height, rect.y + (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0))) });
      sync();
    }, { signal });
    window.addEventListener("blur", cancel, { signal });
    sync();
  }
  return { sync, cancel, resume, pause, dispose: pause, isDrawing: () => !!gesture };
}
