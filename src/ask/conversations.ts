/** Live conversations; selected favorites can be restored from local storage. */
export const CONVERSATION_LIMIT = 20;
export const UNTITLED = "新对话";

export interface ConversationOrigin { readonly conversationId: string; readonly turnId: number }
export interface ConversationCore {
  readonly id: string;
  title: string;
  /** Set for a fork; only its icon depends on it. */
  readonly origin: ConversationOrigin | null;
}

/** The question's first line, whitespace collapsed, at most 60 characters. */
export const titleOf = (question: string, fallback = "") =>
  (question.split("\n").find((line) => line.trim()) ?? fallback).replace(/\s+/g, " ").trim().slice(0, 60) || UNTITLED;

/**
 * The list keeps creation order and shows the newest first. A conversation is
 * empty until its first turn, and at most one is empty at a time.
 */
export function createConversations<T extends ConversationCore>(options: {
  make(id: string): T;
  empty(conversation: T): boolean;
  limit?: number;
}) {
  const limit = options.limit ?? CONVERSATION_LIMIT, items: T[] = [];
  const add = (build: (id: string) => T) => {
    const conversation = build(crypto.randomUUID());
    items.push(conversation);
    return conversation;
  };
  let current = add(options.make);
  return {
    /** Startup only: stored order is oldest first, just like the live list. */
    restore(saved: readonly T[]) {
      if (!saved.length) return;
      items.splice(0, items.length, ...saved);
      current = items.at(-1)!;
    },
    get current() {
      return current;
    },
    get size() {
      return items.length;
    },
    list(): readonly T[] {
      return [...items].reverse();
    },
    get(id: string) {
      return items.find((c) => c.id === id) ?? null;
    },
    /** Switches to the empty conversation if there is one; otherwise makes it. */
    fresh(): T | "limit" {
      const empty = items.find(options.empty);
      if (empty) return (current = empty);
      return items.length >= limit ? "limit" : (current = add(options.make));
    },
    select(id: string) {
      const found = items.find((c) => c.id === id);
      if (found) current = found;
      return found ?? null;
    },
    /** A conversation built from another; it becomes current. */
    fork(build: (id: string) => T): T | "limit" {
      return items.length >= limit ? "limit" : (current = add(build));
    },
    /** Removing the current one moves to the newest left, or to a new empty one. */
    remove(id: string) {
      const at = items.findIndex((c) => c.id === id);
      if (at < 0) return null;
      const [gone] = items.splice(at, 1);
      if (gone === current) current = items.at(-1) ?? add(options.make);
      return gone;
    },
  };
}
