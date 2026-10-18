/** The empty measurement host's descendants and layout styles belong to this driver. */
export function caretRect(textarea: HTMLTextAreaElement, host: HTMLElement) {
  const rect = textarea.getBoundingClientRect(),
    style = getComputedStyle(textarea);
  Object.assign(host.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    overflow: "hidden",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: "auto",
    minHeight: "0",
  });
  for (const property of [
    "box-sizing",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "font-variant",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "text-indent",
    "text-transform",
    "tab-size",
    "white-space",
    "overflow-wrap",
    "word-break",
  ])
    host.style.setProperty(property, style.getPropertyValue(property));
  host.textContent = textarea.value.slice(
    0,
    textarea.selectionStart ?? textarea.value.length,
  );
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  host.append(marker);
  const result = marker.getBoundingClientRect();
  host.replaceChildren();
  return result;
}
export function placeSuggestions(
  textarea: HTMLTextAreaElement,
  popover: HTMLElement,
  measurement: HTMLElement,
) {
  const anchor = (
      textarea.closest(".hl-wrap") || textarea
    ).getBoundingClientRect(),
    caret = caretRect(textarea, measurement),
    viewport = window.visualViewport;
  const vx = viewport?.offsetLeft || 0,
    vy = viewport?.offsetTop || 0,
    vw = viewport?.width || innerWidth,
    vh = viewport?.height || innerHeight;
  const margin = vw <= 680 ? 8 : 10,
    gap = 6,
    width = Math.min(420, Math.max(340, anchor.width), vw - margin * 2),
    cx = Math.min(anchor.right - 8, Math.max(anchor.left + 8, caret.left));
  const left = Math.min(
      vx + vw - width - margin,
      Math.max(vx + margin, cx - 18),
    ),
    ct = Math.min(anchor.bottom, Math.max(anchor.top, caret.top)),
    cb = Math.min(anchor.bottom, Math.max(anchor.top, caret.bottom));
  const belowRoom = Math.max(0, vy + vh - margin - cb - gap),
    aboveRoom = Math.max(0, ct - vy - margin - gap);
  popover.style.width = `${Math.round(width)}px`;
  popover.style.maxHeight = `${Math.floor(Math.max(108, Math.min(360, Math.max(belowRoom, aboveRoom))))}px`;
  const desired = Math.min(360, popover.scrollHeight),
    below = belowRoom >= Math.min(desired, 150) || belowRoom >= aboveRoom,
    room = below ? belowRoom : aboveRoom;
  popover.style.maxHeight = `${Math.floor(Math.max(108, Math.min(360, room)))}px`;
  const height = Math.min(
    popover.scrollHeight,
    Math.max(108, Math.min(360, room)),
  );
  const top = below
    ? Math.min(vy + vh - margin - height, cb + gap)
    : Math.max(vy + margin, ct - gap - height);
  popover.dataset.placement = below ? "bottom" : "top";
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}
