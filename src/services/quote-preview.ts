import type { Quote } from "../domain/quote.ts";
import type { GatewayProfile } from "../gateway/profile.ts";

export type QuoteState =
  | { status: "idle" | "unsupported"; quote: null }
  | { status: "loading"; quote: Quote | null }
  | { status: "ready"; quote: Quote }
  | { status: "error"; quote: Quote | null; error: unknown };
export function createQuotePreview<T>(
  profile: GatewayProfile,
  workspace: "image" | "chat" | "editor",
  estimate: (snapshot: T, signal: AbortSignal) => Promise<Quote | null>,
  publish: (state: QuoteState) => void,
) {
  let state: QuoteState = {
    status: profile.quote.supported ? "idle" : "unsupported",
    quote: null,
  };
  let timer: ReturnType<typeof setTimeout> | undefined,
    controller: AbortController | undefined;
  let generation = 0,
    disposed = false;
  function invalidate() {
    generation++;
    clearTimeout(timer);
    controller?.abort();
    controller = undefined;
  }
  function set(next: QuoteState) {
    state = next;
    publish(next);
  }
  return {
    get state() {
      return state;
    },
    pause() {
      invalidate();
    },
    update(payload: T | null) {
      if (disposed) return;
      invalidate();
      if (!profile.quote.supported) {
        set({ status: "unsupported", quote: null });
        return;
      }
      if (payload === null) {
        set({ status: "idle", quote: null });
        return;
      }
      const snapshot = structuredClone(payload),
        token = generation,
        previous = state.quote;
      set({ status: "loading", quote: previous });
      timer = setTimeout(async () => {
        const current = new AbortController();
        controller = current;
        try {
          const quote = await estimate(snapshot, current.signal);
          if (!disposed && token === generation)
            set(quote ? { status: "ready", quote } : { status: "unsupported", quote: null });
        } catch (error) {
          if (!disposed && token === generation)
            set({ status: "error", quote: previous, error });
        }
      }, profile.quote.debounce[workspace]);
    },
    dispose() {
      disposed = true;
      invalidate();
    },
  };
}
