import type { MaskEditor } from "./mask-editor.ts";
/** Vue owns these nodes. This driver owns their delegated geometry, cursor and scroll only. */
export function createEditorCanvas(
  root: HTMLDialogElement,
  mask: MaskEditor,
  deps: {
    size: () => { width: number; height: number } | undefined;
    maskActive: () => boolean;
    brush: () => number;
    compare: (value: boolean) => void;
    panel: (width: number | null) => void;
  },
) {
  const box = root.querySelector<HTMLElement>("#editorViewport")!,
    stage = root.querySelector<HTMLElement>("#editorStage")!,
    canvas = root.querySelector<HTMLCanvasElement>("#editorMask")!,
    cursor = root.querySelector<HTMLElement>("#editorCursor")!,
    zoomLabel = root.querySelector<HTMLElement>("#editorZoomValue")!,
    splitter = root.querySelector<HTMLElement>("#editorSplitter")!,
    handButton = root.querySelector<HTMLElement>("#editorHand")!;
  let zoom: number | null = null,
    scale = 1,
    hand = false,
    space = false,
    events: AbortController | undefined,
    observer: ResizeObserver | undefined;
  let pan: { id: number; x: number; y: number } | null = null,
    pinch: { x: number; y: number; distance: number; scale: number } | null =
      null;
  const touches = new Map<number, { x: number; y: number }>();
  function layout() {
    const size = deps.size();
    if (!size) return;
    if (zoom === null) {
      const css = getComputedStyle(box),
        w =
          box.clientWidth -
          parseFloat(css.paddingLeft) -
          parseFloat(css.paddingRight),
        h =
          box.clientHeight -
          parseFloat(css.paddingTop) -
          parseFloat(css.paddingBottom);
      scale = Math.max(0.05, Math.min(2, w / size.width, h / size.height));
    } else scale = zoom;
    stage.style.width = `${Math.round(size.width * scale)}px`;
    stage.style.height = `${Math.round(size.height * scale)}px`;
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  }
  function zoomTo(next: number, anchor?: { x: number; y: number }) {
    if (!deps.size()) return;
    const rect = box.getBoundingClientRect(),
      before = stage.getBoundingClientRect(),
      x = anchor ? anchor.x - rect.left : rect.width / 2,
      y = anchor ? anchor.y - rect.top : rect.height / 2;
    const fx = before.width
        ? (x + rect.left - before.left) / before.width
        : 0.5,
      fy = before.height ? (y + rect.top - before.top) / before.height : 0.5;
    zoom = Math.max(0.05, Math.min(8, next));
    layout();
    const after = stage.getBoundingClientRect();
    box.scrollLeft += after.left + fx * after.width - (rect.left + x);
    box.scrollTop += after.top + fy * after.height - (rect.top + y);
  }
  function setHand(value: boolean) {
    hand = value;
    paintHand();
  }
  function paintHand() {
    cursor.hidden = true;
    root.dataset.hand = hand || space ? "on" : "off";
    handButton.setAttribute("aria-pressed", String(hand || space));
  }
  function setSpace(value: boolean) {
    space = value;
    paintHand();
  }
  const pinchState = () => {
    const [a, b] = [...touches.values()];
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    };
  };
  function moveCursor(e: PointerEvent) {
    if (
      !deps.maskActive() ||
      hand ||
      space ||
      e.pointerType === "touch" ||
      !canvas.width
    ) {
      cursor.hidden = true;
      return;
    }
    const rect = canvas.getBoundingClientRect(),
      host = cursor.parentElement!.getBoundingClientRect(),
      size = (deps.brush() * rect.width) / canvas.width;
    cursor.hidden = false;
    cursor.style.width = cursor.style.height = `${size}px`;
    cursor.style.transform = `translate(${e.clientX - host.left - size / 2}px,${e.clientY - host.top - size / 2}px)`;
  }
  function pause() {
    events?.abort();
    events = undefined;
    observer?.disconnect();
    observer = undefined;
    pan = pinch = null;
    touches.clear();
    space = false;
    paintHand();
    delete root.dataset.panning;
    delete root.dataset.drag;
    mask.pause();
  }
  function resume() {
    if (events) return;
    events = new AbortController();
    const signal = events.signal;
    mask.resume();
    box.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType === "touch" || !(hand || space || e.button === 1))
          return;
        e.preventDefault();
        pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
        box.setPointerCapture(e.pointerId);
        root.dataset.panning = "on";
      },
      { signal },
    );
    box.addEventListener(
      "pointermove",
      (e) => {
        if (pan?.id !== e.pointerId) return;
        box.scrollLeft -= e.clientX - pan.x;
        box.scrollTop -= e.clientY - pan.y;
        pan.x = e.clientX;
        pan.y = e.clientY;
      },
      { signal },
    );
    const end = (e: PointerEvent) => {
      if (pan?.id === e.pointerId) {
        pan = null;
        delete root.dataset.panning;
      }
    };
    for (const n of ["pointerup", "pointercancel", "lostpointercapture"])
      box.addEventListener(n, end as EventListener, { signal });
    stage.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType !== "touch") return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          mask.cancel();
          pinch = { ...pinchState(), scale };
        }
        if (touches.size >= 2) e.stopPropagation();
      },
      { capture: true, signal },
    );
    root.addEventListener(
      "pointermove",
      (e) => {
        if (!touches.has(e.pointerId)) return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (!pinch || touches.size < 2) return;
        const now = pinchState();
        box.scrollLeft -= now.x - pinch.x;
        box.scrollTop -= now.y - pinch.y;
        zoomTo((pinch.scale * now.distance) / pinch.distance, now);
        pinch.x = now.x;
        pinch.y = now.y;
      },
      { capture: true, signal },
    );
    const lift = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
    };
    for (const n of ["pointerup", "pointercancel"])
      root.addEventListener(n, lift as EventListener, {
        capture: true,
        signal,
      });
    box.addEventListener(
      "wheel",
      (e) => {
        if (!(e.ctrlKey || e.metaKey) || !deps.size()) return;
        e.preventDefault();
        zoomTo(scale * Math.exp(-e.deltaY * 0.0025), {
          x: e.clientX,
          y: e.clientY,
        });
      },
      { passive: false, signal },
    );
    for (const n of ["pointermove", "pointerdown"])
      canvas.addEventListener(n, moveCursor as EventListener, { signal });
    canvas.addEventListener("pointerleave", () => (cursor.hidden = true), {
      signal,
    });
    let start = 0,
      width = 0,
      dragging = false,
      last = 0;
    const paint = (n: number) => {
      last = Math.max(260, Math.min(520, Math.round(n)));
      root.style.setProperty("--editor-panel", `${last}px`);
    };
    splitter.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        start = e.clientX;
        width = root
          .querySelector("#editorForm")!
          .getBoundingClientRect().width;
        dragging = true;
        splitter.setPointerCapture(e.pointerId);
        root.dataset.drag = "on";
      },
      { signal },
    );
    splitter.addEventListener(
      "pointermove",
      (e) => {
        if (dragging) paint(width + e.clientX - start);
      },
      { signal },
    );
    const finish = () => {
      if (!dragging) return;
      dragging = false;
      delete root.dataset.drag;
      deps.panel(last);
    };
    for (const n of ["pointerup", "pointercancel", "lostpointercapture"])
      splitter.addEventListener(n, finish, { signal });
    splitter.addEventListener(
      "dblclick",
      () => {
        root.style.removeProperty("--editor-panel");
        deps.panel(null);
      },
      { signal },
    );
    splitter.addEventListener(
      "keydown",
      (e) => {
        if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
        e.preventDefault();
        paint(
          root.querySelector("#editorForm")!.getBoundingClientRect().width +
            (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 40 : 12),
        );
        deps.panel(last);
      },
      { signal },
    );
    const foot = root.querySelector<HTMLElement>(".composer-foot")!;
    observer = new ResizeObserver(() => {
      if (zoom === null) layout();
      root.style.setProperty(
        "--editor-foot",
        `${Math.ceil(foot.getBoundingClientRect().height)}px`,
      );
    });
    observer.observe(box);
    observer.observe(foot);
    layout();
    window.addEventListener(
      "blur",
      () => {
        setSpace(false);
        deps.compare(false);
        mask.cancel();
      },
      { signal },
    );
  }
  return {
    layout,
    zoomTo,
    step: (d: number) => zoomTo(d > 0 ? scale * 1.25 : scale / 1.25),
    fit: () => {
      zoom = null;
      layout();
    },
    setHand,
    toggleHand: () => setHand(!hand),
    setSpace,
    resume,
    pause,
    dispose: pause,
  };
}
