export function download(blob: Blob, name: string, duration = 60_000) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), duration);
}
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    Object.assign(input.style, { position: "fixed", opacity: "0" });
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) throw new Error("复制失败，请手动复制");
  }
}
