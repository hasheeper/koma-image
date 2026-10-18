import { names } from "../storage/names";
// Only --rail and pointer capture are delegated; Vue gets no move events.
export function installSplitter(node: HTMLElement, signal: AbortSignal) {
  const root = document.documentElement;
  let start = 0,
    initial = 352,
    width = 352,
    dragging = false;
  try {
    width =
      Number(
        JSON.parse(localStorage.getItem(names.preferences) || "{}").rail,
      ) || 352;
  } catch {}
  const paint = (value: number) => {
    width = Math.max(292, Math.min(560, value));
    root.style.setProperty("--rail", `${width}px`);
    node.setAttribute("aria-valuenow", String(width));
  };
  paint(width);
  node.setAttribute("aria-valuemin", "292");
  node.setAttribute("aria-valuemax", "560");
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    delete root.dataset.drag;
    node.dispatchEvent(
      new CustomEvent("widthcommit", { detail: width, bubbles: true }),
    );
  };
  node.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      start = e.clientX;
      initial = width;
      dragging = true;
      node.setPointerCapture(e.pointerId);
      root.dataset.drag = "on";
    },
    { signal },
  );
  node.addEventListener(
    "pointermove",
    (e) => {
      if (dragging) paint(initial + e.clientX - start);
    },
    { signal },
  );
  node.addEventListener("pointerup", finish, { signal });
  node.addEventListener("pointercancel", finish, { signal });
  node.addEventListener("lostpointercapture", finish, { signal });
  node.addEventListener(
    "keydown",
    (e) => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      paint(width + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 40 : 12));
      node.dispatchEvent(
        new CustomEvent("widthcommit", { detail: width, bubbles: true }),
      );
    },
    { signal },
  );
  node.addEventListener(
    "dblclick",
    () => {
      paint(352);
      node.dispatchEvent(
        new CustomEvent("widthcommit", { detail: width, bubbles: true }),
      );
    },
    { signal },
  );
  signal.addEventListener(
    "abort",
    () => {
      dragging = false;
      delete root.dataset.drag;
      root.style.removeProperty("--rail");
    },
    { once: true },
  );
}
