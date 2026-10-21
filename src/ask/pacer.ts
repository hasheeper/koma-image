/** Minimum dwell times from the prototype (doc 2 §5); they top up, never add. */
export const PACE = Object.freeze({
  toolMin: 600,
  betweenTools: 160,
  afterText: 320,
  beforeDraft: 300,
});
type Wait = (ms: number) => Promise<void>;

/**
 * Orders view updates and holds each until its minimum gap since the previous
 * one has passed. The runner never waits for it: events queue here while the
 * network keeps reading, and a slow tool already past its gap shows at once.
 */
export function createPacer(now = () => performance.now(), wait?: Wait) {
  let chain: Promise<void> = Promise.resolve(),
    last = 0,
    rushed = false,
    cancelled = false,
    wake: (() => void) | undefined;
  async function pause(ms: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        wait ? wait(ms) : new Promise<void>((done) => { timer = setTimeout(done, ms); }),
        new Promise<void>((done) => { wake = done; }),
      ]);
    } finally {
      clearTimeout(timer);
      wake = undefined;
    }
  }
  return {
    push(step: () => void, gap = 0) {
      chain = chain.then(async () => {
        if (cancelled) return;
        const due = last + gap - now();
        if (due > 0 && !rushed) await pause(due);
        if (cancelled) return;
        step();
        last = now();
      });
    },
    /** Resolves once every queued step has run. */
    settled: () => chain,
    /** Runs whatever is queued without further waiting (stop, failure). */
    rush() {
      rushed = true;
      wake?.();
    },
    /** Stop showing queued output, including an already pending dwell. */
    cancel() {
      cancelled = true;
      wake?.();
    },
  };
}
