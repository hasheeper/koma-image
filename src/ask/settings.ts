import { object } from "../domain/value.ts";
import { checkWord } from "./codec.ts";

/** Stored under koma.ask.v1 and carried by backups; the adult flag lives apart. */
export interface AskSettings {
  version: 1;
  connectionId: string;
  model: string;
  images: boolean;
  preference: string;
  words: string[];
  alwaysCodec: boolean;
}
export const PREFERENCE_LIMIT = 300;
export const defaultAskSettings = (): AskSettings => ({
  version: 1,
  connectionId: "",
  model: "",
  images: true,
  preference: "",
  words: [],
  alwaysCodec: false,
});
/** Model IDs go in request bodies, so slashes and colons are allowed. */
export const modelId = (text: string) => {
  const id = text.trim();
  return id.length <= 200 && !/[\s\p{Cc}]/u.test(id) ? id : "";
};
/** Unknown or invalid fields fall back; excluded words never survive a read. */
export function readAskSettings(value: unknown): AskSettings {
  const v = object(value),
    out = defaultAskSettings();
  if (typeof v.connectionId === "string" && v.connectionId.length < 512)
    out.connectionId = v.connectionId;
  if (typeof v.model === "string") out.model = modelId(v.model);
  if (typeof v.images === "boolean") out.images = v.images;
  if (typeof v.preference === "string")
    out.preference = v.preference.slice(0, PREFERENCE_LIMIT);
  if (Array.isArray(v.words))
    for (const item of v.words) {
      if (typeof item !== "string") continue;
      const checked = checkWord(item, out.words);
      if ("word" in checked) out.words.push(checked.word);
    }
  if (typeof v.alwaysCodec === "boolean") out.alwaysCodec = v.alwaysCodec;
  return out;
}
