import { ancestry } from "../domain/conversation.ts";
import type { ConversationRecord } from "../storage/records.ts";

interface Entry {
  readonly id: string;
  readonly createdAt: number;
  readonly favoritedAt?: number;
}
export interface IdSnapshot { readonly history: readonly string[]; readonly favorites: readonly string[] }
/** `#h12`, `#f3`, `#c4.2`, `#c4.2.1`, `#a1` as they appear in questions and replies. */
export const idPattern = /#(?:h\d+|f\d+|a\d+|c\d+\.\d+(?:\.\d+)?)(?!\w)/g;

/**
 * Display IDs for one page session. Numbers only grow: a removed image keeps
 * its number and nothing reuses it, so an ID in an old reply never points at a
 * different picture. History is numbered in the order images entered it,
 * favorites by the time they were favorited.
 */
export function createIds() {
  const history = new Map<string, number>(),
    favorites = new Map<string, number>(),
    labels = new Map<string, string>();
  let seenHistory: readonly Entry[] | null = null,
    seenFavorites: readonly Entry[] | null = null;
  return {
    snapshot(): IdSnapshot { return { history: [...history.keys()], favorites: [...favorites.keys()] }; },
    /** Favorites from the same page share a growing registry; deleted images keep their slots. */
    restore(saved: IdSnapshot) {
      for (const [prefix, map, entries] of [["h", history, saved.history], ["f", favorites, saved.favorites]] as const)
        entries.forEach((id, i) => { if (!map.has(id)) { map.set(id, i + 1); labels.set(`#${prefix}${i + 1}`, id); } });
      seenHistory = null; seenFavorites = null;
    },
    /** `historyList` is newest first, as the drawing service keeps it. */
    sync(historyList: readonly Entry[], favoriteList: readonly Entry[]) {
      if (historyList !== seenHistory) {
        seenHistory = historyList;
        for (let i = historyList.length - 1; i >= 0; i--) {
          const { id } = historyList[i];
          if (history.has(id)) continue;
          history.set(id, history.size + 1);
          labels.set(`#h${history.size}`, id);
        }
      }
      if (favoriteList !== seenFavorites) {
        seenFavorites = favoriteList;
        const ordered = [...favoriteList].sort(
          (a, b) =>
            (a.favoritedAt ?? 0) - (b.favoritedAt ?? 0) ||
            a.createdAt - b.createdAt,
        );
        for (const { id } of ordered) {
          if (favorites.has(id)) continue;
          favorites.set(id, favorites.size + 1);
          labels.set(`#f${favorites.size}`, id);
        }
      }
    },
    history: (id: string) =>
      history.has(id) ? `#h${history.get(id)}` : null,
    favorite: (id: string) =>
      favorites.has(id) ? `#f${favorites.get(id)}` : null,
    /** The history label wins when an image is in both lists. */
    label(id: string) {
      return this.history(id) ?? this.favorite(id);
    },
    resolve: (label: string) => labels.get(label) ?? null,
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
