export interface MaskPoint { x: number; y: number }
export interface MaskStroke {
  points: [MaskPoint, ...MaskPoint[]];
  diameter: number;
  erase: boolean;
  pointer: number;
  clear?: false;
}
export type MaskEntry = MaskStroke | { clear: true };
export interface MaskState {
  width: number;
  height: number;
  strokes: MaskEntry[];
  position: number;
}

/** Source-pixel coordinates keep touch/mouse masks aligned at every display size. */
export function createMaskEditor(canvas: HTMLCanvasElement, onChange: () => void) {
  const mask = document.createElement("canvas"),
    context = mask.getContext("2d", { willReadFrequently: true });
  const previewContext = canvas.getContext("2d");
  if (!context || !previewContext) throw new Error("当前浏览器不支持 Canvas 蒙版");
  const ctx = context, preview = previewContext;
  // Paint in the accent token so the mask follows the theme rather than a copy of it.
  const tint =
    getComputedStyle(canvas).getPropertyValue("--a").trim() || "#b3a1ff";
  let strokes: MaskEntry[] = [], stroke: MaskStroke | null = null;
  let position = 0, diameter = 64,
    erase = false,
    locked = false;
  let encoded: string | null | undefined;
  function paint(item: MaskEntry, from = 0) {
    if (item.clear) {
      ctx.clearRect(0, 0, mask.width, mask.height);
      return;
    }
    ctx.globalCompositeOperation = item.erase
      ? "destination-out"
      : "source-over";
    ctx.fillStyle = ctx.strokeStyle = "white";
    ctx.lineWidth = item.diameter;
    ctx.lineCap = ctx.lineJoin = "round";
    const points = item.points;
    if (from === 0) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, item.diameter / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = Math.max(1, from); i < points.length; i++) {
      ctx.beginPath();
      ctx.moveTo(points[i - 1].x, points[i - 1].y);
      ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }
  function display() {
    encoded = undefined;
    preview.clearRect(0, 0, canvas.width, canvas.height);
    preview.drawImage(mask, 0, 0);
    preview.globalCompositeOperation = "source-in";
    preview.fillStyle = tint;
    preview.fillRect(0, 0, canvas.width, canvas.height);
    preview.globalCompositeOperation = "source-over";
  }
  function replay() {
    ctx.clearRect(0, 0, mask.width, mask.height);
    for (const item of strokes.slice(0, position)) paint(item);
    display();
    onChange();
  }
  function point(event: PointerEvent): MaskPoint {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          mask.width,
          ((event.clientX - rect.left) * mask.width) / rect.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          mask.height,
          ((event.clientY - rect.top) * mask.height) / rect.height,
        ),
      ),
    };
  }
  const down = (event: PointerEvent) => {
    if (locked || stroke || event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    stroke = {
      points: [point(event)],
      diameter,
      erase,
      pointer: event.pointerId,
    };
    paint(stroke);
    display();
    onChange();
  };
  const move = (event: PointerEvent) => {
    if (!stroke || stroke.pointer !== event.pointerId) return;
    stroke.points.push(point(event));
    paint(stroke, stroke.points.length - 1);
    display();
  };
  function finish(event: PointerEvent) {
    if (!stroke || stroke.pointer !== event.pointerId) return;
    strokes = strokes.slice(0, position);
    strokes.push(stroke);
    position++;
    stroke = null;
    onChange();
  }
  let events: AbortController | null | undefined;
  function pause() {
    events?.abort();
    events = null;
    if (stroke) {
      stroke = null;
      replay();
    }
  }
  function resume() {
    if (events) return;
    events = new AbortController();
    for (const [name, handler] of [
      ["pointerdown", down],
      ["pointermove", move],
      ["pointerup", finish],
      ["pointercancel", finish],
      ["lostpointercapture", finish],
    ] as const)
      canvas.addEventListener(name, handler, { signal: events.signal });
  }
  return {
    pause,
    resume,
    dispose: pause,
    snapshot(): MaskState {
      return {
        width: mask.width,
        height: mask.height,
        strokes: structuredClone(strokes),
        position,
      };
    },
    restore(state: MaskState) {
      stroke = null;
      canvas.width = mask.width = state.width;
      canvas.height = mask.height = state.height;
      strokes = structuredClone(state.strokes);
      position = state.position;
      replay();
    },
    resize(width: number, height: number) {
      canvas.width = mask.width = width;
      canvas.height = mask.height = height;
      strokes = [];
      position = 0;
      stroke = null;
      display();
      onChange();
    },
    setBrush(size: number, eraser: boolean) {
      diameter = size;
      erase = eraser;
      canvas.dataset.eraser = String(eraser);
    },
    setLocked(value: boolean) {
      locked = value;
    },
    undo() {
      if (!locked && !stroke && position) {
        position--;
        replay();
      }
    },
    redo() {
      if (!locked && !stroke && position < strokes.length) {
        position++;
        replay();
      }
    },
    clear() {
      if (!locked && !stroke) {
        strokes = strokes.slice(0, position);
        strokes.push({ clear: true });
        position++;
        replay();
      }
    },
    // A second finger turns the gesture into a pan or pinch; drop the stroke it started.
    cancel() {
      if (stroke) {
        const id = stroke.pointer;
        stroke = null;
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
        replay();
      }
    },
    canUndo: () => position > 0,
    canRedo: () => position < strokes.length,
    isDrawing: () => stroke !== null,
    getMask(): string | null {
      if (stroke) throw new Error("请完成当前蒙版笔画");
      if (encoded !== undefined) return encoded;
      const data = ctx.getImageData(0, 0, mask.width, mask.height);
      let painted = false;
      for (let i = 0; i < data.data.length; i += 4) {
        const white = data.data[i + 3] > 32;
        painted ||= white;
        data.data[i] = data.data[i + 1] = data.data[i + 2] = white ? 255 : 0;
        data.data[i + 3] = 255;
      }
      if (!painted) return (encoded = null);
      const output = document.createElement("canvas");
      output.width = mask.width;
      output.height = mask.height;
      const outputContext = output.getContext("2d");
      if (!outputContext) throw new Error("当前浏览器不支持 Canvas 蒙版");
      outputContext.putImageData(data, 0, 0);
      return (encoded = output.toDataURL("image/png"));
    },
  };
}
export type MaskEditor = ReturnType<typeof createMaskEditor>;
