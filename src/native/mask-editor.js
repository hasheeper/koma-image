/** Source-pixel coordinates keep touch/mouse masks aligned at every display size. */
export function createMaskEditor(canvas, onChange) {
  const mask = document.createElement("canvas"),
    ctx = mask.getContext("2d", { willReadFrequently: true });
  const preview = canvas.getContext("2d");
  // Paint in the accent token so the mask follows the theme rather than a copy of it.
  const tint =
    getComputedStyle(canvas).getPropertyValue("--a").trim() || "#b3a1ff";
  let strokes = [],
    position = 0,
    stroke = null,
    diameter = 64,
    erase = false,
    locked = false,
    encoded;
  function paint(item, from = 0) {
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
  function point(event) {
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
  const down = (event) => {
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
  const move = (event) => {
    if (!stroke || stroke.pointer !== event.pointerId) return;
    stroke.points.push(point(event));
    paint(stroke, stroke.points.length - 1);
    display();
  };
  function finish(event) {
    if (!stroke || stroke.pointer !== event.pointerId) return;
    strokes = strokes.slice(0, position);
    strokes.push(stroke);
    position++;
    stroke = null;
    onChange();
  }
  let events;
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
    ])
      canvas.addEventListener(name, handler, { signal: events.signal });
  }
  return {
    pause,
    resume,
    dispose: pause,
    snapshot() {
      return {
        width: mask.width,
        height: mask.height,
        strokes: structuredClone(strokes),
        position,
      };
    },
    restore(state) {
      stroke = null;
      canvas.width = mask.width = state.width;
      canvas.height = mask.height = state.height;
      strokes = structuredClone(state.strokes);
      position = state.position;
      replay();
    },
    resize(width, height) {
      canvas.width = mask.width = width;
      canvas.height = mask.height = height;
      strokes = [];
      position = 0;
      stroke = null;
      display();
      onChange();
    },
    setBrush(size, eraser) {
      diameter = size;
      erase = eraser;
      canvas.dataset.eraser = String(eraser);
    },
    setLocked(value) {
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
    getMask() {
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
      output.getContext("2d").putImageData(data, 0, 0);
      return (encoded = output.toDataURL("image/png"));
    },
  };
}
