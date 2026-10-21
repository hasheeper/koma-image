export interface SseEvent {
  readonly event: string;
  readonly data: string;
}
/** Incremental server-sent events: push decoded text, get complete events. */
export function createSseParser() {
  let buffer = "",
    event = "",
    data: string[] = [];
  function line(text: string, out: SseEvent[]) {
    if (!text) {
      if (data.length) out.push({ event: event || "message", data: data.join("\n") });
      event = "";
      data = [];
      return;
    }
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":"),
      field = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
  }
  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk;
      const out: SseEvent[] = [],
        breaks = /\r\n|\r|\n/g;
      let start = 0;
      for (let m = breaks.exec(buffer); m; m = breaks.exec(buffer)) {
        // A trailing \r may be the first half of \r\n.
        if (m[0] === "\r" && m.index === buffer.length - 1) break;
        line(buffer.slice(start, m.index), out);
        start = m.index + m[0].length;
      }
      buffer = buffer.slice(start);
      return out;
    },
    /** Relays sometimes drop the final blank line, so a pending event still counts. */
    end(): SseEvent[] {
      const out: SseEvent[] = [];
      if (buffer) line(buffer.replace(/\r$/, ""), out);
      buffer = "";
      line("", out);
      return out;
    },
  };
}
