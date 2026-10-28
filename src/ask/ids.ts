import { ancestry } from "../domain/conversation.ts";
import type { ConversationRecord } from "../storage/records.ts";

interface Entry {
  readonly id: string;
  readonly favSeq?: number;
}
export interface IdSnapshot { readonly history: readonly string[]; readonly favorites: readonly string[]; readonly favoriteSeqs?: readonly {id:string; seq:number}[] }
/** Shared grammar: a trailing sentence period is punctuation, another numeric segment is not. */
export const pictureIdSource = String.raw`#(?:h[1-9]\d*|f[1-9]\d*|a[1-9]\d*|e[1-9]\d*(?:\.[1-9]\d*)?[a-c]?|c[1-9]\d*\.[1-9]\d*(?:[a-z]|\.[1-9]\d*)?)`;
export const isPictureId = (id: string) => new RegExp(`^(?:${pictureIdSource})$`).test(id);
export const idPattern = new RegExp(`(?<![\\w:#])(?:${pictureIdSource})(?![\\w]|\\.[\\w.])`, "g");

/**
 * Display IDs for one page session. Numbers only grow: a removed image keeps
 * its number and nothing reuses it, so an ID in an old reply never points at a
 * different picture. History is numbered on arrival; favorites only read
 * fixed numbers assigned by the persistent favorites store.
 */
export function createIds() {
  const history = new Map<string, number>(),
    favorites = new Map<string, number>(),
    labels = new Map<string, string>();
  let activeHistory = new Set<string>(), activeFavorites = new Set<string>();
  let seenHistory: readonly Entry[] | null = null,
    seenFavorites: readonly Entry[] | null = null;
  return {
    snapshot(): IdSnapshot { return { history: [...history.keys()], favorites: [...favorites.keys()], favoriteSeqs:[...favorites].map(([id,seq])=>({id,seq})) }; },
    /** `historyList` is newest first, as the drawing service keeps it. */
    sync(historyList: readonly Entry[], favoriteList: readonly Entry[]) {
      if (historyList !== seenHistory) {
        seenHistory = historyList; activeHistory = new Set(historyList.map(r=>r.id));
        for (let i = historyList.length - 1; i >= 0; i--) {
          const { id } = historyList[i];
          if (history.has(id)) continue;
          history.set(id, history.size + 1);
          labels.set(`#h${history.size}`, id);
        }
      }
      if (favoriteList !== seenFavorites) {
        const registered = new Map<number, string>();
        for (const { id, favSeq } of favoriteList) {
          if (typeof favSeq !== "number" || !Number.isSafeInteger(favSeq) || favSeq < 1) throw new Error("收藏编号尚未就绪");
          if (registered.has(favSeq) && registered.get(favSeq) !== id) throw new Error("收藏编号冲突");
          registered.set(favSeq, id);
        }
        seenFavorites = favoriteList; activeFavorites = new Set(favoriteList.map(r=>r.id));
        favorites.clear();
        for (const [label] of labels) if (label.startsWith("#f")) labels.delete(label);
        for (const [seq, id] of registered) {
          favorites.set(id, seq);
          labels.set(`#f${seq}`, id);
        }
      }
    },
    history: (id: string) =>
      activeHistory.has(id) && history.has(id) ? `#h${history.get(id)}` : null,
    favorite: (id: string) =>
      activeFavorites.has(id) && favorites.has(id) ? `#f${favorites.get(id)}` : null,
    /** The history label wins when an image is in both lists. */
    label(id: string) {
      return this.history(id) ?? this.favorite(id);
    },
    resolve(label: string) {
      const id = labels.get(label);
      return id && (label.startsWith("#h") ? activeHistory : activeFavorites).has(id) ? id : null;
    },
    /** The highest history number handed out so far. */
    cursor: () => history.size,
  };
}
export type Ids = ReturnType<typeof createIds>;

/** `#cN.M`: turn N on the current branch, version M of that turn. */
export function chatLabel(
  conversation: ConversationRecord,
  turnId: string,
  version?: number,
) {
  const turns = ancestry(conversation),
    index = turns.findIndex((t) => t.id === turnId);
  if (index < 0) return null;
  return `#c${index + 1}.${(version ?? turns[index].selectedVersion) + 1}`;
}
