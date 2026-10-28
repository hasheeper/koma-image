import { imageEntity } from '../../src/domain/image-identity.ts';
import { makeThumb } from '../../src/services/image-response.ts';

/** Synthetic UI fixtures only. Generation and its onImage events use drawing.run() in pipeline tests. */
export async function seedHistory({drawing, home}, blob, size, params, quote = null, ms) {
  const [thumbBlob, entity_key] = await Promise.all([makeThumb(blob), imageEntity(blob)]);
  const record = {id:crypto.randomUUID(), entity_key, lineage:{via:'image'}, createdAt:Date.now(),
    blob, thumbBlob, size, params, quote, ...(ms === undefined ? {} : {ms})};
  const {history, form} = drawing.snapshot();
  history.unshift(record);
  const limit = form.localCache ? Number(form.historyLimit) : 1;
  if (limit > 0) history.splice(limit);
  // Publish a new history-array reference through the existing removal notification.
  // No production fixture hook or external-image insertion API is retained.
  drawing.remove('');
  drawing.show(record);
  home?.store.capture(record);
  return record;
}
