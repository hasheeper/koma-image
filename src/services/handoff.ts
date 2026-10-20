import type { ApplicationServices } from "./application";
import { MAX_INPUT_BYTES } from "../domain/media.ts";
import { HANDOFF_MAX_AGE } from "../storage/records";
import type { HandoffRecord } from "../storage/records";
import { names } from "../storage/names";
import { transactionDone, idbRequest } from "../storage/databases";
export async function fitReference(blob: Blob, name: string) {
  const bitmap = await createImageBitmap(blob);
  try {
    const initial = Math.min(
      1,
      Math.sqrt(40_000_000 / (bitmap.width * bitmap.height)),
    );
    if (blob.size <= MAX_INPUT_BYTES && initial === 1) return { blob, name };
    for (let scale = initial; scale > initial * 0.3; scale *= 0.8) {
      const canvas = new OffscreenCanvas(
        Math.max(1, Math.floor(bitmap.width * scale)),
        Math.max(1, Math.floor(bitmap.height * scale)),
      );
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.92, 0.82, 0.72]) {
        const out = await canvas.convertToBlob({ type: "image/jpeg", quality });
        if (out.size <= MAX_INPUT_BYTES)
          return { blob: out, name: name.replace(/\.\w+$/, "") + ".jpg" };
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("图片超过 8MB，无法作为参考图");
}
export function createHandoff(services: ApplicationServices) {
  return {
    queue(blob: Blob, name = "图片") {
      return services.data.write(async () => {
        const fitted = await fitReference(blob, name),
          ticket = crypto.randomUUID();
        const tx = services.databases.transaction(
            names.databases.handoff,
            "items",
            "readwrite",
          ),
          done = transactionDone(tx),
          store = tx.objectStore("items");
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          if (Date.now() - (Number(c.value.at) || 0) > HANDOFF_MAX_AGE)
            c.delete();
          c.continue();
        };
        store.put({ ...fitted, at: Date.now() }, ticket);
        await done;
        return ticket;
      });
    },
    take(ticket: string) {
      return services.data.write(async () => {
        const tx = services.databases.transaction(
            names.databases.handoff,
            "items",
            "readwrite",
          ),
          done = transactionDone(tx);
        void done.catch(() => {});
        const store = tx.objectStore("items");
        const record = await idbRequest<HandoffRecord | undefined>(
          store.get(ticket),
        );
        if (record) store.delete(ticket);
        await done;
        return record?.blob &&
          Date.now() - (Number(record.at) || 0) <= HANDOFF_MAX_AGE
          ? record
          : null;
      });
    },
  };
}
