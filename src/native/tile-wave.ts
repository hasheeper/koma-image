/* Tile wave: the loading state for a picture that does not exist yet.

   A grid of rounded tiles swells and fades along the diagonal while the
   request runs. When the picture arrives, a crest sweeps from the top-left
   corner: each tile it passes becomes a window onto the real image and then
   widens until it meets its neighbours, so what shows through is the sharp
   result the whole time — never a blurred or pixelated stand-in. Fully merged,
   the canvas is the image itself, so the caller can swap in the real element
   without a second transition.

   The field is a texture in the mat, not a picture-shaped panel: the frame
   has no edge or shadow of its own, tiles thin out and shrink toward the
   border until they dissolve into the background, and only the travelling
   crest is clearly lit — a dense, evenly lit grid of small squares became
   uncomfortable to watch for the length of a generation. The print's shadow
   arrives with the crest (`data-wave="crest"` on the frame), so the edge
   appears as the picture does. A frame that fades carries `data-wave="rest"`
   until then, which is what takes its own panel and shadow away.

   Drawn on canvas rather than in CSS so the finish can pick up each tile
   exactly where the wave left it. The phase runs off the page clock, so a
   frame mounted mid-wave (a re-rendered message, the stage after a batch
   step) continues the same wave instead of restarting it. */

export interface TileWave {
  resize(): void;
  draw(now: number): void;
  reveal(source: CanvasImageSource): Promise<boolean>;
  reset(): void;
  destroy(): void;
}
interface LiveWave extends TileWave {
  canvas: HTMLCanvasElement;
  visible: boolean | null;
}
interface ScaledImage { canvas: HTMLCanvasElement; source: CanvasImageSource }

const PERIOD = 2000;      // one swell, ms
const PEAK = 0.45;        // share of the period spent rising
const STEP = 90;          // ms between neighbouring diagonals: about 22 diagonals
                          // to a wavelength, so a band visibly travels across
                          // even a small frame instead of the whole field pulsing
const LENGTH = 1350;      // the crest, ms; the last tile settles at ~1270
const INK = "rgb(179, 161, 255)";
const INK_ALPHA = 0.26;   // a tile at the top of its swell, mid-field

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => 1 - (1 - t) ** 3;
const easeIO = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - (2 - 2 * t) ** 3 / 2;
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

// 0 → 1 → 0 once per period, offset by the tile's diagonal.
function swell(now: number, x: number, y: number): number {
  const u = (((now - (x + y) * STEP) % PERIOD) + PERIOD) % PERIOD / PERIOD;
  return 0.5 - 0.5 * Math.cos(Math.PI * (u < PEAK ? u / PEAK : 1 - (u - PEAK) / (1 - PEAK)));
}

/* One clock for every wave on the page. Frames that are off screen, detached
   or hidden (the stage's busy layer between jobs) are not drawn at all. */
const live = new Set<LiveWave>();
const byCanvas = new WeakMap<Element, LiveWave>();
let ticking = false;
function tick(now: number) {
  for (const wave of live) {
    if (wave.canvas.isConnected) wave.draw(now);
    else live.delete(wave);
  }
  ticking = live.size > 0;
  if (ticking) requestAnimationFrame(tick);
}
function wake() {
  if (!ticking && live.size) { ticking = true; requestAnimationFrame(tick); }
}
const seen = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const wave = byCanvas.get(entry.target);
    if (!wave) continue;
    wave.visible = entry.isIntersecting;
    if (wave.visible) { live.add(wave); wave.draw(performance.now()); }
    else live.delete(wave);
  }
  wake();
}, { rootMargin: "80px" });
const sized = new ResizeObserver(entries => {
  for (const entry of entries) byCanvas.get(entry.target)?.resize();
});

function onScreen(node: Element): boolean {
  const box = node.getBoundingClientRect();
  return box.width > 0 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
}

/* `cell` is the target cell size in CSS px; by default about a thirteenth of
   the short side, between 24 and 36, so a phone-sized frame does not get a
   few chunky blocks. `fade` dissolves the field into its surroundings; a
   thumbnail keeps its edge, since there it is a control with its own outline
   and too small to spare the border. */
export function tileWave(
  frame: HTMLElement,
  { cell = 0, fade = true }: { cell?: number; fade?: boolean } = {},
): TileWave {
  const canvas = document.createElement("canvas");
  canvas.className = "tile-wave";
  canvas.setAttribute("aria-hidden", "true");
  frame.append(canvas);
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.remove();
    throw new Error("当前浏览器不支持 Canvas 动画");
  }
  const g = context;

  let w = 0, h = 0, dpr = 1, cols = 0, rows = 0, pw = 0, ph = 0, base = 0;
  let edge: Float32Array<ArrayBuffer> | null = null;
  // `finished` freezes the last frame: the merged picture, or the still wave
  // under reduced motion. Either way there is nothing left to animate.
  let art: ScaledImage | null = null;
  let at = 0, finished = false, timer = 0;
  let settle: ((played: boolean) => void) | null = null;

  const wave: LiveWave = {
    // null until the observer first reports; reveal() measures it itself then.
    canvas, visible: null,
    resize() {
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return;
      dpr = Math.min(2, devicePixelRatio || 1);
      w = box.width; h = box.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      const size = cell || Math.min(36, Math.max(24, Math.min(w, h) / 13));
      cols = Math.max(3, Math.round(w / size)); rows = Math.max(3, Math.round(h / size));
      pw = w / cols; ph = h / rows; base = Math.min(pw, ph) * 0.88;
      // How far each tile sits inside the field: 1 in the middle, 0 at the
      // border, on a rounded-rectangle contour so the corners fade too.
      edge = new Float32Array(cols * rows).fill(1);
      if (fade) for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const u = Math.abs((x + 0.5) / cols * 2 - 1), v = Math.abs((y + 0.5) / rows * 2 - 1);
        edge[y * cols + x] = smooth(1.04, 0.56, (u ** 4 + v ** 4) ** (1 / 4));
      }
      // A resize mid-crest rescales the picture; at rest it just redraws.
      if (art) art = scaled(art.source);
      finished = false;
      if (wave.visible) live.add(wave);
      wave.draw(performance.now()); wake();
    },
    draw(now) {
      if (finished) { live.delete(wave); return; }
      if (!w || !edge) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      // Reduced motion holds one frame of the wave: the diagonal still reads,
      // nothing moves.
      if (!art) {
        paintWave(reduced.matches ? PERIOD * 0.3 : now, edge);
        if (reduced.matches) stop();
        return;
      }
      const k = (now - at) / 1000;
      if (k * 1000 >= LENGTH) { g.drawImage(art.canvas, 0, 0, w, h); stop(); return; }
      paintCrest(now, k, art, edge);
    },
    /* Opens the wave onto `source` (a decoded image). Resolves once the canvas
       shows the whole picture — true if the crest played, false if it was
       skipped (reduced motion, a hidden tab, a frame scrolled out of view),
       in which case the caller should present the result its usual way. */
    reveal(source) {
      // A frame created this task has not been observed or measured yet.
      if (!w) wave.resize();
      if (wave.visible === null) wave.visible = onScreen(canvas);
      if (reduced.matches || document.hidden || !wave.visible || !w) return Promise.resolve(false);
      art = scaled(source); at = performance.now(); finished = false;
      frame.dataset.wave = "crest";
      live.add(wave); wake();
      return new Promise<boolean>(resolve => {
        // A timer, not the frame loop: frames stop in a background tab and
        // the caller would otherwise wait for the user to come back.
        settle = played => { settle = null; clearTimeout(timer); resolve(played); };
        timer = window.setTimeout(() => settle?.(true), LENGTH);
      });
    },
    // Back to the wave, for the next job in the same frame.
    reset() {
      settle?.(false);
      art = null; finished = false;
      if (fade) frame.dataset.wave = "rest";
      if (wave.visible) live.add(wave);
      wake();
    },
    destroy() {
      settle?.(false);
      delete frame.dataset.wave;
      live.delete(wave); seen.unobserve(canvas); sized.unobserve(canvas);
      canvas.remove();
    },
  };

  function stop() { finished = true; live.delete(wave); }

  // The picture at the canvas's own pixel size, so every window is a 1:1 copy.
  function scaled(source: CanvasImageSource): ScaledImage {
    const copy = document.createElement("canvas");
    copy.width = canvas.width; copy.height = canvas.height;
    const cg = copy.getContext("2d");
    if (!cg) throw new Error("当前浏览器不支持 Canvas 动画");
    cg.imageSmoothingQuality = "high";
    cg.drawImage(source, 0, 0, copy.width, copy.height);
    return { canvas: copy, source };
  }

  // A tile's look at rest: side length and alpha for swell `s`, edge `e`.
  // Light falls off steeply from the crest, so only one band reads clearly at
  // a time; the trough keeps a trace so the field never empties between crests.
  const sideAt = (s: number, e: number) => lerp(0.5, 0.82, s) * lerp(0.6, 1, e) * base;
  const alphaAt = (s: number, e: number) => INK_ALPHA * lerp(0.06, 1, s * s) * e;

  /* Tiles at rest share a handful of alpha levels, so the wave is a few
     batched fills rather than one per tile. */
  const LEVELS = 16;
  function paintWave(now: number, edge: Float32Array) {
    const buckets = Array.from({ length: LEVELS }, (): number[] => []);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const s = swell(now, x, y), e = edge[y * cols + x], a = alphaAt(s, e);
      if (a < 0.004) continue;
      buckets[Math.min(LEVELS - 1, Math.floor(a / INK_ALPHA * LEVELS))].push(x, y, sideAt(s, e));
    }
    g.fillStyle = INK;
    buckets.forEach((list, level) => {
      if (!list.length) return;
      g.globalAlpha = INK_ALPHA * (level + 0.5) / LEVELS;
      g.beginPath();
      for (let i = 0; i < list.length; i += 3) {
        const side = list[i + 2];
        g.roundRect((list[i] + 0.5) * pw - side / 2, (list[i + 1] + 0.5) * ph - side / 2, side, side, side * 0.2);
      }
      g.fill();
    });
    g.globalAlpha = 1;
  }

  /* The crest. Each tile waits for the diagonal front to reach it, opens into
     a window over 0.3s, then widens past its cell — the 1.1 overshoot shuts
     the last sliver of gap decisively instead of leaving a hairline grid.
     Windows open at full strength even where the field had faded: the picture
     reaches its own edges. */
  function paintCrest(now: number, k: number, art: ScaledImage, edge: Float32Array) {
    const sx = art.canvas.width / w, sy = art.canvas.height / h, span = cols + rows - 2;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const delay = (x + y) / span * 0.75;
      const open = ease(clamp01((k - delay) / 0.3));
      const merge = easeIO(clamp01((k - delay - 0.12) / 0.4));
      const s = swell(now, x, y), e = edge[y * cols + x];
      const side = lerp(sideAt(s, e), 0.9 * base, open);
      const tw = lerp(side, pw * 1.1, merge), th = lerp(side, ph * 1.1, merge), r = lerp(side * 0.2, 0, merge);
      const X = (x + 0.5) * pw - tw / 2, Y = (y + 0.5) * ph - th / 2;
      if (open > 0) {
        // A dim copy fills the cell behind the window, so the gaps read as a
        // dark screen over the picture rather than as black lines. Edges snap
        // to device pixels so neighbouring cells neither overlap nor seam.
        const x0 = Math.round(x * pw * dpr) / dpr, x1 = Math.round((x + 1) * pw * dpr) / dpr;
        const y0 = Math.round(y * ph * dpr) / dpr, y1 = Math.round((y + 1) * ph * dpr) / dpr;
        g.globalAlpha = open * 0.28;
        g.drawImage(art.canvas, x0 * sx, y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy, x0, y0, x1 - x0, y1 - y0);
        g.save(); g.beginPath(); g.roundRect(X, Y, tw, th, r); g.clip();
        g.globalAlpha = open;
        g.drawImage(art.canvas, X * sx, Y * sy, tw * sx, th * sy, X, Y, tw, th);
        g.restore();
      }
      if (open < 1) {
        g.globalAlpha = alphaAt(s, e) * (1 - open); g.fillStyle = INK;
        g.beginPath(); g.roundRect(X, Y, tw, th, r); g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  if (fade) frame.dataset.wave = "rest";
  byCanvas.set(canvas, wave);
  seen.observe(canvas); sized.observe(canvas);
  return wave;
}
